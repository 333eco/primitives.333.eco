// The order of these suites is the argument.
//
// 1. SEY'S PUBLISHED VECTORS FIRST. The generator, shuffle and bag were lifted
//    from sey's caller; @333eco/sey@1.0.0 published its vectors on 2026-09-01,
//    before this package existed. Agreeing with a dated artifact nobody here can
//    edit is the only evidence the extraction changed nothing.
// 2. This package's own vectors.
// 3. KNOWN-FAILURE CONTROLS. A conformance check that has only ever passed is an
//    untested claim. Each control breaks the algorithm the way a porter most
//    often does and asserts the vectors CATCH it.
// 4. Properties the vectors only sample.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
    seededRng,
    shuffled,
    secondStreamSeed,
    Bag,
    turns,
    lot,
    seedFromBeacon,
    rosterCommitment,
    seedCommitment,
    newSalt
} from "../dist/b-call.js";

const require = createRequire(import.meta.url);
const sey = JSON.parse(readFileSync(require.resolve("@333eco/sey/caller-vectors.json"), "utf8"));
const own = JSON.parse(readFileSync(new URL("../vectors/b-call-vectors.json", import.meta.url), "utf8"));

const u32 = (rng, n) => Array.from({ length: n }, () => rng() * 4294967296);
const ids = (n) => Array.from({ length: n }, (_, i) => `p${i}`);

// ── 1 · @333eco/sey@1.0.0 ────────────────────────────────────────────────────

test("sey vectors are present — the control must see something", () => {
    const keys = Object.keys(sey.cases);
    assert.ok(keys.filter((k) => k.startsWith("prng_")).length >= 3);
    assert.ok(keys.filter((k) => k.startsWith("shuffle_")).length >= 2);
    assert.ok(keys.filter((k) => k.startsWith("sequence_call_")).length >= 3);
});

test("sey: prng", () => {
    for (const [key, c] of Object.entries(sey.cases)) {
        if (!key.startsWith("prng_")) continue;
        assert.deepEqual(u32(seededRng(c.seed), c.uint32.length), c.uint32, key);
    }
});

test("sey: shuffle", () => {
    for (const [key, c] of Object.entries(sey.cases)) {
        if (!key.startsWith("shuffle_")) continue;
        assert.deepEqual(shuffled(c.input, seededRng(c.seed)), c.output, key);
    }
});

// In sey's Call format the app calls and nobody sits out, so the receiver
// sequence is exactly one Bag over every player — the turn form, unadorned.
test("sey: call-format sequences are the turn form", () => {
    for (const [key, c] of Object.entries(sey.cases)) {
        if (!key.startsWith("sequence_call_")) continue;
        const got = turns(ids(c.players), c.seed, c.calls.length).map((t) => t.id);
        assert.deepEqual(got, c.calls.map((x) => x.receiver), key);
    }
});

// ── 2 · own vectors ──────────────────────────────────────────────────────────

test("own vectors: every case recomputes", async () => {
    let checked = 0;
    for (const [key, c] of Object.entries(own.cases)) {
        if (key.startsWith("prng_")) assert.deepEqual(u32(seededRng(c.seed), c.uint32.length), c.uint32, key);
        else if (key.startsWith("shuffle_")) assert.deepEqual(shuffled(c.input, seededRng(c.seed)), c.output, key);
        else if (key.startsWith("second_stream_")) assert.equal(secondStreamSeed(c.seed), c.secondStreamSeed, key);
        else if (key === "turns_membership_change") assert.deepEqual(replayMembershipChange(c), c.turns, key);
        else if (key.startsWith("turns_")) assert.deepEqual(turns(c.roster, c.seed, c.count), c.turns, key);
        else if (key.startsWith("lot_")) assert.deepEqual(lot(c.roster, c.seed, c.admit), c.admitted, key);
        else if (key === "beacon_seed") assert.equal(seedFromBeacon(c.randomness), c.seed, key);
        else if (key === "roster_commitment") assert.equal(await rosterCommitment(c.roster, c.salt), c.commitment, key);
        else if (key === "seed_commitment") assert.equal(await seedCommitment(c.seed, c.salt), c.commitment, key);
        else assert.fail(`unhandled vector case ${key} — a case nobody checks is a case that can rot`);
        checked++;
    }
    assert.equal(checked, Object.keys(own.cases).length);
});

test("own vectors agree with sey's on the shared seeds", () => {
    for (const seed of [1, 123456789, 4294967295]) {
        assert.deepEqual(own.cases[`prng_seed_${seed}`].uint32, sey.cases[`prng_seed_${seed}`].uint32);
    }
    assert.deepEqual(own.cases.shuffle_n7_seed_1.output, sey.cases.shuffle_seed_1.output);
});

test("the recorded beacon round is genuine: randomness = SHA-256(signature)", async () => {
    const c = own.cases.beacon_seed;
    const bytes = Uint8Array.from(c.signature.match(/../g).map((h) => parseInt(h, 16)));
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    assert.equal([...digest].map((b) => b.toString(16).padStart(2, "0")).join(""), c.randomness);
});

function replayMembershipChange(c) {
    const bag = new Bag(seededRng(c.seed));
    const out = [];
    for (const step of c.steps) {
        if (step.setMembers) bag.setMembers(step.setMembers);
        else for (let k = 0; k < step.take; k++) out.push({ id: bag.take(), roundStart: bag.startedRound });
    }
    return out;
}

// ── 3 · known-failure controls ───────────────────────────────────────────────

