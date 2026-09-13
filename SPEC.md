# The called draw — a recomputable contract

_This document and the conformance vectors beside it are CC0. Implement the
mechanism under any name, in any language; no permission is needed and none can
be withheld. **B-Called℠** names one implementation of it — the reference in
`src/b-called.ts` — and those vectors. Anyone may truthfully say their own
implementation "passes the B-Called℠ vectors."_

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

**Part I (§0–§10) is v1, the sey-compatible form. Part II (§11–§19) is v2 — use it for
anything worth something.**

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
| **External seed.** A beacon round named at commit — or a salted commit–reveal whose holder controls neither the roster nor its timing. | A seed the operator picks after seeing the roster, or holds while the roster is still open. |
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

**Second stream.** Where one draw needs a second sequence (sey's relay callers
beside its receivers), the second is seeded with `uint32(seed XOR 0x9E3779B9)`.
⚠️ **It is not independent.** mulberry32's state is a Weyl sequence, so every seed
is the same cycle at a different offset: the second stream is the first **shifted
by a seed-dependent number of draws — at least 7,179 for every seed** (for seed
`0x083641A0`, `stream2[k + 7179] == stream1[k]`). Harmless for a sey circle; do
not rely on it wherever two streams of more than a few thousand draws must be
uncorrelated.

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
dealt again. ⚠️ **Live membership is a steering channel wherever a turn is worth
something** (§9): removing and re-adding a member cancels their pending turn, and
whoever is present at a refill decides the next shuffle — which, with the seed
known, can be simulated in advance. It is the right behaviour for a playground
circle and the wrong one for a benefit.

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
⛔ **(b) is NOT operator-independent when the seed holder also controls the
roster or its timing:** the holder knows the seed while the roster is still open
and can shape the roster to it. Use (b) only where the seed holder controls
neither, or for play-only surfaces as in (c).

**(c) A local seed**, only where the draw's sole stake is play order and the
surface must work offline. The reference deliberately ships **no seed maker**: a
surface that seeds locally decides so in its own code.

## 6. Commitments

SHA-256 over UTF-8, hex output, lowercase. The salt is at least 16 bytes of hex
(the reference generates 32) and is lowercased before hashing.

