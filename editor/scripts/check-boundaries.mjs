#!/usr/bin/env node
// Import boundaries of the editor, checked in CI (`npm run check:boundaries`).
//
// 1. A workspace package (packages/*) never imports the host app (src/): it reaches
//    the host only through @artisan/editor-sdk.
// 2. The low layers (domain, schema, lib, state, components) never import features/.
// 3. A feature imports another feature only along an edge already in the baseline:
//    the existing coupling is frozen, a new edge fails.
//
// Existing violations live in boundaries-baseline.json. A violation that is not in it
// fails; a baseline entry that no longer occurs fails too, so the baseline only shrinks.
// `--update` rewrites the baseline from the current code (review the diff: an added line
// is new coupling).
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(root, "boundaries-baseline.json");
const LOW_LAYERS = ["domain", "schema", "lib", "state", "components"];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

const IMPORT =
  /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

/** Imports of `file`, resolved to a path relative to editor/ when they point inside it. */
function importsOf(file) {
  const source = readFileSync(file, "utf8");
  const targets = [];
  for (const match of source.matchAll(IMPORT)) {
    const spec = match[1] ?? match[2];
    let target = null;
    if (spec.startsWith("@/")) target = join("src", spec.slice(2));
    else if (spec.startsWith(".")) target = relative(root, resolve(dirname(file), spec));
    if (target !== null) targets.push(target.split(sep).join("/"));
  }
  return targets;
}

function featureOf(path) {
  const m = /^src\/features\/([^/]+)/.exec(path);
  return m ? m[1] : null;
}

function layerOf(path) {
  const m = /^src\/([^/]+)\//.exec(path);
  return m && LOW_LAYERS.includes(m[1]) ? m[1] : null;
}

const violations = new Set();
const files = [...walk(join(root, "src")), ...walk(join(root, "packages"))];
for (const file of files) {
  const from = relative(root, file).split(sep).join("/");
  const isTest = /\.test\.tsx?$/.test(from);
  for (const to of importsOf(file)) {
    if (from.startsWith("packages/") && to.startsWith("src/")) {
      violations.add(`package-imports-host: ${from} -> ${to}`);
    }
    const layer = layerOf(from);
    const toFeature = featureOf(to);
    // Tests of a low layer may build fixtures with feature code.
    if (layer && toFeature && !isTest) {
      violations.add(`layer-imports-feature: ${layer} -> features/${toFeature}`);
    }
    const fromFeature = featureOf(from);
    if (fromFeature && toFeature && fromFeature !== toFeature) {
      violations.add(`feature-imports-feature: ${fromFeature} -> ${toFeature}`);
    }
  }
}

const current = [...violations].sort();
if (process.argv.includes("--update")) {
  writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`boundaries-baseline.json: ${current.length} entries`);
  process.exit(0);
}

const baseline = new Set(JSON.parse(readFileSync(baselinePath, "utf8")));
const added = current.filter((v) => !baseline.has(v));
const gone = [...baseline].filter((v) => !violations.has(v));
if (added.length === 0 && gone.length === 0) {
  console.log(`Import boundaries OK (${baseline.size} known violations in the baseline).`);
  process.exit(0);
}
if (added.length > 0) {
  console.error("New import across a boundary (see scripts/check-boundaries.mjs):");
  for (const v of added) console.error(`  + ${v}`);
}
if (gone.length > 0) {
  console.error("Fixed, remove from boundaries-baseline.json (or run with --update):");
  for (const v of gone) console.error(`  - ${v}`);
}
process.exit(1);
