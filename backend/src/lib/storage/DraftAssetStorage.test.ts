import { createHash } from "node:crypto";
import { expect, mock, test } from "bun:test";
import { DraftAssetStorage } from "./DraftAssetStorage";
import type { StoredDraft } from "./DraftStore";
import type { ProjectStorage } from "./ProjectStorage";

const draftBase: Omit<StoredDraft, "snapshot"> = {
  schema: "artisan-draft/v1", id: "draft", ownerId: "owner", name: "Work",
  revision: 1, status: "active", updatedBy: "owner", source: "editor",
  createdAt: "2026-09-21T00:00:00Z", updatedAt: "2026-09-21T00:00:00Z",
};

test("unchanged draft images reuse the validated published bytes without a private blob round trip", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const path = "assets/glyphs/button.png";
  const readBlob = mock(async () => ({ kind: "result", result: { ok: false, error: "not_found" } }));
  const readAssetBinary = mock(async () => ({ kind: "result", result: { ok: true, content: bytes, hash } }));
  const published = { drafts: { readBlob }, readAssetBinary, readBinary: readAssetBinary } as unknown as ProjectStorage;
  const draft: StoredDraft = { ...draftBase, snapshot: { tree: {}, baseline: {}, at: 1, binaryBaseline: { [path]: { hash, size: 3 } }, binaryTree: { [path]: { hash, size: 3 } } } };
  expect(await new DraftAssetStorage(published, draft).readBinary(path)).toMatchObject({ kind: "result", result: { ok: true, content: bytes } });
  expect(readBlob).not.toHaveBeenCalled();
  expect(readAssetBinary).toHaveBeenCalledWith(path, hash);
});

test("a private replacement uses its own bytes even when the published path exists", async () => {
  const bytes = new Uint8Array([4, 5, 6]);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const path = "assets/glyphs/button.png";
  const readBlob = mock(async () => ({ kind: "result", result: { ok: true, content_base64: Buffer.from(bytes).toString("base64") } }));
  const readAssetBinary = mock(async () => { throw new Error("private data must not fall back to another version"); });
  const published = { drafts: { readBlob }, readAssetBinary } as unknown as ProjectStorage;
  const draft: StoredDraft = { ...draftBase, snapshot: { tree: {}, baseline: {}, at: 1, binaryBaseline: { [path]: { hash: "old", size: 3 } }, binaryTree: { [path]: { hash, size: 3 } } } };
  expect(await new DraftAssetStorage(published, draft).readBinary(path)).toMatchObject({ kind: "result", result: { ok: true, content: bytes } });
  expect(readBlob).toHaveBeenCalledWith("draft", hash);
  expect(readAssetBinary).not.toHaveBeenCalled();
});