```
rosterCommitment(roster, salt) = SHA256( "called-draw/v1/roster\n" + salt + "\n" + JSON(roster) )
seedCommitment(seed, salt)     = SHA256( "called-draw/v1/seed\n"   + salt + "\n" + decimal(uint32(seed)) )
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

⛔ **v1 cannot yet deliver the sealed regime operator-independently.** A bare
beacon seed is public, so a sealed order needs a secret in the seed; v1 offers
no way to combine one with a beacon, which leaves only (b) — and (b) fails where
the operator admits the roster. **Use v2 — Part II, §17.** Also: publish counts **only at round boundaries** — a count that ticks per
turn in-season names each recipient, while a bag's counts at a boundary are all
equal and say nothing.

## 8. Conformance and versioning

`vectors/b-called-vectors.json` carries:

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

- **32 bits of state, and a small but real position bias.** Only 2³² of a large
  roster's n! orderings are reachable, and mulberry32 emits only about 44% of
  32-bit values over its full cycle. ⛔ *An earlier revision of this section said
  no bias was detectable; that check (260,000 seeds) was too weak to see it.*
  **Exhaustive over all 2³² seeds at 13 members, the first-listed member is dealt
  first 0.086% less often and last 0.085% more often** — a monotone gradient near
  16 binomial standard deviations, absent from a SplitMix64 control run through
  the same harness (max 0.015%). Small, systematic, and tied to roster order,
  which is a reason the roster order must be fixed before the seed is known.
- **The seed is recoverable from a few observed turns.** Anyone holding the
  ordered roster who sees about 7 turns of a 30-member draw (about 5 of a
  100-member one) can enumerate all 2³² seeds and find the one that fits — about
  30 seconds on an 8-core machine. The salt in `seedCommitment` hides the seed from
  the commitment, never from its outputs. The same attack broke a 32-bit online
  poker shuffle in 1999.
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
- **A season with membership changes cannot be recomputed from roster + seed.**
  `turns()` takes a fixed roster; a live roster needs the ordered log of changes,
  written after the seed was known (§3).
- **`rosterCommitment` does not bind the beacon round, the beacon network or the
  algorithm version** — only a v1 tag, the salt and the roster. The binding is by
  convention; publish the round beside the commitment, before the round is emitted.
- **A draw can be voided and redrawn.** A genuine error and a pretext leave the
  same record. Publish a voided draw beside its replacement and name the redraw
  round in the original commitment.
- **The beacon is trusted to its threshold.** A colluding threshold of drand's
  League of Entropy could predict rounds (not bias them) — and an insider who
  learns a seed while the roster is open is back in §3's steering problem.
- **Classification is a judgment.** Deciding that a decision is turn-shaped at
  all, who is eligible, and where a lot's tier boundary lies all happen before
  any draw, and this contract cannot check them. Publish them before entries open.
- **A lot whose entry carries a price may be a lottery in law** — consideration,
  chance and a prize. Take advice before charging for an entry into a lot.

## 10. What v1 is for

**v1 is the sey-compatible form.** Its generator, shuffle and bag are bound
byte-for-byte to a contract already published and in use, so it can never change.
It is sound for **play-order** draws and for **public** draws over a fixed roster
with a beacon seed. **For anything worth something — a benefit, an income, a
sealed order, a roster that changes between rounds — use v2 (Part II).**

---

# Part II — v2

`@333eco/primitives/b-called/v2`. A new version, not an edit: no v1 output changes.
Every rule below answers a finding of the 2026-09-13 prior-art census, and a second
implementation written from this Part alone (`scripts/port_check.py`, Python standard
library) reproduces every v2 vector.

## 11. Encoding

All integers are big-endian. Every variable-length value is **length-prefixed**, so no
two different inputs share an encoding and no text-escaping rules are needed.

```
u32(n)      4 bytes          u64(n)      8 bytes
field(b)    u32(len(b)) ‖ b
str(s)      field(UTF-8(s))
bytes(h)    field(hex-decode(h))
list(ids)   u32(count) ‖ str(id₁) ‖ … ‖ str(idₙ)
```

## 12. The commitment

```
C = SHA-256( str("called-draw/v2/commitment")
           ‖ str(lowercase(network))       # beacon chain hash, hex
           ‖ u64(round)                    # the beacon round, named now, emitted later
           ‖ str(drawId)                   # unique per draw
           ‖ str(form)                     # "turn" | "lot"
           ‖ str(regime)                   # "public" | "sealed"
           ‖ bytes(salt)                   # ≥ 32 bytes
           ‖ list(roster)                  # ordered, unique, non-empty ids
           ‖ str(form == "turn" ? previousLast or "" : "")
           ‖ u32(form == "lot" ? admit : 0) )
```

Publish `C` **before** `roundTime(round)` (§16), to a log that is append-only and
timestamped. **One commitment per `drawId`; the first published binds.** A second
commitment for the same id is a redraw, and a redraw is published beside the draw it
replaces with its reason (§19).

Everything a late choice could otherwise steer is inside `C`: the round, the roster
and its order, the previous round's closer, and — for a lot — how many are admitted.
A tier boundary set after the order is known is a choice; here it is fixed first.

## 13. The key and the streams

```
K  = SHA-256( str("called-draw/v2/key") ‖ bytes(C) ‖ bytes(randomness) ‖ bytes(salt) )
Sₗ = HMAC-SHA-256( key = K,  msg = str("called-draw/v2/stream") ‖ str(label) )
Bᵢ = HMAC-SHA-256( key = Sₗ, msg = u64(i) )          # i = 0, 1, 2, …
```

A stream yields the 32-byte blocks `B₀, B₁, …` as consecutive big-endian `u32`
values, eight per block. The draw uses the stream labelled `"order"`.

Because `C` is inside `K`, two draws that share a beacon round and a roster but differ
in any committed field — above all `drawId` — get unrelated orders.

## 14. A uniform index

```
uniform(m):                       # an integer in [0, m), 1 ≤ m ≤ 2³²
    limit := 2³² − (2³² mod m)
    repeat: x := next u32 of the stream
    until x < limit
    return x mod m
```

Rejection, not reduction: `x mod m` alone would favour small values.

## 15. The draw

```
order := copy(roster)
for i from n − 1 down to 1:
    j := uniform(i + 1)
    swap order[i], order[j]

if form == "turn" and previousLast is set and n > 1 and order[0] == previousLast:
    j := 1 + uniform(n − 1)                 # the same stream, continuing
    swap order[0], order[j]                 # boundarySwapped := true

