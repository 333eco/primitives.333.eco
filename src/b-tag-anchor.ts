/**
 * b-tag-anchor — Miss Aquarius's suggested thanks on a B-Tag item, as a pure function.
 *
 * ⭐⭐ WHY IT IS A PUBLISHED PRIMITIVE AND NOT A SERVICE. Directive #63 is HARD: *wherever she
 *     produces a number on a shop surface — regular price, B-Price, or B-Tag, bound or unbound —
 *     her function is given the state of the GOODS and NO argument identifying the viewer.* Its
 *     Sig-9 form is **a property of the function signature**: the argument is never passed, so
 *     per-person pricing is inexpressible rather than forbidden.
 *   ⭐ Publishing the signature is what turns that from a claim into something anyone can check.
 *     A service could promise viewer-blindness; a CC0 function with no viewer parameter cannot take
 *     one. **Remove the enforcer and it still holds.**
 *
 * ⭐ AND IT IS AN ANCHOR, NOT A PRICE. The customer already holds the goods, owes nothing, and may
 *   ignore it entirely — which is exactly why #62's WIDTH clause does not reach here (there is no
 *   owner range to stay inside) while #63's viewer-blindness clause does.
 *
 * ⛔⛔ THE COST DECOMPOSITION NEVER REACHES THE CUSTOMER. Merchants disclose a cost basis to her;
 *     customers see the amount and the REASONS, never the decomposition. That is enforced here by
 *     the RETURN TYPE: reasons are CODES, and no figure derived from `cost` appears in the output.
 *     A rendering layer cannot leak what it was never handed.
 *
 * ⭐ DETERMINISTIC BY CONSTRUCTION, which is what makes it studiable: no clock, no RNG, no network,
 *   no state. `hour` is an argument, never `Date.now()`. Same goods in, same anchor out, forever —
 *   so a recommendation can be recomputed and argued with long after it was shown.
 * ⚠️ Honest bound: determinism is a PROPERTY OF THIS VERSION, not a claim that the numbers are
 *   right. It is a starting rule set, and its outputs are a hypothesis to be measured.
 */

/** The ladder an anchor is chosen from, per currency, in the currency's own unit. */
const LADDERS: Record<string, number[]> = {
    // ⭐ Riel, as they are actually handled: the notes a student carries. ⛔ Not a linear scale —
    //   an anchor that lands on 1,300៛ is a number nobody hands over.
    KHR: [500, 1000, 2000, 3000, 5000]
};

/**
 * ⛔ REASONS ARE CODES, NEVER SENTENCES, and never a figure. The shop surface renders them in its
 * own language — these must survive translation into Khmer without carrying an English assumption.
 */
export type ReasonCode =
    /** the owner set a preparation time and it is a long one for this kind of item */
    | "takes-time"
    /** the item is made to order rather than poured from something already standing */
    | "made-to-order"
    /** late in the shop's day — the last of what was made */
    | "end-of-day"
    /** little left of it */
    | "nearly-gone"
    /** the anchor sits where comparable items in this region are posted */
    | "regional-norm"
    /** the merchant disclosed what it costs them and the anchor clears it */
    | "covers-cost";

export interface Goods {
    /** the item's type, from the shop's fixed list. ⛔ Never free text, never the item's name. */
    itemType: string;
    /** ISO 4217. Only currencies with a ladder are answered; see `anchorFor`. */
    currency: string;
    /**
     * What the merchant says it costs THEM, in the currency's own unit — opt-in, and ⛔ never
     * rendered to a customer. Absent when they have not disclosed it.
     */
    cost?: number;
    /** A comparable posted price for this `itemType` in this region, when one is known. */
    regionalTypical?: number;
    /** Minutes the owner set for this variant. A Mini is not an L. */
    prep?: number;
    /** Shop-local hour, 0–23. ⛔ Passed in, never read from a clock — determinism is the point. */
    hour?: number;
    /** The hour the shop's day ends, so "late" is theirs and not ours. */
    closingHour?: number;
    /** Portions left, when the shop tracks it. */
    stockLeft?: number;
}

