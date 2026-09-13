import { expect, test } from "bun:test";
import type { ProjectStorage } from "./ProjectStorage";
import { captureProjectSnapshot } from "./captureProjectSnapshot";
import { digest } from "./hostedFilesystem";

test("snapshot preserves full public text/binary bytes and pins the requested revision", async () => {
  const bytes = new Uint8Array([0, 255, 13, 10]);
  const storage = { read: async () => ({ kind: "result", result: { ok: true, hash: "saved", files: [{ path: ".artisan/editor.yaml", content: "title: été\n" }], binaries: [{ path: "assets/a.png", size: 4, hash: digest(bytes) }] } }), readBinary: async () => ({ kind: "result", result: { ok: true, content: bytes } }) } as unknown as ProjectStorage;
  const snapshot = await captureProjectSnapshot(storage, "saved");
  expect(snapshot.revision).toBe("saved");
  expect(snapshot.files.map(f => f.path)).toEqual([".artisan/editor.yaml", "assets/a.png"]);
  expect(Buffer.from(snapshot.files[1]!.contentBase64, "base64")).toEqual(Buffer.from(bytes));
  await expect(captureProjectSnapshot(storage, "old")).rejects.toThrow("source_revision_changed");
});

test("concurrent binary mutation cannot produce a mixed saved revision", async () => {
  const storage = { read: async () => ({ kind: "result", result: { ok: true, hash: "saved", files: [], binaries: [{ path: "assets/a.png", size: 1, hash: digest(new Uint8Array([1])) }] } }), readBinary: async () => ({ kind: "result", result: { ok: true, content: new Uint8Array([2]) } }) } as unknown as ProjectStorage;
  await expect(captureProjectSnapshot(storage, "saved")).rejects.toThrow("source_revision_changed");
});

test("private files and incomplete reads cannot enter a transfer", async () => {
  const storage = (path: string, failed: unknown[] = []) => ({ read: async () => ({ kind: "result", result: { ok: true, hash: "saved", files: [{ path, content: "secret" }], failed } }) }) as unknown as ProjectStorage;
  await expect(captureProjectSnapshot(storage(".artisan/drafts/other.json"), "saved")).rejects.toThrow("invalid_path");
  await expect(captureProjectSnapshot(storage("a.yaml", [{}]), "saved")).rejects.toThrow("source_incomplete");
});
