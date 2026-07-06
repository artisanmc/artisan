import assert from "node:assert/strict";
import test from "node:test";

import { vitestWorkerExecArgv } from "../editor/vitest-worker-args.mjs";

test("Vitest passes no Web Storage flag to Node 22 workers", () => {
  assert.deepEqual(vitestWorkerExecArgv("22.18.0"), []);
});

test("Vitest disables native Web Storage for Node 25 workers", () => {
  assert.deepEqual(vitestWorkerExecArgv("25.1.0"), ["--no-webstorage"]);
});
