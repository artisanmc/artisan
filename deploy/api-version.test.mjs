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

test("la version courante est la plus haute version Since (tri numérique, pas lexical)", () => {
  assert.equal(currentApiVersion(surface), "1.10.0");
  assert.equal(currentApiVersion("Captured items. Since 2.0.0.\n| a | b | 1.9.0 |"), "2.0.0");
});

test("api-surface.md réel : une version Since est trouvée", () => {
  const real = readFileSync(fileURLToPath(new URL("../docs/architecture/api-surface.md", import.meta.url)), "utf8");
  assert.match(currentApiVersion(real), /^\d+\.\d+\.\d+$/);
});

test("la dernière release ignore les pré-releases et les autres tags", () => {
  assert.equal(latestRelease(["api-v1.6.0", "api-v1.10.2", "api-v1.9.0", "api-v2.0.0-rc1", "v3.0.0"]), "1.10.2");
  assert.equal(latestRelease([]), null);
});

test("le snapshot annonce la mineure suivante", () => {
  assert.equal(nextSnapshot("1.6.0"), "1.7.0-SNAPSHOT");
  assert.equal(nextSnapshot("1.10.2"), "1.11.0-SNAPSHOT");
});

test("push sur main : release quand la version documentée dépasse la dernière release", () => {
  assert.deepEqual(planPublish(surface, []), { kind: "release", version: "1.10.0" });
  assert.deepEqual(planPublish(surface, ["api-v1.6.0"]), { kind: "release", version: "1.10.0" });
});

test("push sur main : snapshot quand la version documentée est déjà publiée", () => {
  assert.deepEqual(planPublish(surface, ["api-v1.10.0"]), { kind: "snapshot", version: "1.11.0-SNAPSHOT" });
  assert.deepEqual(planPublish(surface, ["api-v1.12.0"]), { kind: "snapshot", version: "1.13.0-SNAPSHOT" });
});

test("PR : passe sans changement des sources de l'API", () => {
  assert.equal(checkApiChange({ changedFiles: ["backend/x.ts"], markdown: surface, tags: ["api-v1.10.0"] }).ok, true);
});

test("PR : un changement de l'API sans nouvelle version Since échoue", () => {
  const result = checkApiChange({ changedFiles: [apiFile], markdown: surface, tags: ["api-v1.10.0"] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /1\.11\.0/);
});

test("PR : un changement de l'API avec une version Since au-dessus de la dernière release passe", () => {
  assert.equal(checkApiChange({ changedFiles: [apiFile], markdown: surface, tags: ["api-v1.9.0"] }).ok, true);
});

test("PR : le label d'exemption laisse passer un changement sans effet sur l'API publiée", () => {
  const result = checkApiChange({ changedFiles: [apiFile], markdown: surface, tags: ["api-v1.10.0"], labels: [NO_RELEASE_LABEL] });
  assert.equal(result.ok, true);
});
