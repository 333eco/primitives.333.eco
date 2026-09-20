import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { anchorFor, anchoredCurrencies } from "../dist/b-tag-anchor.js";

const coffee = { itemType: "coffee", currency: "KHR", posted: 4000 };

// ─────────────────────────────────────────────────────────────────────────────
// #63 — the directive this module exists to make CHECKABLE rather than promised.
// The test the directive itself names: *does the number change depending on who
// is looking?* Here that is answered by construction — there is nowhere to put a
// viewer — so these tests prove the construction rather than the intention.
// ─────────────────────────────────────────────────────────────────────────────

test("#63 · the signature takes ONE argument, and it is the goods", () => {
    assert.equal(anchorFor.length, 1);
});

test("#63 · viewer-shaped fields cannot move the number", () => {
    const plain = anchorFor(coffee);
    // Every one of these is a thing a per-person pricer would want. The function
    // has no parameter for them, so they ride along as ignored properties.
    const viewers = [
        { uid: "rich-kid", spendHistory: [50000, 90000], device: "iphone-15" },
        { uid: "poor-kid", spendHistory: [500], device: "feature-phone" },
        { auraScore: 0.99, givesGenerously: true, isTourist: true },
        { customerUid: "abc", label: "Thon", returning: true, visits: 41 }
    ];
    for (const v of viewers)
        assert.deepEqual(anchorFor({ ...coffee, ...v }), plain,
            `a viewer field moved the anchor: ${JSON.stringify(v)}`);
});

