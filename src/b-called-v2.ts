// B-Called℠ v2 — the called draw for draws that are WORTH SOMETHING.
//
// v1 (./b-called.ts) is bound byte-for-byte to sey's published caller and can never
// change. It is sound for play order and for public draws over a fixed roster. A
// prior-art census and counterexample hunt (2026-09-13) showed what it cannot do,
// and every item below answers one of those findings. SPEC.md Part II is normative.
//
//   1. THE DRAW COMES FROM THE WHOLE BEACON OUTPUT. HMAC-SHA-256 in counter mode
//      over a key derived from the commitment, the beacon round's randomness and
//      the salt; indices by rejection sampling. No 32-bit state, so no seed to
//      recover from a few observed turns, no position gradient, no lagged streams.
//      The platform's Web Crypto does the hashing — nothing here rolls its own.
//
//   2. ONE COMMITMENT BINDS EVERYTHING THAT COULD OTHERWISE BE CHOSEN LATE: the
//      beacon network, the round, the draw's id, its form and regime, the salt, the
//      ordered roster, and — for a turn — the previous round's closer, for a lot —
//      how many are admitted. A tier boundary picked after the order is known is a
//      choice; here it is fixed before the seed exists.
//
//   3. THE ROSTER IS FROZEN PER ROUND. A season is a chain of rounds, each with its
//      own commitment and its own beacon round named at that round's cutoff. A
//      member who is absent when their turn comes is a recorded SKIP — the turn
//      lapses — never a removal from the shuffle input. That closes the v1 hole in
//      which whoever was present at a refill steered the next order.
//
//   4. THE REGIME IS DISCLOSURE, NOT ALGORITHM. Public and sealed draws compute the
//      same way. Public: publish the salt and roster with the commitment. Sealed:
//      publish only the commitment; the salt (and roster) are revealed at the reset.
//      Because the salt is inside the key, a public beacon value does not reveal a
//      sealed order, and because the beacon round is future at commit time, the salt
//      holder cannot grind it.
//
//   5. THE BOUNDARY RULE KEEPS POSITIONS UNIFORM. If a round would open with the
//      previous round's closer, that opener is SWAPPED with a uniformly drawn later
//      position. The result is exactly uniform over the orders that do not open
//      with the closer — v1's rotation made the closer close again at 2/n.
//
// NOT here, deliberately: a seed maker (the seed is the beacon), weights of any
// kind, and time-lock encryption (it would add five runtime dependencies; the spec
// gives the procedure and this module verifies whatever is revealed).

export type Form = "turn" | "lot";
export type Regime = "public" | "sealed";

export interface Chain {
    /** The beacon network's chain hash, hex. */
    hash: string;
    /** Unix seconds of round 1. */
    genesisTime: number;
    /** Seconds between rounds. */
    period: number;
    scheme: string;
}

/** drand quicknet (League of Entropy) — unchained, a round every 3 seconds. */
export const QUICKNET: Readonly<Chain> = Object.freeze({
    hash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
    genesisTime: 1692803367,
    period: 3,
    scheme: "bls-unchained-g1-rfc9380"
});

export interface DrawInput {
    /** Beacon chain hash, hex. */
    network: string;
    /** The beacon round named at commit time — it must not yet have been emitted. */
    round: number;
    /** Unique per draw. One commitment per id; the first one published binds. */
    drawId: string;
    form: Form;
    regime: Regime;
    /** At least 32 bytes of hex. Public: published with the commitment. Sealed: revealed at the reset. */
    salt: string;
    /** Ordered, unique, non-empty identifiers, frozen for this round. */
    roster: readonly string[];
    /** Turn form only: the final id of the previous round's committed order, or null for a first round. */
    previousLast?: string | null;
    /** Lot form only: how many are admitted. Bound before the seed exists. */
    admit?: number;
}

export interface Draw {
    commitment: string;
    /** The full order. For a lot, the admitted are its first `admit`; the rest is the waiting list, in order. */
    order: string[];
    /** Lot form only. */
    admitted?: string[];
    /** Turn form only: whether the boundary rule swapped the previous closer out of first place. */
    boundarySwapped?: boolean;
}

// Byte arrays backed by a plain ArrayBuffer — what Web Crypto accepts.
type Bytes = Uint8Array<ArrayBuffer>;