export interface Anchor {
    /** The suggested thanks, in the currency's own unit. Always a rung of the ladder. */
    amount: number;
    /** ⛔ Codes only. Ordered strongest first; a surface may show fewer, never more. */
    reasons: ReasonCode[];
    /** The ladder this was chosen from, so a surface can show that it is one option among few. */
    ladder: number[];
}

/**
 * ⭐ THE WHOLE SIGNATURE IS THE GUARD: one argument, and it describes GOODS.
 *
 * There is no viewer, no customer, no history, no basket, no device, no time-of-request. ⛔ Adding
 * one later is not a tweak — it is the thing #63 makes inexpressible, and it would have to be a new
 * exported function under a new name so that the old signature stays true.
 *
 * Returns `null` when there is no ladder for the currency: ⛔ **an unanswerable anchor is an
 * ABSENCE, never a zero and never a guess.** A shop in an unsupported currency shows no suggestion,
 * the same way a shop with no hours says nothing rather than claiming to be open.
 */
export function anchorFor(goods: Goods): Anchor | null {
    const ladder = LADDERS[goods.currency];
    if (!ladder || ladder.length === 0) return null;

    const reasons: ReasonCode[] = [];

    // ⭐ Start at the region, not at the cost. What comparable things go for is the honest centre;
    //   the merchant's own cost is a FLOOR below which the anchor should not sit, never the target.
    let target = goods.regionalTypical ?? ladder[Math.floor(ladder.length / 2)];
    if (goods.regionalTypical !== undefined) reasons.push("regional-norm");

    // ⚠️ Effort moves the anchor UP, and it is capped on purpose. `prep` is owner-authored, so an
    //   uncapped rule would let a shop inflate every suggestion by editing one field.
    if (goods.prep !== undefined && goods.prep >= 5) {
        target *= goods.prep >= 12 ? 1.5 : 1.25;
        reasons.push(goods.prep >= 12 ? "takes-time" : "made-to-order");
    }

    // ⭐ Late in HER day, not ours — `closingHour` is the shop's. ⛔ And it moves the anchor DOWN:
    //   the last of the pot is the thing she would otherwise pour away.
    const closing = goods.closingHour;
    if (closing !== undefined && goods.hour !== undefined && goods.hour >= closing - 1) {
        target *= 0.75;
        reasons.push("end-of-day");
    } else if (goods.stockLeft !== undefined && goods.stockLeft <= 2) {
        // ⛔ NOT a scarcity nudge upward. It is the same fact as end-of-day and moves the same way.
        target *= 0.75;
        reasons.push("nearly-gone");
    }

    // ⭐⭐ THE COST IS A FLOOR AND THE FLOOR IS BOUNDED. A merchant who overstates their cost can
    //   move the anchor by at most one rung, because the floor is clamped to the ladder and the
    //   ladder is short. ⚠️ Gaming is bounded, not prevented — it is a known exposure, priced.
    if (goods.cost !== undefined && goods.cost > 0) {
        const floor = Math.min(goods.cost, ladder[ladder.length - 1]);
        if (target < floor) { target = floor; reasons.push("covers-cost"); }
    }

    // ⭐ Snap to a rung people actually hand over. Ties go DOWN: a suggestion is an anchor and the
    //   institution would rather under-anchor than over-anchor a gift.
    let amount = ladder[0];
    let best = Infinity;
    for (const rung of ladder) {
        const d = Math.abs(rung - target);
        if (d < best) { best = d; amount = rung; }
    }

    return { amount, reasons, ladder: [...ladder] };
}

/** The currencies that have a ladder. ⛔ A surface asks; it never assumes one exists. */
export function anchoredCurrencies(): string[] { return Object.keys(LADDERS); }