test("#63 · nothing derived from the cost basis reaches the output", () => {
    // A cost that is NOT a ladder rung, so if it leaked it would be unmistakable.
    const withCost = anchorFor({ ...coffee, cost: 1337 });
    assert.ok(withCost);
    const serialised = JSON.stringify(withCost);
    assert.ok(!serialised.includes("1337"),
        `the cost basis leaked into the output: ${serialised}`);
    // Reasons are CODES, never sentences and never figures.
    for (const r of withCost.reasons)
        assert.match(r, /^[a-z-]+$/, `a reason was not a code: ${r}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Determinism — what makes a recommendation arguable with, months later.
// ─────────────────────────────────────────────────────────────────────────────

test("deterministic across repeated calls", () => {
    const goods = { ...coffee, prep: 8, hour: 16, closingHour: 18, cost: 600, stockLeft: 3 };
    const first = anchorFor(goods);
    for (let i = 0; i < 500; i++) assert.deepEqual(anchorFor(goods), first);
});

test("no clock and no RNG in the source", () => {
    // ⚠️ SCAN THE CODE, NOT THE COMMENTS. The first draft of this test failed on the module's own
    //    sentence "`hour` is an argument, never Date.now()" — a probe firing on its own cure, which
    //    is the third distinct shape of that mistake recorded while building this module. A checker
    //    that cannot tell a mention from a call is not checking what it claims to.
    const raw = readFileSync(new URL("../dist/b-tag-anchor.js", import.meta.url), "utf8");
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of ["Date", "Math.random", "crypto", "fetch", "process.env"])
        assert.ok(!src.includes(forbidden), `the module reached for ${forbidden}`);
    // ⭐ And the control: the stripper must not simply be eating everything.
    assert.ok(src.includes("anchorFor"), "comment-stripping removed the code itself");
});

test("CONTROL · the clock test can fail", () => {
    const withClock = 'export function f(){ return Date.now(); }';
    const stripped = withClock.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(stripped.includes("Date"),
        "the stripped-source check cannot see a real clock call — the real test proves nothing");
});

// ─────────────────────────────────────────────────────────────────────────────
// The anchor itself
// ─────────────────────────────────────────────────────────────────────────────

test("the amount is ALWAYS a rung of the ladder", () => {
    // A wide sweep, including inputs a shop could set carelessly or dishonestly.
    for (const prep of [undefined, 0, 4, 5, 11, 12, 90])
        for (const cost of [undefined, 1, 600, 1337, 999999])
            for (const posted of [undefined, 300, 1000, 4000, 100000])
              for (const regionalTypical of [undefined, 800, 90000])
                for (const hour of [undefined, 6, 17])
                    for (const stockLeft of [undefined, 0, 2, 50]) {
                        const a = anchorFor({ itemType: "coffee", currency: "KHR",
                            prep, cost, posted, regionalTypical, hour, closingHour: 18, stockLeft });
                        assert.ok(a, "KHR must always answer");
                        assert.ok(a.ladder.includes(a.amount),
                            `${a.amount} is not a rung of ${a.ladder}`);
                    }
});

test("⛔ an unanswerable currency is an ABSENCE, never a zero", () => {
    assert.equal(anchorFor({ itemType: "coffee", currency: "XYZ" }), null);
    assert.equal(anchorFor({ itemType: "coffee", currency: "USD" }), null);
    assert.ok(anchoredCurrencies().includes("KHR"));
});

test("⛔ end-of-day moves the anchor DOWN, never up", () => {
    const midday = anchorFor({ ...coffee, hour: 10, closingHour: 18 });
    const late = anchorFor({ ...coffee, hour: 17, closingHour: 18 });
    assert.ok(late.amount <= midday.amount,
        "the last of the pot must not be anchored higher than a fresh one");
    assert.ok(late.reasons.includes("end-of-day"));
});

test("⛔ scarcity moves the anchor DOWN too — it is not a nudge", () => {
    const plenty = anchorFor({ ...coffee, stockLeft: 40 });
    const scarce = anchorFor({ ...coffee, stockLeft: 1 });
    assert.ok(scarce.amount <= plenty.amount,
        "nearly-gone must never read as 'pay more, it's running out'");
});

test("effort moves it up, and the lift is CAPPED", () => {
    const quick = anchorFor({ ...coffee, prep: 1 });
    const slow = anchorFor({ ...coffee, prep: 12 });
    const absurd = anchorFor({ ...coffee, prep: 6000 });
    assert.ok(slow.amount >= quick.amount);
    assert.equal(absurd.amount, slow.amount,
        "an uncapped prep field would let a shop inflate every suggestion by editing one number");
});

test("⚠️ gaming the cost basis is BOUNDED — measured, not assumed", () => {
    const honest = anchorFor({ ...coffee, cost: 400 });
    const inflated = anchorFor({ ...coffee, cost: 999999 });
    const rungs = honest.ladder;
    const moved = rungs.indexOf(inflated.amount) - rungs.indexOf(honest.amount);
    // It is bounded by the ladder, not prevented. Record the real bound so a later
    // change that widens it fails here instead of shipping quietly.
    assert.ok(moved <= rungs.length - 1, "the cost floor escaped the ladder");
    assert.equal(inflated.amount, rungs[rungs.length - 1],
        "an absurd cost should clamp to the top rung, never past it");
});

test("reasons are present whenever a factor actually fired", () => {
    const bare = anchorFor({ itemType: "coffee", currency: "KHR" });
    assert.deepEqual(bare.reasons, [], "a bare item should claim no reasons it does not have");
    const reasoned = anchorFor({ ...coffee, prep: 14 });
    assert.ok(reasoned.reasons.includes("share-of-price"));
    assert.ok(reasoned.reasons.includes("takes-time"));
});

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ THE CONTROLS. This repo's rule: break it on purpose before trusting a green
// suite. Each of these asserts that the check ABOVE it can actually fail — a
// suite that has only ever passed is an untested claim wearing a result's clothes.
// ─────────────────────────────────────────────────────────────────────────────

test("CONTROL · the viewer-blindness test can fail", () => {
    // A stand-in that DOES key to the viewer, run through the same comparison.
    const leaky = (g) => ({ amount: g.uid === "rich-kid" ? 5000 : 500, reasons: [], ladder: [500, 5000] });
    const plain = leaky({ ...coffee });
    assert.notDeepEqual(leaky({ ...coffee, uid: "rich-kid" }), plain,
        "the comparison used above cannot detect a viewer-keyed function — the real test proves nothing");
});

test("CONTROL · the cost-leak test can fail", () => {
    const leaky = { amount: 1000, reasons: ["cost was 1337"], ladder: [] };
    assert.ok(JSON.stringify(leaky).includes("1337"),
        "the substring check cannot see a leaked cost — the real test proves nothing");
});

test("CONTROL · the ladder test can fail", () => {
    const offLadder = { amount: 1337, ladder: [500, 1000] };
    assert.ok(!offLadder.ladder.includes(offLadder.amount),
        "the ladder check cannot see an off-ladder amount — the real test proves nothing");
});

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️⚠️ THE BUG 1.2.0 SHIPPED WITH, pinned so it cannot come back. That version
// anchored AT a posted price, which on a 4,000៛ coffee would have suggested
// thanking 4,000៛ — the entire bill, a second time, on the one screen whose
// whole argument is that nothing is owed. Caught before any surface called it.
// ─────────────────────────────────────────────────────────────────────────────

test("⛔⛔ a thanks is a FRACTION of the price, never the price", () => {
    for (const posted of [1000, 3000, 4000, 5000, 15000, 22000]) {
        const a = anchorFor({ itemType: "coffee", currency: "KHR", posted });
        assert.ok(a.amount < posted,
            `anchored ${a.amount} on an item costing ${posted} — that is the bill again`);
        assert.ok(a.amount <= posted * 0.5,
            `anchored ${a.amount} on ${posted}: over half the bill is not a thanks`);
    }
});

test("the artboard's own case lands where the artboard drew it", () => {
    // 4,000៛ Iced Americano → the middle chip, which is what the walkthrough showed.
    const a = anchorFor({ itemType: "coffee", currency: "KHR", posted: 4000 });
    assert.equal(a.amount, 1000);
    assert.ok(a.reasons.includes("share-of-price"));
});

test("⭐ a B-Tag has no posted number, so the anchor stays modest", () => {
    const a = anchorFor({ itemType: "coffee", currency: "KHR" });
    assert.ok(a.amount <= 1000,
        "with nothing behind it a suggestion should be small, not confident");
    assert.deepEqual(a.reasons, []);
});

test("CONTROL · the fraction test can fail", () => {
    const atPrice = { amount: 4000 };
    assert.ok(!(atPrice.amount < 4000),
        "the comparison cannot see an anchor set AT the price — the real test proves nothing");
});
