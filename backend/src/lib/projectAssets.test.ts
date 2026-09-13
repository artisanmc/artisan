import { expect, test } from "bun:test";
import { ProjectAssets } from "./projectAssets";
import type { ProjectStorage, ProjectWriteBatch } from "./storage/ProjectStorage";

test("asset rename is one mixed CAS lot and failure has no runtime side effect", async () => {
  const batches: ProjectWriteBatch[] = [];
  let effects = 0;
  const storage = { write: async (batch: ProjectWriteBatch) => { batches.push(batch); return { kind: "result", result: { ok: false, error: "conflict" } }; } } as ProjectStorage;
  const assets = new ProjectAssets("p", storage, "op", async () => { effects++; });
  const result = await assets.writeAsset({ type: "glyph", name: "new", bytes: new Uint8Array([1]), descriptor: { height: 8 }, baseHash: null, descriptorBaseHash: null }, { path: "assets/glyphs/old.png", hash: "before", descriptorHash: "text-before" });
  expect(result).toEqual({ ok: false, error: "conflict" });
  expect(batches).toHaveLength(1);
  expect(batches[0]?.binaries).toHaveLength(2);
  expect(batches[0]?.deletes).toEqual([{ path: "assets/glyphs/old.yaml", base_hash: "text-before" }]);
  expect(batches[0]?.operationId).toBe("op");
  expect(effects).toBe(0);
});

test("font deletion removes every glyph and descriptor in one batch", async () => {
  const batches: ProjectWriteBatch[] = [];
  const storage = { write: async (batch: ProjectWriteBatch) => { batches.push(batch); return { kind: "result", result: { ok: true } }; } } as ProjectStorage;
  const assets = new ProjectAssets("p", storage, "delete");
  expect(await assets.deleteFont({ glyphs: { "assets/fonts/f/a.png": "a", "assets/fonts/f/b.png": "b" }, descriptorPath: "assets/fonts/f/font.yaml", descriptorBaseHash: "yaml" })).toEqual({ ok: true });
  expect(batches).toHaveLength(1);
  expect(batches[0]?.binaries).toHaveLength(2);
  expect(batches[0]?.deletes).toEqual([{ path: "assets/fonts/f/font.yaml", base_hash: "yaml" }]);
});
test("offline storage does not claim an asset write or run publication effects", async () => {
  let effects = 0;
  const storage = { write: async () => ({ kind: "offline" }) } as unknown as ProjectStorage;
  const assets = new ProjectAssets("p", storage, "offline", async () => { effects++; });
  expect(await assets.deleteAsset({ type: "glyph", name: "a", baseHash: "bytes", descriptorBaseHash: "yaml" })).toEqual({ ok: false, error: "server_offline" });
  expect(effects).toBe(0);
});
