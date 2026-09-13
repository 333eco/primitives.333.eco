// Regenerates vectors/b-call-vectors.json from the built reference (dist/).
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
} from "../dist/b-call.js";

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
    generatedFrom: "src/b-call.ts",
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

writeFileSync(new URL("../vectors/b-call-vectors.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(`b-call-vectors.json — ${Object.keys(out.cases).length} cases`);
