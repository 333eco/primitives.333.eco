# CLAUDE.md — primitives.333.eco

Implementation notes only. Doctrine for B-Call℠ is canonical in memory
(`project_b_call`); where this file and memory disagree, memory wins.

## What this repo is

`@333eco/primitives` — **public**, CC0, zero runtime dependencies. One module per
recomputable primitive. First and only module: `b-call` (the called draw).
Not a site; no host. Lives under `333.eco` for the reason brand and the registry
do: it serves every body and names none.

## Rules that bite

- ⛔ **Never change output for a seed already used.** `src/b-call.ts` §1–3 are
  byte-identical to sey's caller; the suite checks against `@333eco/sey@1.0.0`
  (devDependency, EXACT pin) before its own vectors. A change is a new versioned
  form with a new commitment prefix, never an edit.
- ⛔ **Never add `newSeed()`.** The missing seed maker is a property, tested.
- ⚠️ **v1 is scoped** (SPEC §10): play order and PUBLIC draws over a fixed roster
  with a beacon seed. NOT the sealed regime, NOT a live roster. mulberry32 has a
  measured 0.086% position gradient, a seed recoverable from ~7 turns, and a
  "second stream" that is a lagged copy (min 7,179 draws). A fix is v2 — a new
  seed version — and waits on the founder's ruling (roadmap A128(c)).
- ⭐ **v2 (`src/b-call-v2.ts`, SPEC Part II) is the form for value** — whole-beacon HMAC
  stream, one binding commitment, per-round frozen rosters, a uniform boundary SWAP.
  `scripts/port_check.py` is its independent port and runs in `npm test`; ⛔ never
  "fix" a vector to match the TS without the port agreeing. ⛔ **Never publish a sealed
  draw's salt** (C + salt confirms a guessed roster). tlock is NOT bundled (5 deps).
- ⚠️ **Mutation-test with an apply check** — a mutation whose anchor is absent from
  `dist/` leaves the file unchanged and reads as a pass.
- ⚠️ **Regenerate vectors after any src change** (`npm run vectors`); CI fails
  on a stale vector file.
- ⚠️ **Break it on purpose before trusting a green suite.** The known-failure
  controls are in the suite; a new vector case needs a control that shows it
  can fail.
- ⚠️ `node --test` in Node 22 takes files, not a directory.
- Publish = bump `version` on main; the workflow gates on the tests. Needs the
  `NPM_TOKEN` repo secret. Verify with `npm view`, never the green step.
