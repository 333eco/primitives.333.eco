// Regenerates vectors/b-called-vectors.json from the built reference (dist/).
// Run: npm run vectors
//
// The vectors are authoritative for every implementation, including this one.
// If this output changes for a seed that has already shipped, that is a
// breaking change: a draw somebody recorded no longer recomputes. Version the
// seed, never the algorithm. The test suite refuses to pass unless dist/ still
// agrees with @333eco/sey@1.0.0's vectors, so run `npm test` first.
import { writeFileSync } from "node:fs";
import {
    seededRng,
    shuffled,
    secondStreamSeed,
    Bag,
    turns,
    lot,
    seedFromBeacon,
    rosterCommitment,
    seedCommitment
} from "../dist/b-called.js";

const ids = (n) => Array.from({ length: n }, (_, i) => `p${i}`);

// A real round of the drand quicknet beacon (League of Entropy), recorded rather
// than fetched, so the vectors never depend on the network. Check it yourself:
// https://api.drand.sh/<chain>/public/1000000 — and `randomness` is SHA-256 of
// `signature`, which the test suite verifies.
const BEACON = {
    network: "drand quicknet (League of Entropy)",
    chain: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
    round: 1000000,
    randomness: "b22aad4794f7451896f7a371aa46106fd84d919f3f569acd5b2fddf1d1440af3",
    signature:
        "83ad29e4c409f9470fc2ef02f90214df49e02b441a1a241a82d622d9f608ef98fd8b11a029f1bee9d9e83b45088abe72"
};
const beaconSeed = seedFromBeacon(BEACON.randomness);

// A fixed, obviously non-random salt. Never use a salt like this for a real
// commitment; it is here so the digests are reproducible.
const SALT = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0")).join("");

const out = {
    license: "CC0-1.0",
    spec: "SPEC.md",
    generatedFrom: "src/b-called.ts",
    note: "Authoritative. Regenerate with `npm run vectors`. prng and shuffle cases for seeds 1 and 123456789 are byte-identical to @333eco/sey@1.0.0 caller-vectors.json.",
    cases: {}
};

for (const seed of [0, 1, 123456789, 4294967295]) {
    const rng = seededRng(seed);
    out.cases[`prng_seed_${seed}`] = {
        seed,
        uint32: Array.from({ length: 8 }, () => rng() * 4294967296)
    };
}

for (const [seed, n] of [
    [1, 7],
    [123456789, 7],
    [7, 12]
]) {
    const input = Array.from({ length: n }, (_, i) => String.fromCharCode(97 + i));
    out.cases[`shuffle_n${n}_seed_${seed}`] = { seed, input, output: shuffled(input, seededRng(seed)) };
}

for (const seed of [0, 1, 123456789, 4294967295]) {
    out.cases[`second_stream_seed_${seed}`] = { seed, secondStreamSeed: secondStreamSeed(seed) };
}

for (const [n, seed, count] of [
    [1, 1, 6],
    [2, 7, 12],
    [3, 7, 24],
    [7, 123456789, 28],
    [12, 4242, 36]
]) {
    out.cases[`turns_n${n}_seed_${seed}`] = { roster: ids(n), seed, count, turns: turns(ids(n), seed, count) };
}

// Membership changes mid-round: surviving queue order is preserved, the new
// member waits for the next refill, and the removed one is never dealt again.
{
    const seed = 99;
    const bag = new Bag(seededRng(seed));
    const before = ids(5);
    bag.setMembers(before);
    const dealt = [];
    for (let k = 0; k < 3; k++) dealt.push({ id: bag.take(), roundStart: bag.startedRound });
    const after = [...before.filter((id) => id !== "p4"), "p5"];
    const undealtRemoved = !dealt.some((t) => t.id === "p4");
    bag.setMembers(after);
    for (let k = 0; k < 10; k++) dealt.push({ id: bag.take(), roundStart: bag.startedRound });
    out.cases.turns_membership_change = {
        seed,
        steps: [
            { setMembers: before },
            { take: 3 },
            { setMembers: after, note: undealtRemoved ? "p4 removed before it was dealt" : "p4 removed after it was dealt" },
            { take: 10 }
        ],
        turns: dealt
    };
}

const lotRoster = ids(10);
for (const admit of [0, 3, 12]) {
    out.cases[`lot_n10_admit${admit}_beacon`] = {
        roster: lotRoster,
        seed: beaconSeed,
        admit,
        admitted: lot(lotRoster, beaconSeed, admit)
    };
}

out.cases.beacon_seed = { ...BEACON, seed: beaconSeed };

out.cases.roster_commitment = {
    roster: ids(5),
    salt: SALT,
    commitment: await rosterCommitment(ids(5), SALT)
};
out.cases.seed_commitment = {
    seed: beaconSeed,
    salt: SALT,
    commitment: await seedCommitment(beaconSeed, SALT)
};

