// v2 is not bound to an older published contract, so there is no outside artifact to
// check it against first. Two things stand in for one: scripts/port_check.py
// reimplements it from SPEC.md Part II in another language, and this suite MEASURES the
// properties v2 exists to fix, beside the v1 behaviour they replace.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as v2 from "../dist/b-called-v2.js";
import { turns as v1turns } from "../dist/b-called.js";

const V = JSON.parse(readFileSync(new URL("../vectors/b-called-v2-vectors.json", import.meta.url), "utf8"));
const Q = v2.QUICKNET.hash;
const R = V.rounds["1000001"].randomness;
const pk = (n) => Array.from({ length: n }, (_, i) => `p${i}`);
const base = (over = {}) => ({ network: Q, round: 1000001, drawId: "t", form: "turn", regime: "public", salt: "ab".repeat(32), roster: pk(5), previousLast: null, ...over });

function drawCases() {
    const c = V.cases;
    return [...c.season_public_turns.rounds.map((r, i) => [`season ${i + 1}`, r]), ...["turn_boundary_swap", "turn_sealed", "lot_admit_0", "lot_admit_3", "lot_admit_10"].map((k) => [k, c[k]])];
}

// ── vectors ──────────────────────────────────────────────────────────────────

test("every recorded round is consistent with its signature", async () => {
    for (const [round, b] of Object.entries(V.rounds)) {
        assert.ok(await v2.randomnessMatchesSignature(b.randomness, b.signature), round);
        const flipped = (b.randomness[0] === "0" ? "1" : "0") + b.randomness.slice(1);
        assert.equal(await v2.randomnessMatchesSignature(flipped, b.signature), false, `${round}: a tampered value must not match`);
    }
});

test("every draw vector recomputes, and verifies against its commitment", async () => {
    const cases = drawCases();
    assert.ok(cases.length >= 9, "the vectors file lost draw cases");
    for (const [name, c] of cases) {
        const d = await v2.verify(c.commitment, c.input, c.randomness);
        assert.deepEqual(d.order, c.order, name);
        assert.equal(d.commitment, c.commitment, name);
        if (c.input.form === "lot") assert.deepEqual(d.admitted, c.admitted, name);
        else assert.equal(d.boundarySwapped, c.boundarySwapped, name);
    }
    assert.equal(V.cases.turn_boundary_swap.boundarySwapped, true, "the boundary vector must actually exercise the swap");
});

test("the season chains closers and freezes each roster", () => {
    const rounds = V.cases.season_public_turns.rounds;
    for (let r = 1; r < rounds.length; r++) assert.equal(rounds[r].input.previousLast, rounds[r - 1].order.at(-1));
    assert.notDeepEqual(rounds[0].input.roster, rounds[1].input.roster, "the vector must include a roster change");
});

test("stream and round-time vectors", async () => {
    const s = V.cases.stream;
    assert.deepEqual(await v2.streamUint32(s.key, s.label, s.uint32.length), s.uint32);
    assert.equal(v2.roundTime(v2.QUICKNET, V.cases.round_time.round), V.cases.round_time.unixSeconds);
    assert.equal(v2.roundAt(v2.QUICKNET, v2.roundTime(v2.QUICKNET, 1234567)), 1234567);
});

// ── the commitment binds what could otherwise be chosen late ──────────────────

test("verify refuses inputs that differ from the commitment", async () => {
    const c = V.cases.lot_admit_3;
    // The untampered case must verify FIRST — otherwise a build that rejects everything
    // (a broken commitment encoding) passes this test for the wrong reason.
    assert.deepEqual((await v2.verify(c.commitment, c.input, c.randomness)).admitted, c.admitted);
    const tamper = [
        { ...c.input, admit: 4 },
        { ...c.input, round: c.input.round + 1 },
        { ...c.input, roster: [...c.input.roster].reverse() },
        { ...c.input, salt: "cd".repeat(32) },
        { ...c.input, regime: "sealed" },
        { ...c.input, drawId: "another" }
    ];
    for (const t of tamper) await assert.rejects(v2.verify(c.commitment, t, c.randomness), /do not match/);
});

test("every field is bound, checked without the vectors", async () => {
    const lotBase = base({ form: "lot", previousLast: null, admit: 2 });
    const variants = [
        base({ round: 1000002 }), base({ drawId: "u" }), base({ regime: "sealed" }), base({ salt: "cd".repeat(32) }),
        base({ roster: ["p0", "p1", "p2", "p4", "p3"] }), base({ network: "00".repeat(32) }), lotBase, { ...lotBase, admit: 3 }
    ];
    const seen = new Set([await v2.commit(base())]);
    for (const v of variants) seen.add(await v2.commit(v));
    assert.equal(seen.size, variants.length + 1, "two different inputs produced the same commitment");
});

