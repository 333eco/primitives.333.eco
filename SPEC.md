# The called draw — a recomputable contract

_This document and the conformance vectors beside it are CC0. Implement the
mechanism under any name, in any language; no permission is needed and none can
be withheld. **B-Call℠** names one implementation of it — the reference in
`src/b-call.ts` — and those vectors. Anyone may truthfully say their own
implementation "passes the B-Call℠ vectors."_

A **called draw** decides whose turn it is, or who is admitted when a thing is
oversubscribed, **without anyone choosing**. The result is a pure function of
two inputs:

1. a **roster** — an ordered list of identifiers — **committed before the seed
   can be known**, and
2. a **seed** from a source **no party to the draw controls**.

Anyone holding both can recompute the result. That is the whole point: a
rotation only its operator can compute is indistinguishable from a ranking its
operator declines to describe, and the difference between the two is exactly
what recomputation makes visible.

**This document is normative. Do not reimplement from reading the TypeScript.**
Sections 1–3 are lifted unchanged from sey's caller contract (`@333eco/sey`,
`caller-spec.md`, published 2026-09-01), and the test suite checks the reference
against that package's vectors before its own.

---

## 0. The invariants

| Invariant | What it rules out |
| --- | --- |
| **Determined.** Output = f(roster, seed), recomputable by a stranger. | An operator's discretion, however well described. |
| **No weights.** Nothing enters but the roster and the seed. | Scores, ranks, histories, preferences, bids-as-priority. A surface that needs one is not turn-shaped. |
| **Commit before the seed.** The roster is fixed while the seed is still unknowable. | Trying seeds until the order suits. |
| **External seed.** A beacon round named at commit, or a salted commit–reveal. | A seed the operator picks after seeing the roster. |
| **The regime is a property of the surface** (§7). | Publishing an order that would identify someone who must stay anonymous — or sealing one that the participant is entitled to know. |

Two things this contract does **not** decide, and a surface must decide them
itself: **who is admitted to the roster** (a draw over a stuffed roster is a
fair draw over the wrong people), and **whether a turn can be stored** (a turn
that can be banked, deferred, transferred or bought grows a secondary market —
make it consumed-or-lapsed).

## 1. The generator — mulberry32

State is a **32-bit** integer. Every operation wraps at 32 bits.

```
function seededRng(seed):
    a := int32(seed)
    on each call:
        a := int32(a + 0x6D2B79F5)
        t := imul(a XOR (a >>> 15), a OR 1)
        t := int32( (t + imul(t XOR (t >>> 7), t OR 61)) XOR t )
        return uint32(t XOR (t >>> 14)) / 4294967296
```

- `>>>` is a **logical** (zero-filling) right shift.
- `imul(x, y)` is 32-bit multiplication that **discards overflow** — not 64-bit
  multiplication truncated afterwards.
- `int32` / `uint32` reinterpret the same 32 bits, signed or unsigned.
- `a OR 1` and `t OR 61` are bitwise OR, not addition.

The returned double is exact: an integer below 2³² over a power of two.

```swift
struct SeededRNG {
    private var a: UInt32
    init(seed: UInt32) { a = seed }
    mutating func next() -> Double {
        a = a &+ 0x6D2B79F5
        var t = (a ^ (a >> 15)) &* (a | 1)
        t = (t &+ ((t ^ (t >> 7)) &* (t | 61))) ^ t
        return Double(t ^ (t >> 14)) / 4294967296.0
    }
}
```

```kotlin
class SeededRng(seed: Int) {
    private var a: Int = seed
    fun next(): Double {
        a += 0x6D2B79F5
        var t = (a xor (a ushr 15)) * (a or 1)
        t = (t + ((t xor (t ushr 7)) * (t or 61))) xor t
        return ((t xor (t ushr 14)).toLong() and 0xFFFFFFFFL) / 4294967296.0
    }
}
```

