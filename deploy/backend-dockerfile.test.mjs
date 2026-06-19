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