writeFileSync(new URL("../vectors/b-called-vectors.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(`b-called-vectors.json — ${Object.keys(out.cases).length} cases`);

// ── v2 ───────────────────────────────────────────────────────────────────────
// Real consecutive quicknet rounds, recorded. Each is checked against its
// signature by the suite (consistency, not BLS authenticity).
const v2 = await import("../dist/b-called-v2.js");
const ROUNDS = {
    1000000: { randomness: "b22aad4794f7451896f7a371aa46106fd84d919f3f569acd5b2fddf1d1440af3", signature: "83ad29e4c409f9470fc2ef02f90214df49e02b441a1a241a82d622d9f608ef98fd8b11a029f1bee9d9e83b45088abe72" },
    1000001: { randomness: "9f45f439afd81e9846b3b4dc5e3e6051922c73c8459d18e9d507b52ddbd884ff", signature: "a5bd91e5e2d8c0bf51bffdfad87eef34348fd9c0b2df2bee39db90bdef7e1399b1a77bb2fe98b24d84c0936a306c4218" },
    1000002: { randomness: "018e0e0c9e0d7906762eca633fab3ec5e97ee4cb8949e4eb9ee589160b49263d", signature: "a96e2a020098645aa4f912dcca317a67e98c39909fe1a037798fb503f04272b8153bab438c7e8d298593af1bdf29e5c5" },
    1000003: { randomness: "4988431355480858aede82fe7af925d486ecf10253e175d4fa28c2e6512d14ea", signature: "876ae112d465a00683071570a37cc7d86bebbf9887cf133d4d6a64ae24e51a7059e85e2533b52f95f5368c166255c53d" }
};
const Q = v2.QUICKNET.hash;
// Deterministic, obviously non-secret salts for reproducibility. Never use these.
const { createHash } = await import("node:crypto");
const vsalt = (label) => createHash("sha256").update(`b-called/v2/vector-salt/${label}`).digest("hex");
const pk = (n, from = 0) => Array.from({ length: n }, (_, i) => `p${i + from}`);

const out2 = {
    license: "CC0-1.0",
    spec: "SPEC.md, Part II",
    generatedFrom: "src/b-called-v2.ts",
    note: "Authoritative. Regenerate with `npm run vectors`. scripts/port_check.py recomputes every case from the spec alone, in Python's standard library.",
    chain: v2.QUICKNET,
    rounds: ROUNDS,
    cases: {}
};

// A season: four rounds, each frozen, each on its own beacon round, each committed
// with the previous round's closer. The roster changes between rounds 1 and 2.
{
    const rosters = [pk(6), [...pk(6).filter((id) => id !== "p2"), "p6"], [...pk(6).filter((id) => id !== "p2"), "p6"], pk(7)];
    let previousLast = null;
    const rounds = [];
    for (let r = 0; r < 4; r++) {
        const round = 1000000 + r;
        const input = { network: Q, round, drawId: `vector-season/round-${r + 1}`, form: "turn", regime: "public", salt: vsalt(`season-${r + 1}`), roster: rosters[r], previousLast };
        const d = await v2.draw(input, ROUNDS[round].randomness);
        rounds.push({ input, randomness: ROUNDS[round].randomness, ...d });
        previousLast = d.order[d.order.length - 1];
    }
    out2.cases.season_public_turns = { note: "each round's previousLast is the last id of the round before; rosters are frozen per round", rounds };
}

// The boundary rule firing: the first salt (by index) for which a 4-member round
// would open with the previous closer. Found by search, then recorded.
{
    for (let k = 0; ; k++) {
        const input = { network: Q, round: 1000001, drawId: "vector-boundary", form: "turn", regime: "public", salt: vsalt(`boundary-${k}`), roster: pk(4), previousLast: "p3" };
        const d = await v2.draw(input, ROUNDS[1000001].randomness);
        if (d.boundarySwapped) {
            out2.cases.turn_boundary_swap = { note: `first salt index ${k} whose round opened with the previous closer`, input, randomness: ROUNDS[1000001].randomness, ...d };
            break;
        }
    }
}

{
    const input = { network: Q, round: 1000003, drawId: "vector-sealed", form: "turn", regime: "sealed", salt: vsalt("sealed"), roster: pk(9), previousLast: null };
    out2.cases.turn_sealed = { note: "published at commit: the commitment only. Revealed at the reset: salt and roster.", input, randomness: ROUNDS[1000003].randomness, ...(await v2.draw(input, ROUNDS[1000003].randomness)) };
}

for (const admit of [0, 3, 10]) {
    const input = { network: Q, round: 1000002, drawId: `vector-lot-admit-${admit}`, form: "lot", regime: "public", salt: vsalt(`lot-${admit}`), roster: pk(10), admit };
    out2.cases[`lot_admit_${admit}`] = { input, randomness: ROUNDS[1000002].randomness, ...(await v2.draw(input, ROUNDS[1000002].randomness)) };
}

out2.cases.stream = { key: vsalt("stream-key"), label: "order", uint32: await v2.streamUint32(vsalt("stream-key"), "order", 20) };
out2.cases.round_time = { chain: "quicknet", round: 1000000, unixSeconds: v2.roundTime(v2.QUICKNET, 1000000) };

writeFileSync(new URL("../vectors/b-called-v2-vectors.json", import.meta.url), JSON.stringify(out2, null, 2) + "\n");
console.log(`b-called-v2-vectors.json — ${Object.keys(out2.cases).length} cases`);