Swift: `&+` and `&*` wrap; plain `+` and `*` trap. Kotlin: use `ushr`, never
`shr`, and keep the `and 0xFFFFFFFFL` or every negative draw flips sign.

**Second stream.** Where one draw needs two independent sequences that must
neither collide nor drift, the second is seeded with `uint32(seed XOR 0x9E3779B9)`.

## 2. The shuffle — Fisher–Yates, descending

```
function shuffled(items, rng):
    out := copy(items)
    for i from length(out) - 1 down to 1:
        j := floor(rng() * (i + 1))
        swap out[i], out[j]
    return out
```

Exactly this order. Ascending, or drawing `j` before `i`, diverges immediately.
The shuffle is over **positions**: a differently ordered roster is a different
draw, so a roster always travels as an ordered list — never a set or a map.

## 3. The turn form — the bag

Every member exactly once per round, in an order nobody can predict; rounds
repeat. Equal counts are **structural**: a streak of bad luck is impossible
rather than unlikely.

```
setMembers(ids):
    members := copy(ids)
    queue := queue filtered to ids present in members      # order preserved
    if queue is empty: refill()

refill():
    if members is empty: queue := []; return
    queue := shuffled(members, rng)
    fresh := true
    if length(members) > 1 and queue[0] == last:
        move queue[0] to the end of queue

take():
    if members is empty: return null
    if queue is empty: refill()
    opened := fresh
    fresh  := false
    id := remove first element of queue
    last := id
    return id

startedRound := opened      # about the id take() just returned
```

The rotate-on-collision in `refill` removes the one case a shuffle cannot: the
same member closing one round and opening the next. It is a **rotation**, not a
swap — and it has a price, stated in §9: the member who closes a round never
opens the next, and **closes it again with probability 2/n**, twice the uniform
rate. `setMembers` **preserves surviving queue order** and refills only when the
queue empties; a new member waits for the next round, and a removed one is never
dealt again.

A turn surface needs at least **three** members for the order to be
unpredictable — a bag of two deals a strict alternation.

## 4. The lot form

When more members want a thing than it can hold:

```
lot(roster, seed, admit):
    return first min(admit, length(roster)) elements of shuffled(roster, seededRng(seed))
```

The admitted members are returned **in draw order**, so a waiting list is the
rest of the same shuffle. A surface should hold a lot **only on
oversubscription** — if everyone fits, nobody needs drawing. Called anyway with
`admit` at or above the roster size, `lot` admits everyone, in draw order.

## 5. The seed

The seed must be **unknowable to everyone while the roster can still change**,
and must not be chosen by anyone with a stake in the result. In order of
preference:

**(a) A public randomness beacon.** Commit the roster (§6) together with the
number of a **future** beacon round. When the round is published, the seed is
its first four bytes, big-endian:

```
seedFromBeacon(randomness):          # at least 32 bytes, as hex
    return uint32( parse_hex( randomness[0..8] ) )
```

For drand, `randomness` is the round's 64-hex-character field. The reference
vectors record quicknet round 1,000,000 (chain
`52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971`), whose
`randomness` is SHA-256 of its `signature` — the test suite checks that too.

**(b) Salted commit–reveal**, where no beacon is reachable. Publish
`seedCommitment(seed, salt)` **before the roster closes**; reveal `seed` and
`salt` after. The salt is mandatory: a 32-bit seed behind a bare hash is
recovered by brute force in seconds. A withheld reveal is not prevented — it is
**visible**, and a surface using (b) must say in advance what happens then.

**(c) A local seed**, only where the draw's sole stake is play order and the
surface must work offline. The reference deliberately ships **no seed maker**: a
surface that seeds locally decides so in its own code.

## 6. Commitments

SHA-256 over UTF-8, hex output, lowercase. The salt is at least 16 bytes of hex
(the reference generates 32) and is lowercased before hashing.

```
rosterCommitment(roster, salt) = SHA256( "b-call/roster/v1\n" + salt + "\n" + JSON(roster) )
seedCommitment(seed, salt)     = SHA256( "b-call/seed/v1\n"   + salt + "\n" + decimal(uint32(seed)) )
```

