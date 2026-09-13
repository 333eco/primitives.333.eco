// Every published export must resolve THROUGH THE PACKAGE NAME. The other suites import
// ../dist directly, so a broken "exports" map passes them — which is exactly how a bad key
// once survived a green run (2026-09-13: a find-and-replace turned ./b-call/v2/vectors.json
// into ./called-draw/v2/vectors.json; only a clean install noticed). Node resolves a
// package's own name against its exports map, so this checks the map a consumer gets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// The public API, pinned. A map checked only against itself certified a broken key (the
// control for this file passed with the bad key restored), so the intended paths are
// written down here and the map must match them exactly.
const PUBLIC_API = [
    ".",
    "./b-called",
    "./b-called/v2",
    "./b-called/vectors.json",
    "./b-called/v2/vectors.json",
    "./b-called/SPEC.md",
    "./package.json"
];

test("the exports map is exactly the public API", () => {
    assert.deepEqual(Object.keys(pkg.exports).sort(), [...PUBLIC_API].sort());
});

test("every export key resolves through the package name", async () => {
    const keys = Object.keys(pkg.exports);
    for (const key of keys) {
        const spec = key === "." ? pkg.name : `${pkg.name}/${key.slice(2)}`;
        if (key.endsWith(".json")) {
            const mod = await import(spec, { with: { type: "json" } });
            assert.ok(mod.default, key);
        } else if (key.endsWith(".md")) {
            assert.ok(import.meta.resolve(spec).endsWith(".md"), key);
        } else {
            const mod = await import(spec);
            assert.ok(Object.keys(mod).length > 0, key);
        }
    }
});

test("the documented import paths are the exported ones", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const paths = [...readme.matchAll(/from "(@333eco\/primitives[^"]*)"/g)].map((m) => m[1]);
    assert.ok(paths.length >= 3, "the README lost its import examples");
    for (const p of paths) {
        const key = p === pkg.name ? "." : "./" + p.slice(pkg.name.length + 1);
        assert.ok(key in pkg.exports, `README imports ${p}, which is not exported`);
    }
});
