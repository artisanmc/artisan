import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("production backend image installs curl without recommended packages and cleans apt lists", () => {
  const dockerfilePath = fileURLToPath(new URL("../backend/Dockerfile", import.meta.url));
  const dockerfile = readFileSync(dockerfilePath, "utf8");

  assert.match(
    dockerfile,
    /^RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf \/var\/lib\/apt\/lists\/\*$/m,
  );
});

// Les icônes 3D pré-rendues voyagent dans l'image (`backend/assets-seed/*.zip`)
// et sont déposées dans le volume au boot par `lib/assetSeed.ts` : si le
// contexte de build les excluait, un volume neuf repartirait sans bibliothèque.
test("build context keeps backend/assets-seed while excluding the data volume", () => {
  const dockerignore = readFileSync(
    fileURLToPath(new URL("../.dockerignore", import.meta.url)),
    "utf8",
  );
  const patterns = dockerignore
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  assert.ok(patterns.includes("backend/data"), "the data volume must stay out of the image");
  assert.ok(
    !patterns.some((p) => p.startsWith("backend/assets-seed") || p === "backend"),
    "backend/assets-seed must reach the image",
  );
});