if form == "lot": admitted := order[0 .. admit)
```

**The boundary rule is a SWAP with a uniformly drawn later position.** The result is
exactly uniform over the orders that do not open with the previous closer: that member
lands in each of positions 1 … n−1 with probability 1/(n−1), and every other member
opens with probability 1/(n−1). Measured in the suite at n = 4: the closer is last
33.2% of the time, against v1's 50%.

## 16. Seasons, rosters and skips

A recurring benefit is a **season of rounds**, and each round is its own draw:

- its **roster is frozen** at that round's cutoff and committed with it;
- its **beacon round** is named at that cutoff, far enough ahead that `C` is published
  before `roundTime(round) = genesisTime + (round − 1) × period`;
- its `previousLast` is the **final id of the previous round's committed order** — taken
  from the order, never from who was actually served.

A member who is **absent** when their turn comes is a recorded **skip**: the turn
lapses. Absence is **never** a removal from the round's shuffle input, and nothing
about who was present reaches any later round except through that round's own frozen
roster. A member who joins or leaves does so at the next cutoff.

## 17. The two regimes

The algorithm is identical; the regime decides **what is disclosed, to whom, and when.**

| | **Public** | **Sealed** |
| --- | --- | --- |
| At commit | `C`, and the salt, roster and fields beside it | `C` only — plus the sealed reveal below |
| After the round | anyone runs `verify` | nobody outside the quorum can compute the order: the salt is inside the key |
| At the reset | — | the **quorum** receives the reveal and runs `verify` |
| Counts | may be public at any time | **only at round boundaries**, where a bag's counts are all equal and say nothing |

**The sealed reveal**, published beside `C`: the draw's inputs (salt, roster and the
committed fields), **encrypted to the quorum's recipients first, then time-locked to
the reset round** with drand's `tlock` (the `age` format; `tlock-js` or the `tle`
command). After the reset round anyone can remove the time lock, and only the quorum
can read what is inside — so the reveal **cannot be withheld from the quorum**, and is
**never published to everyone.**

⛔ **Never publish a sealed draw's salt.** `C` plus the salt lets anyone who can guess
the roster confirm the guess, and then compute the whole order — which identifies,
after the fact, exactly the anonymous gifts the sealed regime exists to protect.

*Tested 2026-09-13 against quicknet: a value time-locked to a round ~9 seconds ahead
was refused before that round ("too early to decrypt") and recovered exactly after it.
This package does not bundle `tlock-js`, which would add five runtime dependencies.*

## 18. Beacon checks

- `roundTime(chain, round)` and `roundAt(chain, t)` — `genesisTime + (round − 1) × period`
  and its inverse. quicknet: genesis 1692803367, period 3 s.
- `randomnessMatchesSignature(randomness, signature)` — for drand's unchained schemes
  `randomness = SHA-256(signature)`. **This is consistency, not authenticity.** Verifying
  the BLS signature against the chain's public key is outside this package; a surface
  holding value should do it with drand's client or cross-check two relays.

## 19. Conformance, ports and limits

`vectors/b-called-v2-vectors.json` carries four consecutive real quicknet rounds
(1,000,000–1,000,003) and: a four-round public **season** with a roster change and
chained closers · a round in which the **boundary swap fires** · a **sealed** turn · lots
admitting 0, 3 and 10 of 10 · 20 raw stream values · a round time. `scripts/port_check.py`
recomputes all of it from this Part and then requires five broken ports to fail (v1's
rotation · a commitment without the round · little-endian stream decoding · modulo with
no rejection · an admit count changed after commit).

Ports: Swift `CryptoKit` (`SHA256.hash`, `HMAC<SHA256>.authenticationCode`) · Kotlin/JVM
`MessageDigest("SHA-256")`, `Mac("HmacSHA256")` · Python `hashlib`, `hmac`.

**What v2 does not settle:**

- **Admission, classification and tier rules** are still choices. Publish them before
  entries open; one entry per verified principal is the surface's guard (v2 refuses a
  duplicate id, not a duplicate person).
- **The commitment log is a rule.** "One commitment per id, first published binds" and
  "published before the round" need an append-only, timestamped log and someone who
  reads it. v2 computes; it cannot see what was never published.
- **The sealed regime rests on a quorum** that is present and honest at the reset. The
  time lock stops the reveal being withheld from it, not the quorum from lying.
- **A beacon threshold that colludes can predict rounds** (never bias them). Where that
  matters, combine two independent beacons.
- **A skip costs the absent member their turn.** That is the non-storability rule working,
  and it means served turns are equal only among those present.
- **The boundary rule has a price:** the previous closer's average position is slightly
  later than everyone else's. No rule can forbid back-to-back turns for free.
- **Not yet reviewed by an outside cryptographer.** The independent port is by the same
  author as the reference, which makes it a check on the spec's sufficiency, not a second
  opinion on the design.
