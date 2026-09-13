// B-Called℠ — the reference implementation of the called draw.
//
// A called draw decides whose turn it is, or who is admitted when a thing is
// oversubscribed, WITHOUT ANYONE CHOOSING. The result is a pure function of two
// inputs: a roster committed before the seed can be known, and a seed from a
// source that no party to the draw controls. Anyone holding both can recompute
// the result with this file, or with SPEC.md and no code at all.
//
// The mechanism is CC0 and unmarked; implement it under any name. B-Called℠ names
// this implementation and its conformance vectors — a third party may truthfully
// say its own implementation "passes the B-Called℠ vectors".
//
// Three things in here must survive any refactor:
//
//   1. BIT-IDENTICAL OUTPUT. The generator, the shuffle and the bag were lifted
//      unchanged from sey's caller (published as @333eco/sey@1.0.0), and the
//      test suite checks this file against THOSE vectors before its own. A draw
//      that changes for a seed already used is a broken promise to everyone who
//      recorded one. Version the seed, never the algorithm.
//
//   2. NO WEIGHTS. Nothing here accepts a score, a rank, a history or a
//      preference. If a surface needs one, it is not turn-shaped, and this is
//      the wrong primitive for it — not a primitive to extend.
//
//   3. NO SEED MAKER. There is deliberately no newSeed() here. A seed the
//      operator picks after seeing the roster is a choice with extra steps: try
//      seeds until the order suits, and the recomputation still checks out. The
//      seed has to come from outside — a public beacon round named when the
//      roster is committed (seedFromBeacon), or a salted commit–reveal
//      (seedCommitment) held by someone who controls neither the roster nor its
//      timing. A surface whose only stake is play order, and which must work
//      offline, may seed locally — that is its decision, made in its own code,
//      not a convenience offered here.
//
// ⚠️ SCOPE OF v1 (SPEC.md §10). This is the sey-compatible form and can never
// change. It is sound for play order and for PUBLIC draws over a fixed roster
// with a beacon seed. It is NOT sufficient for the sealed regime (no secret can
// be combined with a beacon here) or for a recurring benefit with a live roster
// (membership changes steer the next shuffle). A v2 is a new seed version.

export type Rng = () => number;

/**
 * mulberry32. State is 32 bits and every operation wraps at 32 bits; the
 * returned double is exact (an integer below 2³² over a power of two).
 */
