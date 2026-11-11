import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  NO_RELEASE_LABEL,
  checkApiChange,
  currentApiVersion,
  latestRelease,
  nextSnapshot,
  planPublish,
} from "./api-version.mjs";

const surface = `
| Member | Type | Since |
|---|---|---|
| \`register(projectId: String, dir: File)\` | \`Unit\` | 1.5.0 |
| \`foo()\` | \`Unit\` | 1.10.0 |

Some prose. Since 1.4.0.
`;
const apiFile = "plugin/api/src/main/kotlin/net/artisanmc/modules/api/ProjectRootRegistry.kt";

test("current version is the highest Since version (numeric sort, not lexical)", () => {
  assert.equal(currentApiVersion(surface), "1.10.0");
  assert.equal(currentApiVersion("Captured items. Since 2.0.0.\n| a | b | 1.9.0 |"), "2.0.0");
});

test("real api-surface.md: a Since version is found", () => {
  const real = readFileSync(fileURLToPath(new URL("../docs/architecture/api-surface.md", import.meta.url)), "utf8");
  assert.match(currentApiVersion(real), /^\d+\.\d+\.\d+$/);
});

test("latest release ignores pre-releases and other tags", () => {
  assert.equal(latestRelease(["api-v1.6.0", "api-v1.10.2", "api-v1.9.0", "api-v2.0.0-rc1", "v3.0.0"]), "1.10.2");
  assert.equal(latestRelease([]), null);
});

test("snapshot announces the next minor", () => {
  assert.equal(nextSnapshot("1.6.0"), "1.7.0-SNAPSHOT");
  assert.equal(nextSnapshot("1.10.2"), "1.11.0-SNAPSHOT");
});

test("push to main: release when the documented version exceeds the latest release", () => {
  assert.deepEqual(planPublish(surface, []), { kind: "release", version: "1.10.0" });
  assert.deepEqual(planPublish(surface, ["api-v1.6.0"]), { kind: "release", version: "1.10.0" });
});

test("push to main: snapshot when the documented version is already published", () => {
  assert.deepEqual(planPublish(surface, ["api-v1.10.0"]), { kind: "snapshot", version: "1.11.0-SNAPSHOT" });
  assert.deepEqual(planPublish(surface, ["api-v1.12.0"]), { kind: "snapshot", version: "1.13.0-SNAPSHOT" });
});

test("PR: passes with no change to the API sources", () => {
  assert.equal(checkApiChange({ changedFiles: ["backend/x.ts"], markdown: surface, tags: ["api-v1.10.0"] }).ok, true);
});

test("PR: an API change without a new Since version fails", () => {
  const result = checkApiChange({ changedFiles: [apiFile], markdown: surface, tags: ["api-v1.10.0"] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /1\.11\.0/);
});

test("PR: an API change with a Since version above the latest release passes", () => {
  assert.equal(checkApiChange({ changedFiles: [apiFile], markdown: surface, tags: ["api-v1.9.0"] }).ok, true);
});

test("PR: the exemption label lets through a change with no effect on the published API", () => {
  const result = checkApiChange({ changedFiles: [apiFile], markdown: surface, tags: ["api-v1.10.0"], labels: [NO_RELEASE_LABEL] });
  assert.equal(result.ok, true);
});