test("the previous closer is bound: changing it changes the commitment", async () => {
    assert.notEqual(await v2.commit(base({ previousLast: "p1" })), await v2.commit(base({ previousLast: "p2" })));
    assert.notEqual(await v2.commit(base({ previousLast: null })), await v2.commit(base({ previousLast: "p1" })));
});

test("the same beacon round and roster give unrelated orders under different draw ids", async () => {
    const a = await v2.draw(base({ roster: pk(12), drawId: "surface-a" }), R);
    const b = await v2.draw(base({ roster: pk(12), drawId: "surface-b" }), R);
    assert.notDeepEqual(a.order, b.order);
});

// ── refusals ─────────────────────────────────────────────────────────────────

test("inputs that would reopen a closed door are refused", async () => {
    await assert.rejects(v2.commit(base({ roster: ["p0", "p1", "p0"] })), /duplicate roster id/);
    await assert.rejects(v2.commit(base({ roster: [] })), TypeError);
    await assert.rejects(v2.commit(base({ salt: "ab".repeat(16) })), /salt/);
    await assert.rejects(v2.commit(base({ admit: 2 })), /admit belongs to the lot form/);
    await assert.rejects(v2.commit(base({ form: "lot", previousLast: "p1", admit: 1 })), /previousLast belongs to the turn form/);
    await assert.rejects(v2.commit(base({ form: "lot", previousLast: null })), /admit/);
    await assert.rejects(v2.commit(base({ round: 0 })), RangeError);
    await assert.rejects(v2.draw(base(), "ab"), /beacon randomness/);
});

test("the module offers no seed maker, no weights and no presence input", async () => {
    assert.equal(v2.newSeed, undefined);
    const d = await v2.draw({ ...base(), weights: { p0: 100 }, present: ["p0"] }, R);
    const plain = await v2.draw(base(), R);
    assert.deepEqual(d.order, plain.order, "extra fields must change nothing — there is nowhere for a weight or a presence list to go");
});

// ── rejection sampling ───────────────────────────────────────────────────────

test("uniformIndex rejects the tail, scripted", async () => {
    const scripted = (xs) => { let i = 0; return async () => xs[i++]; };
    assert.equal(await v2.uniformIndex(scripted([0xffffffff, 5]), 3), 2, "2^32-1 must be rejected for m=3");
    assert.equal(await v2.uniformIndex(scripted([0xffffffff]), 1), 0);
    assert.equal(await v2.uniformIndex(scripted([0xfffffffe]), 0x100000000), 0xfffffffe);
});

// ── the property v2 exists for: the previous closer is uniform, not 2/n ──────

test("measured: the previous closer never opens and is uniform over the rest — v1 made it close again at 2/n", async () => {
    const n = 4;
    const N = 6000;
    const pos = new Array(n).fill(0);
    let opens = [0, 0, 0, 0];
    for (let k = 0; k < N; k++) {
        const salt = v2.newSalt();
        const d = await v2.draw(base({ roster: pk(n), previousLast: "p3", salt }), R);
        pos[d.order.indexOf("p3")]++;
        opens[Number(d.order[0].slice(1))]++;
    }
    assert.equal(pos[0], 0, "the previous closer must never open");
    for (let p = 1; p < n; p++) {
        const share = pos[p] / N;
        assert.ok(Math.abs(share - 1 / 3) < 0.03, `position ${p}: ${share.toFixed(3)} (expected 0.333 ± 0.03)`);
    }
    for (let m = 0; m < 3; m++) assert.ok(Math.abs(opens[m] / N - 1 / 3) < 0.03, `p${m} opens ${(opens[m] / N).toFixed(3)}`);
    // The contrast, measured the same way on v1: its rotation puts the closer last at 2/n = 0.5.
    let v1last = 0;
    for (let s = 0; s < N; s++) {
        const t = v1turns(pk(n), s, 2 * n).map((x) => x.id);
        if (t[2 * n - 1] === t[n - 1]) v1last++;
    }
    assert.ok(Math.abs(v1last / N - 0.5) < 0.03, `v1 contrast: ${(v1last / N).toFixed(3)}`);
});
