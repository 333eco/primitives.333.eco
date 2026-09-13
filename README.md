# @333eco/primitives

Recomputable primitives from 333.eco — small functions whose output anyone can
check without trusting whoever ran them. One module per primitive; no runtime
dependencies; CC0.

```sh
npm install @333eco/primitives
```

## B-Called℠ — the called draw

`@333eco/primitives/b-called`

> ⚠️ **v1 is the sey-compatible form, bound byte-for-byte to a contract already in
> use, so it never changes.** It is sound for play order and for public draws over
> a fixed roster with a beacon seed. It is **not** sufficient for a sealed draw or
> for a recurring benefit whose roster changes mid-season — see
> [`SPEC.md`](./SPEC.md) §9–§10 before using it for either.

A **called draw** decides whose turn it is, or who gets in when a thing is
oversubscribed, **without anyone choosing**. The result is a pure function of a
roster committed before the seed exists and a seed nobody controls, so a
stranger holding both gets the same answer.

It has two forms. **Turns** give every member exactly one turn per round, in an
order nobody can predict. **Lots** admit a fixed number of members when there
are more than fit.

```js
import { turns, lot, seedFromBeacon, rosterCommitment, newSalt } from "@333eco/primitives/b-called";

const roster = ["amara", "bopha", "chen", "dara"];

// 1. Before the seed exists: commit the ordered roster and name a FUTURE beacon round.
const salt = newSalt();
const commitment = await rosterCommitment(roster, salt);
const round = 1000000; // in real use, a drand round not yet published (this one is — it is in the vectors)

// 2. When the round is published, derive the seed from its randomness.
const seed = seedFromBeacon("b22aad4794f7451896f7a371aa46106fd84d919f3f569acd5b2fddf1d1440af3");

// 3. Draw. Anyone with the roster, the salt and the round can redo steps 1–3.
turns(roster, seed, 8);   // [{ id, roundStart }, …] — everyone once per round
lot(roster, seed, 2);     // two admitted, in draw order; the rest is the waiting list
```

The lower-level pieces are exported too: `seededRng` (mulberry32), `shuffled`
(descending Fisher–Yates), `Bag` (the turn form, with live membership changes),
`secondStreamSeed`, and `seedCommitment` for a salted commit–reveal where no
beacon is reachable.

### What it refuses

- **No weights.** Nothing goes in but the roster and the seed. If a decision
  needs a score, a rank or a history, it is not turn-shaped, and this is the
  wrong tool for it.
- **No seed maker.** There is deliberately no `newSeed()`. A seed picked by the
  operator after seeing the roster is a choice with extra steps.

### What it does not decide

Who gets onto the roster, and whether a turn can be kept, traded or bought. Both
belong to the surface using it. See `SPEC.md` §0 and §9.

### v2 — for draws worth something

`@333eco/primitives/b-called/v2`

Use v2 for a benefit, an income, a sealed order, or a roster that changes between
rounds. The draw comes from the whole beacon output. One commitment binds the round,
the roster, the previous round's closer and a lot's admit count. Each round has its own
frozen roster, and the boundary rule keeps positions uniform.

```js
import { commit, draw, verify, roundAt, QUICKNET, newSalt } from "@333eco/primitives/b-called/v2";

const input = {
    network: QUICKNET.hash,
    round: roundAt(QUICKNET, Date.now() / 1000) + 100, // a round ~5 minutes ahead
    drawId: "rider-dispatch/2026-09-14/round-1",
    form: "turn",
    regime: "public",
    salt: newSalt(),
    roster: ["amara", "bopha", "chen", "dara"], // frozen for this round
    previousLast: null // next round: the last id of this round's order
};

const commitment = await commit(input); // publish now, before the round is emitted
// …once drand publishes the round:
const { order, boundarySwapped } = await draw(input, randomnessOfThatRound);
// …and anyone holding the published commitment and inputs:
await verify(commitment, input, randomnessOfThatRound);
```

For a play-only surface that seeds itself offline, `roundKey(seed, label, index)` and
`orderFromKey(key, roster, previousLast)` give v2's draw and boundary rule under a key
you hold — recomputable, but never operator-independent (`SPEC.md` §16a).

A sealed draw publishes only the commitment. Its inputs go to the verifying quorum,
encrypted to them and then time-locked to the reset round. Never publish its salt.
See `SPEC.md` §17.

## Conformance

[`SPEC.md`](./SPEC.md) is normative — Part I for v1 (with Swift and Kotlin ports of
the generator), Part II for v2 — and [`vectors/`](./vectors/) is authoritative for
every implementation, including this one. For v2, `scripts/port_check.py`
reimplements the draw from the spec alone in Python's standard library and must
reproduce every vector.

```js
import vectors from "@333eco/primitives/b-called/vectors.json" with { type: "json" };
```

The generator, shuffle and turn form were lifted unchanged from sey's caller.
`npm test` checks this package against
[`@333eco/sey@1.0.0`](https://www.npmjs.com/package/@333eco/sey)'s published
vectors **before** its own, then breaks the algorithm on purpose four ways and
confirms the vectors catch each one.

## Licence and name

The code, the specification and the vectors are **CC0 1.0** — see `LICENSE`.
The mechanism is free to implement under any name. **B-Called℠** is a service mark
naming this reference implementation and its vectors; you may truthfully say an
implementation of yours "passes the B-Called℠ vectors."