export function seededRng(seed: number): Rng {
    let a = seed | 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Fisher–Yates, DESCENDING. Ascending, or drawing j before i, diverges at once. */
export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

/** The golden-ratio constant sey XORs into a seed for its second stream — a lagged copy, not an independent one (see below). */
export const STREAM_SALT = 0x9e3779b9;

/**
 * The seed of sey's second stream (its relay callers beside its receivers). The
 * XOR is on unsigned 32 bits. ⚠️ NOT an independent stream: mulberry32's state is
 * a Weyl sequence, so this is the first stream shifted by a seed-dependent number
 * of draws, at least 7,179 for every seed. Fine for a circle; never for two long
 * sequences that must be uncorrelated.
 */
export function secondStreamSeed(seed: number): number {
    return (seed ^ STREAM_SALT) >>> 0;
}

/**
 * The TURN form. Deals every member exactly once per round, in an order nobody
 * can predict, reshuffling at the boundary and refusing to repeat across it.
 * Equal counts are structural, not statistical: a streak of bad luck is
 * impossible rather than unlikely.
 */
export class Bag {
    private queue: string[] = [];
    private last: string | null = null;
    private members: string[] = [];
    private fresh = false;
    private opened = false;

    constructor(private readonly rng: Rng) {}

    /** Whether the id most recently returned by take() opened a fresh round. */
    get startedRound(): boolean {
        return this.opened;
    }

    /** How many turns remain before the round closes. */
    get remaining(): number {
        return this.queue.length;
    }

    /**
     * Replace the membership. Surviving queue order is PRESERVED and the bag only
     * refills when the queue empties — rebuilding on every change consumes the
     * generator differently and diverges. Order of `ids` matters: the shuffle is
     * over positions, so a differently ordered roster is a different draw.
     */
    setMembers(ids: readonly string[]): void {
        this.members = ids.slice();
        this.queue = this.queue.filter((id) => this.members.includes(id));
        if (this.queue.length === 0) this.refill();
    }

    private refill(): void {
        if (this.members.length === 0) {
            this.queue = [];
            return;
        }
        this.queue = shuffled(this.members, this.rng);
        this.fresh = true;
        // The one case a shuffle cannot rule out: the same member closing one
        // round and opening the next. A ROTATION, not a swap.
        if (this.members.length > 1 && this.queue[0] === this.last) {
            this.queue.push(this.queue.shift()!);
        }
    }

    take(): string | null {
        if (this.members.length === 0) return null;
        if (this.queue.length === 0) this.refill();
        this.opened = this.fresh;
        this.fresh = false;
        const id = this.queue.shift()!;
        this.last = id;
        return id;
    }
}

export interface Turn {
    id: string;
    /** True on the turn that opens a round. */
    roundStart: boolean;
}

/** The first `count` turns of a fixed roster under `seed`. */
export function turns(roster: readonly string[], seed: number, count: number): Turn[] {
    assertCount(count, "count");
    const bag = new Bag(seededRng(seed));
    bag.setMembers(roster);
    const out: Turn[] = [];
    for (let k = 0; k < count; k++) {
        const id = bag.take();
        if (id === null) break;
        out.push({ id, roundStart: bag.startedRound });
    }
    return out;
}

/**
 * The LOT form. Admits `admit` members of an oversubscribed roster: the first
 * `admit` of one descending Fisher–Yates shuffle, returned in draw order. If
 * `admit` is at least the roster size, everyone is admitted, still in draw order.
 */
export function lot(roster: readonly string[], seed: number, admit: number): string[] {
    assertCount(admit, "admit");
    return shuffled(roster, seededRng(seed)).slice(0, admit);
}

/**
 * The seed from a public randomness beacon round: the first four bytes of the
 * round's randomness, big-endian. For drand that is the `randomness` field — 64
 * hex characters. Name the round when the roster is committed, so that nobody
 * can know the seed while the roster can still change.
 */
export function seedFromBeacon(randomnessHex: string): number {
    if (!/^[0-9a-fA-F]{64,}$/.test(randomnessHex) || randomnessHex.length % 2 !== 0) {
        throw new TypeError("beacon randomness must be at least 32 bytes of hex");
    }
    return parseInt(randomnessHex.slice(0, 8), 16) >>> 0;
}

/**
 * A commitment to an ORDERED roster, published before the seed exists. The salt
 * keeps a member who knows the roster from confirming it, and — in the sealed
 * regime, where the roster is private — from locating their own position.
 */
export function rosterCommitment(roster: readonly string[], salt: string): Promise<string> {
    assertSalt(salt);
    return sha256Hex(`called-draw/v1/roster\n${salt.toLowerCase()}\n${JSON.stringify(roster)}`);
}

/**
 * The fallback where no beacon is reachable: publish this before the roster
 * closes, reveal `seed` and `salt` after. The salt is mandatory — a 32-bit seed
 * behind a bare hash is recovered by brute force in seconds, which would reveal
 * a sealed order early.
 */
export function seedCommitment(seed: number, salt: string): Promise<string> {
    assertSalt(salt);
    return sha256Hex(`called-draw/v1/seed\n${salt.toLowerCase()}\n${seed >>> 0}`);
}

/** 32 random bytes as hex, from the platform's cryptographic generator. */
export function newSalt(): string {
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    return toHex(bytes);
}

function assertSalt(salt: string): void {
    if (!/^[0-9a-fA-F]{32,}$/.test(salt) || salt.length % 2 !== 0) {
        throw new TypeError("salt must be at least 16 bytes of hex");
    }
}

function assertCount(n: number, name: string): void {
    if (!Number.isInteger(n) || n < 0) throw new RangeError(`${name} must be a non-negative integer`);
}

async function sha256Hex(text: string): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) s += b.toString(16).padStart(2, "0");
    return s;
}
