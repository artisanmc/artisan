import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { computeBundleHash } from "./hashUtils";

// Cross-language conformance vector — see testdata/project-hash-conformance.json.
// The plugin (BundleHashConformanceTest.kt) asserts the SAME hex. If this drifts,
// plugin and backend project hashes diverge → projects resync in a loop. See
// CLAUDE.md § Invariants critiques.
function loadFixture(): { projectId: string; files: Record<string, string>; expectedHash: string } {
  let dir = process.cwd();
  for (;;) {
    const f = join(dir, "testdata", "project-hash-conformance.json");
    if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`conformance fixture not found from ${process.cwd()}`);
    dir = parent;
  }
}

describe("computeBundleHash — cross-language conformance", () => {
  test("matches the shared vector for a canonical-keyed file map", async () => {
    const fx = loadFixture();
    const prefix = `plugins/Artisan/projects/${fx.projectId}/`;
    const canonical: Record<string, string> = {};
    for (const [rel, content] of Object.entries(fx.files)) canonical[prefix + rel] = content;

    expect(await computeBundleHash(canonical, fx.projectId)).toBe(fx.expectedHash);
  });

  test("empty file map hashes to the empty-string sentinel", async () => {
    expect(await computeBundleHash({}, "p_demo")).toBe("");
  });
});
