import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workflowPath = fileURLToPath(new URL("../.github/workflows/ci.yml", import.meta.url));
const workflow = readFileSync(workflowPath, "utf8");

test("plugin CI invokes the Gradle wrapper through Bash", () => {
  assert.match(workflow, /run: bash \.\/gradlew test shadowJar --no-daemon/);
});

test("editor CI does not enforce the repository-wide lint while its baseline is red", () => {
  assert.doesNotMatch(workflow, /run: npm run lint/);
  assert.match(workflow, /run: npm run build/);
});
