# @333eco/primitives

Recomputable primitives from 333.eco — small functions whose output anyone can
check without trusting whoever ran them. One module per primitive; no runtime
dependencies; CC0.

```sh
npm install @333eco/primitives
```

## B-Call℠ — the called draw

`@333eco/primitives/b-call`

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
import { turns, lot, seedFromBeacon, rosterCommitment, newSalt } from "@333eco/primitives/b-call";

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

## Conformance

[`SPEC.md`](./SPEC.md) is normative, with Swift and Kotlin ports of the
generator, and [`vectors/b-call-vectors.json`](./vectors/b-call-vectors.json) is
authoritative for every implementation — including this one.

```js
import vectors from "@333eco/primitives/b-call/vectors.json" with { type: "json" };
```

The generator, shuffle and turn form were lifted unchanged from sey's caller.
`npm test` checks this package against
[`@333eco/sey@1.0.0`](https://www.npmjs.com/package/@333eco/sey)'s published
vectors **before** its own, then breaks the algorithm on purpose four ways and
confirms the vectors catch each one.

## Licence and name

The code, the specification and the vectors are **CC0 1.0** — see `LICENSE`.
The mechanism is free to implement under any name. **B-Call℠** is a service mark
naming this reference implementation and its vectors; you may truthfully say an
implementation of yours "passes the B-Call℠ vectors."
