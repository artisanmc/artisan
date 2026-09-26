import { expect, test } from "bun:test";
import { ServerProjectStorage } from "./ServerProjectStorage";

test("server adapter binds project identity and preserves CAS failures", async () => {
  const calls: unknown[] = [];
  const conflict = { kind: "result" as const, result: { type: "project_write_result" as const, request_id: "one", ok: false, error: "conflict" as const, conflicts: [{ path: "menu.yaml", disk: "changed" }] } };
  const storage = new ServerProjectStorage({ kind: "server", serverKeyId: "server-a", folderName: "shop" }, {
    write: async (...args) => { calls.push(args); return conflict; },
    invalidate: (...args) => { calls.push(args); },
  });
  const batch = { files: [{ path: "menu.yaml", content: "changed", base_hash: "old" }] };
  const { type, request_id, ...result } = conflict.result;
  expect(await storage.write(batch)).toEqual({ kind: "result", result });
  expect(calls).toEqual([["server-a", "shop"], ["server-a", { projectId: "shop", ...batch }], ["server-a", "shop"]]);
});

test("binary transport preserves exact bytes without leaking base64 into the storage API", async () => {
  const bytes = new Uint8Array([0, 255, 10, 128]);
  let written: unknown;
  const storage = new ServerProjectStorage({ kind: "server", serverKeyId: "server-a", folderName: "shop" }, {
    readBinary: async () => ({ kind: "result", result: { type: "asset_read_result", request_id: "read", ok: true, content_base64: Buffer.from(bytes).toString("base64"), hash: "hash" } }),
    writeBinaries: async (_server, request) => { written = request; return { kind: "offline" }; },
    invalidate: () => {},
  });
  const result = await storage.readBinary("textures/test.png");
  expect(result).toMatchObject({ kind: "result", result: { ok: true, content: bytes, hash: "hash" } });
  if (result.kind === "result") expect(result.result).not.toHaveProperty("content_base64");
  expect(await storage.writeBinaries([{ path: "textures/test.png", content: bytes, baseHash: null }])).toEqual({ kind: "offline" });
  expect(written).toEqual({ projectId: "shop", files: [{ path: "textures/test.png", contentBase64: Buffer.from(bytes).toString("base64"), baseHash: null }] });
});

test("with the snapshot mirror, reads go through the tree reader and honour if_hash", async () => {
  const mirror = await import("../snapshotMirror");
  mirror.recordHello("server-m", []);
  const tree = { kind: "result" as const, result: { type: "project_read_result" as const, request_id: "", ok: true, hash: "H1", files: [{ path: "a.yaml", content: "a" }] } };
  const plugin: unknown[] = [];
  const storage = new ServerProjectStorage({ kind: "server", serverKeyId: "server-m", folderName: "shop" }, {
    read: async (...args) => { plugin.push(args); return tree; },
    readAssets: async () => tree,
  });
  try {
    expect(await storage.read()).toEqual({ kind: "result", result: { ok: true, hash: "H1", files: [{ path: "a.yaml", content: "a" }] } });
    expect(await storage.read("H1")).toEqual({ kind: "result", result: { ok: true, unchanged: true, hash: "H1" } });
    expect(plugin).toEqual([]);
  } finally {
    mirror.forgetServer("server-m");
  }
});
