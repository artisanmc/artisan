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

test("plugin CI invokes the Gradle wrapper through Bash", () => {
  assert.match(workflow, /run: bash \.\/gradlew test shadowJar( \w+)* --no-daemon/);
});

test("editor CI does not enforce the repository-wide lint while its baseline is red", () => {
  assert.doesNotMatch(workflow, /run: npm run lint/);
  assert.match(workflow, /run: npm run build/);
});

test("GitHub-maintained JavaScript actions use their Node 24 releases", () => {
  const workflows = `${workflow}\n${deployWorkflow}`;

  assert.doesNotMatch(
    workflows,
    /(?:actions\/(?:checkout|setup-node|setup-java)|gradle\/actions\/setup-gradle)@v4/,
  );
  assert.match(workflows, /actions\/checkout@v5/);
  assert.match(workflows, /actions\/setup-node@v5/);
  assert.match(workflows, /actions\/setup-java@v5/);
  assert.match(workflows, /gradle\/actions\/setup-gradle@v5/);
});