const TEXT = new TextEncoder();

/** The commitment: publish it BEFORE the round is emitted. */
export async function commit(input: DrawInput): Promise<string> {
    validate(input);
    return hex(await sha256(encodeCommitment(input)));
}

/**
 * The draw, once the named round's randomness is published. Recomputes the
 * commitment rather than trusting one, so a caller cannot draw against inputs
 * that differ from what they committed.
 */
export async function draw(input: DrawInput, randomness: string): Promise<Draw> {
    validate(input);
    assertHex(randomness, 32, "beacon randomness");
    const commitment = hex(await sha256(encodeCommitment(input)));
    const key = await sha256(concat(str("b-called/v2/key"), field(fromHex(commitment)), field(fromHex(randomness)), field(fromHex(input.salt))));
    const next = await stream(key, "order");
    const order = input.roster.slice();
    for (let i = order.length - 1; i > 0; i--) {
        const j = await uniformIndex(next, i + 1);
        [order[i], order[j]] = [order[j], order[i]];
    }
    let boundarySwapped = false;
    if (input.form === "turn" && input.previousLast != null && order.length > 1 && order[0] === input.previousLast) {
        const j = 1 + (await uniformIndex(next, order.length - 1));
        [order[0], order[j]] = [order[j], order[0]];
        boundarySwapped = true;
    }
    const out: Draw = { commitment, order };
    if (input.form === "lot") out.admitted = order.slice(0, input.admit!);
    else out.boundarySwapped = boundarySwapped;
    return out;
}

/**
 * The recomputation tool's core: given the commitment that was published, the
 * inputs revealed, and the round's randomness, return the draw — or throw if the
 * revealed inputs are not the ones that were committed.
 */
export async function verify(publishedCommitment: string, input: DrawInput, randomness: string): Promise<Draw> {
    const d = await draw(input, randomness);
    if (d.commitment !== publishedCommitment.toLowerCase()) {
        throw new Error("revealed inputs do not match the published commitment");
    }
    return d;
}

/** Unix seconds at which `round` is emitted. A commitment must be published before this. */
export function roundTime(chain: Chain, round: number): number {
    assertRound(round);
    return chain.genesisTime + (round - 1) * chain.period;
}

/** The round current at `unixSeconds`. Name a round well after this when committing. */
export function roundAt(chain: Chain, unixSeconds: number): number {
    return Math.floor((unixSeconds - chain.genesisTime) / chain.period) + 1;
}

/**
 * For drand's unchained schemes, `randomness` is SHA-256 of `signature`. This checks
 * that CONSISTENCY only. It is not authenticity — that needs BLS verification
 * against the chain's public key, which this module does not do.
 */
export async function randomnessMatchesSignature(randomness: string, signature: string): Promise<boolean> {
    assertHex(signature, 1, "signature");
    return hex(await sha256(fromHex(signature))) === randomness.toLowerCase();
}

/** 32 random bytes as hex. A salt, never a seed: the seed is the beacon. */
export function newSalt(): string {
    const b = new Uint8Array(32);
    globalThis.crypto.getRandomValues(b);
    return hex(b);
}

/** The first `count` uint32 values of a named stream under a 32-byte key — exported for conformance testing. */
export async function streamUint32(keyHex: string, label: string, count: number): Promise<number[]> {
    assertHex(keyHex, 32, "key");
    const next = await stream(fromHex(keyHex), label);
    const out: number[] = [];
    for (let k = 0; k < count; k++) out.push(await next());
    return out;
}

/**
 * A uniform integer in [0, m) by rejection: values at or above the largest multiple
 * of m below 2³² are discarded. Exported so the rejection path can be tested with
 * a scripted stream — a real stream almost never exercises it.
 */
export async function uniformIndex(next: () => Promise<number>, m: number): Promise<number> {
    if (!Number.isInteger(m) || m < 1 || m > 0x100000000) throw new RangeError("m must be an integer in [1, 2^32]");
    const limit = 0x100000000 - (0x100000000 % m);
    for (;;) {
        const x = await next();
        if (x < limit) return x % m;
    }
}