test("control: a signed right shift is caught", () => {
    const broken = (seed) => {
        let a = seed | 0;
        return () => {
            a = (a + 0x6d2b79f5) | 0;
            let t = Math.imul(a ^ (a >> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >> 7), 61 | t)) ^ t;
            return ((t ^ (t >> 14)) >>> 0) / 4294967296;
        };
    };
    const caught = Object.entries(own.cases)
        .filter(([k]) => k.startsWith("prng_"))
        .some(([, c]) => JSON.stringify(u32(broken(c.seed), 8)) !== JSON.stringify(c.uint32));
    assert.ok(caught, "the prng vectors did not catch a signed shift");
});

test("control: an ascending Fisher–Yates is caught", () => {
    const ascending = (items, rng) => {
        const out = items.slice();
        for (let i = 0; i < out.length - 1; i++) {
            const j = i + Math.floor(rng() * (out.length - i));
            [out[i], out[j]] = [out[j], out[i]];
        }
        return out;
    };
    const caught = Object.entries(own.cases)
        .filter(([k]) => k.startsWith("shuffle_"))
        .some(([, c]) => JSON.stringify(ascending(c.input, seededRng(c.seed))) !== JSON.stringify(c.output));
    assert.ok(caught, "the shuffle vectors did not catch an ascending Fisher–Yates");
});

test("control: a bag without the round-boundary rotation is caught", () => {
    const naiveTurns = (roster, seed, count) => {
        const rng = seededRng(seed);
        const out = [];
        let queue = [];
        while (out.length < count) {
            if (queue.length === 0) queue = shuffled(roster, rng);
            out.push(queue.shift());
        }
        return out;
    };
    const caught = Object.entries(own.cases)
        .filter(([k]) => k.startsWith("turns_n"))
        .some(([, c]) => JSON.stringify(naiveTurns(c.roster, c.seed, c.count)) !== JSON.stringify(c.turns.map((t) => t.id)));
    assert.ok(caught, "the turns vectors did not catch a missing boundary rotation — add a seed where it fires");
});

test("control: rebuilding the queue on every membership change is caught", () => {
    const c = own.cases.turns_membership_change;
    const rng = seededRng(c.seed);
    const out = [];
    let members = [];
    let queue = [];
    let last = null;
    const refill = () => {
        queue = shuffled(members, rng);
        if (members.length > 1 && queue[0] === last) queue.push(queue.shift());
    };
    for (const step of c.steps) {
        if (step.setMembers) {
            members = step.setMembers.slice();
            refill(); // the mistake: always rebuild
        } else {
            for (let k = 0; k < step.take; k++) {
                if (queue.length === 0) refill();
                last = queue.shift();
                out.push(last);
            }
        }
    }
    assert.notDeepEqual(out, c.turns.map((t) => t.id));
});

// ── 4 · properties ───────────────────────────────────────────────────────────

test("equal counts every round, no repeat across a boundary", () => {
    for (let n = 1; n <= 12; n++) {
        for (const seed of [0, 1, 7, 99, 4242, 123456789, 4294967295]) {
            const t = turns(ids(n), seed, n * 40);
            for (let r = 0; r < 40; r++) {
                const round = t.slice(r * n, (r + 1) * n);
                assert.equal(new Set(round.map((x) => x.id)).size, n, `n=${n} seed=${seed} round ${r}`);
                assert.equal(round[0].roundStart, true);
                assert.ok(round.slice(1).every((x) => !x.roundStart));
                if (n > 1 && r > 0) assert.notEqual(round[0].id, t[r * n - 1].id);
            }
        }
    }
});

test("a lot admits distinct members of the roster, and refuses a bad count", () => {
    const roster = ids(20);
    for (const seed of [1, 2, 3, 4294967295]) {
        for (const admit of [0, 1, 5, 20, 25]) {
            const got = lot(roster, seed, admit);
            assert.equal(got.length, Math.min(admit, roster.length));
            assert.equal(new Set(got).size, got.length);
            assert.ok(got.every((id) => roster.includes(id)));
        }
    }
    assert.throws(() => lot(roster, 1, -1), RangeError);
    assert.throws(() => lot(roster, 1, 1.5), RangeError);
});

test("beacon and commitment inputs are validated", async () => {
    assert.throws(() => seedFromBeacon("b22aad47"), TypeError);
    assert.throws(() => seedFromBeacon("z".repeat(64)), TypeError);
    assert.throws(() => rosterCommitment(ids(3), "abcd"), TypeError);
    assert.throws(() => seedCommitment(1, ""), TypeError);
    const salt = newSalt();
    assert.match(salt, /^[0-9a-f]{64}$/);
    assert.notEqual(await seedCommitment(1, salt), await seedCommitment(2, salt));
    assert.equal(await rosterCommitment(ids(3), salt), await rosterCommitment(ids(3), salt.toUpperCase()));
    assert.notEqual(await rosterCommitment(["p0", "p1", "p2"], salt), await rosterCommitment(["p1", "p0", "p2"], salt));
});

test("the second stream is a LAGGED COPY, not an independent stream — pinned so nobody re-claims independence", () => {
    const seed = 0x083641a0;
    const a = seededRng(seed);
    const b = seededRng(secondStreamSeed(seed));
    const A = Array.from({ length: 1000 }, () => a());
    const B = Array.from({ length: 8200 }, () => b());
    for (let k = 0; k < 1000; k++) assert.equal(B[k + 7179], A[k], `k=${k}`);
});

test("the package ships no seed maker", async () => {
    const mod = await import("../dist/b-call.js");
    assert.equal(mod.newSeed, undefined, "a seed the operator picks is a choice — it must come from outside");
});
