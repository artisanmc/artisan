import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workflowPath = fileURLToPath(new URL("../.github/workflows/ci.yml", import.meta.url));
const workflow = readFileSync(workflowPath, "utf8");
const deployWorkflowPath = fileURLToPath(
  new URL("../.github/workflows/deploy.yml", import.meta.url),
);
const deployWorkflow = readFileSync(deployWorkflowPath, "utf8");
const pluginWorkflowPath = fileURLToPath(
  new URL("../.github/workflows/plugin.yml", import.meta.url),
);
const pluginWorkflow = readFileSync(pluginWorkflowPath, "utf8");

/** The `paths` lists of a workflow, one per trigger. */
function triggerPaths(source) {
  return [...source.matchAll(/^ {4}paths:\n((?: {6}- .*\n)+)/gm)].map((m) =>
    m[1]
      .trim()
      .split("\n")
      .map((line) => line.replace(/^\s*- /, "")),
  );
}

test("plugin CI invokes the Gradle wrapper through Bash", () => {
  assert.match(pluginWorkflow, /run: bash \.\/gradlew test shadowJar( \w+)* --no-daemon/);
});

test("editor CI does not enforce the repository-wide lint while its baseline is red", () => {
  assert.doesNotMatch(workflow, /run: npm run lint/);
});

test("editor CI runs the deploy tests, static checks, editor tests, both builds and the wiki verify", () => {
  for (const step of [
    /run: node --test deploy\/\*\.test\.mjs/,
    /run: npm run typecheck\n\s+working-directory: editor/,
    /run: npx biome lint \.\n\s+working-directory: editor/,
    /run: npm run check:boundaries\n\s+working-directory: editor/,
    /run: npx biome format --changed --no-errors-on-unmatched --since=/,
    /run: npm test -- --run\n\s+working-directory: editor/,
    /run: npm run build\n\s+working-directory: editor/,
    /run: npm run build:site\n\s+working-directory: editor/,
    /run: npm run verify\n\s+working-directory: docs-site/,
  ]) {
    assert.match(workflow, step);
  }
});

test("editor e2e smoke runs in CI", () => {
  assert.match(workflow, /run: npm run test:e2e/);
});

test("CI builds no cloud editor: no VITE_* env, no cloud hosts", () => {
  assert.doesNotMatch(workflow, /VITE_/);
  assert.doesNotMatch(workflow, /api\.artisanmc\.net|editor\.artisanmc\.net/);
});

test("GitHub-maintained JavaScript actions use their Node 24 releases", () => {
  const workflows = `${workflow}\n${pluginWorkflow}\n${deployWorkflow}`;
  // Java is only needed by the CI plugin job: deploy.yml no longer builds a JAR.

  assert.doesNotMatch(
    workflows,
    /(?:actions\/(?:checkout|setup-node|setup-java)|gradle\/actions\/setup-gradle)@v4/,
  );
  assert.match(workflows, /actions\/checkout@v5/);
  assert.match(workflows, /actions\/setup-node@v5/);
  assert.match(workflows, /actions\/setup-java@v5/);
  assert.match(workflows, /gradle\/actions\/setup-gradle@v5/);
});

test("each workflow starts on its own inputs, the shared ones included, on push and on PR", () => {
  for (const [source, own] of [
    [workflow, ["editor/**", "docs-site/**", "deploy/**", ".github/workflows/ci.yml"]],
    [pluginWorkflow, ["plugin/**", ".github/workflows/plugin.yml"]],
  ]) {
    const lists = triggerPaths(source);
    assert.equal(lists.length, 2);
    assert.deepEqual(lists[0], lists[1]);
    // Read across directories: conformance vectors, schemas, the API surface.
    for (const path of [...own, "testdata/**", "docs/schema/**", "docs/architecture/api-surface.md"]) {
      assert.ok(lists[0].includes(path), path);
    }
  }
});

test("only main gets a post-merge run: deploy.yml waits on it", () => {
  for (const source of [workflow, pluginWorkflow]) {
    assert.match(source, /^ {4}branches: \[main\]$/m);
  }
});