// ── encoding ─────────────────────────────────────────────────────────────────
// The domain tags carry the implementation's name (`b-called/v2/…`), for consistency with
// the module paths. ⛔ They are PROTOCOL CONSTANTS, not uses of the mark: once published they
// never change. If the mark is ever re-seated after counsel, these stay as a historical
// identifier — the estate's repo-name precedent — and a change would be a new version.
// Every field is length-prefixed (u32 big-endian, then bytes), so no two different
// inputs share an encoding and a port needs no JSON or text-escaping rules.

function encodeCommitment(i: DrawInput): Bytes {
    return concat(
        str("b-called/v2/commitment"),
        str(i.network.toLowerCase()),
        u64(i.round),
        str(i.drawId),
        str(i.form),
        str(i.regime),
        field(fromHex(i.salt)),
        list(i.roster),
        str(i.form === "turn" ? (i.previousLast ?? "") : ""),
        u32(i.form === "lot" ? i.admit! : 0)
    );
}

async function stream(key: Bytes, label: string): Promise<() => Promise<number>> {
    const streamKey = await hmac(key, concat(str("b-called/v2/stream"), str(label)));
    let counter = 0;
    let block = new Uint8Array(0);
    let offset = 32;
    return async () => {
        if (offset >= 32) {
            block = await hmac(streamKey, u64(counter++));
            offset = 0;
        }
        const x = ((block[offset] << 24) | (block[offset + 1] << 16) | (block[offset + 2] << 8) | block[offset + 3]) >>> 0;
        offset += 4;
        return x;
    };
}

function validate(i: DrawInput): void {
    assertHex(i.network, 32, "network");
    assertRound(i.round);
    if (typeof i.drawId !== "string" || i.drawId.length === 0) throw new TypeError("drawId must be a non-empty string");
    if (i.form !== "turn" && i.form !== "lot") throw new TypeError("form must be turn or lot");
    if (i.regime !== "public" && i.regime !== "sealed") throw new TypeError("regime must be public or sealed");
    assertHex(i.salt, 32, "salt");
    if (!Array.isArray(i.roster) || i.roster.length === 0) throw new TypeError("roster must be a non-empty array");
    const seen = new Set<string>();
    for (const id of i.roster) {
        if (typeof id !== "string" || id.length === 0) throw new TypeError("roster ids must be non-empty strings");
        // A duplicate is an extra turn. One entry per principal is the caller's
        // guard; refusing a duplicate id is this module's.
        if (seen.has(id)) throw new TypeError(`duplicate roster id: ${id}`);
        seen.add(id);
    }
    if (i.form === "turn") {
        if (i.admit !== undefined) throw new TypeError("admit belongs to the lot form");
        if (i.previousLast != null && (typeof i.previousLast !== "string" || i.previousLast.length === 0)) {
            throw new TypeError("previousLast must be a non-empty string or null");
        }
    } else {
        if (i.previousLast != null) throw new TypeError("previousLast belongs to the turn form");
        if (!Number.isInteger(i.admit) || i.admit! < 0 || i.admit! > 0xffffffff) {
            throw new RangeError("a lot needs admit, a non-negative integer");
        }
    }
}

function assertRound(round: number): void {
    if (!Number.isSafeInteger(round) || round < 1) throw new RangeError("round must be a positive safe integer");
}

function assertHex(h: string, minBytes: number, name: string): void {
    if (typeof h !== "string" || h.length % 2 !== 0 || h.length < minBytes * 2 || !/^[0-9a-fA-F]*$/.test(h)) {
        throw new TypeError(`${name} must be at least ${minBytes} bytes of hex`);
    }
}

function str(s: string): Bytes {
    return field(TEXT.encode(s));
}

function field(b: Bytes): Bytes {
    return concat(u32(b.length), b);
}

function list(ids: readonly string[]): Bytes {
    return concat(u32(ids.length), ...ids.map(str));
}

function u32(n: number): Bytes {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n >>> 0);
    return b;
}

function u64(n: number): Bytes {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, BigInt(n));
    return b;
}

function concat(...parts: Bytes[]): Bytes {
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of parts) {
        out.set(p, o);
        o += p.length;
    }
    return out;
}

function fromHex(h: string): Bytes {
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
    return out;
}

function hex(b: Bytes): string {
    let s = "";
    for (const x of b) s += x.toString(16).padStart(2, "0");
    return s;
}

async function sha256(data: Bytes): Promise<Bytes> {
    return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", data));
}

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
    const k = await globalThis.crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", k, data));
}