`JSON(roster)` is the ordered array of identifier strings with no whitespace,
exactly as `JSON.stringify` produces it.

## 7. The two regimes

Which regime applies is decided by the surface, never chosen per draw: **does
anything anonymous bind?**

| | **Public** | **Sealed** |
| --- | --- | --- |
| When | the turn is the participant's to know | a published order would identify an anonymous party |
| Roster | may be public | **private**; only its salted commitment is published |
| Seed | surfaced with each cycle | revealed at the periodic reset |
| Order | visible, recomputable by anyone | committed in-season; recomputed at the reset by a named verifying quorum |
| Counts | public | public — "everyone exactly once per round" is checkable from the roster size alone |

In the sealed regime the salt on the roster commitment is what keeps a member
who knows their own identifier from locating their position once a beacon seed
is public.

## 8. Conformance and versioning

`vectors/b-call-vectors.json` carries:

| Case | Checks |
| --- | --- |
| `prng_seed_*` | eight raw `uint32` draws — compare these first; a wrong column here is almost always a signed shift or a non-wrapping multiply |
| `shuffle_n*_seed_*` | one shuffle |
| `second_stream_seed_*` | the derived seed |
| `turns_n*_seed_*` | `(id, roundStart)` sequences, n = 1, 2, 3, 7, 12 |
| `turns_membership_change` | a replayable script of `setMembers` / `take` steps |
| `lot_n10_admit*_beacon` | admission of 0, 3 and 12 from ten, seeded from the recorded beacon |
| `beacon_seed` | a real drand round and the seed it yields |
| `roster_commitment`, `seed_commitment` | digests under a fixed, deliberately non-random salt |

The `prng` and `shuffle` cases for seeds 1 and 123456789 are byte-identical to
`@333eco/sey@1.0.0`'s `caller-vectors.json`.

**Changing the output for any seed already used is a breaking change** — a draw
somebody recorded would no longer recompute. If the algorithm must ever change,
version the seed (a new commitment prefix, a new vector file), never the meaning
of an old one.

## 9. Honest limits

- **32 bits of state.** Only 2³² of a large roster's n! orderings are reachable.
  Measured, not assumed: over 260,000 seeds no member's position distribution
  departed from uniform beyond sampling noise (worst χ² 29.0 at 12 degrees of
  freedom for 13 members; 33.8 at 19 for 20), while a deliberately biased
  shuffle scored 349,558 on the same check. But the order is **predictable once
  the seed is known**, and a short run of observed turns plus an exhaustive
  search over 2³² seeds can recover it. That is intended for recomputation, and it is why the sealed regime
  keeps the roster private rather than the seed.
- **The boundary rotation is not uniform across rounds.** Within a round every
  order is possible and counts are exactly equal, but the previous round's
  closer lands: never first; last with probability **2/n**; each middle position
  with probability 1/n. Measured over 40,000 seeds: 66.8% at n = 3, 49.9% at
  n = 4, 28.5% at n = 7, 16.6% at n = 12 — matching 2/n. The rotation maps the
  shuffles that would open with the closer onto shuffles that end with them.
  Long-run averages stay equal by symmetry; what suffers is round-to-round
  unpredictability, sharpest in small rosters, and on a surface where a late
  slot costs something, a late slot tends to repeat. It cannot be changed for
  a seed already used (§8). A surface that needs uniform round orders needs a
  **new, versioned** turn form — none is specified yet.
- **The roster is outside the draw.** A called draw removes discretion over the
  order and moves any remaining discretion to admission. Guard admission
  separately — one entry per verified person, for example.
- **The beacon is trusted to its threshold.** drand's guarantee holds unless a
  threshold of its League of Entropy members collude.
- **Classification is a judgment.** Deciding that a decision is turn-shaped at
  all happens before any draw, and this contract cannot check it.
