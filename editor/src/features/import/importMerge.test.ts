import { hashBytes } from "@/lib/contentHash";
import { describe, expect, it } from "vitest";
import {
  type ImportReference,
  type ImportTree,
  diffImport,
  prepareImportTree,
  resolveImport,
} from "./importMerge";

async function binary(content: string): Promise<ImportTree["binaries"][string]> {
  const bytes = new TextEncoder().encode(content);
  return { bytes, hash: await hashBytes(bytes), size: bytes.length };
}

async function input(
  files: Record<string, string>,
  binaries: Record<string, string> = {},
): Promise<ImportTree> {
  const mapped: ImportTree["binaries"] = {};
  for (const [path, content] of Object.entries(binaries)) mapped[path] = await binary(content);
  return { files, binaries: mapped };
}

describe("diffImport", () => {
  it("classifies additions, identical files, conflicts and server-only files", async () => {
    const reference: ImportReference = {
      files: { "menus/a.yaml": "same", "menus/b.yaml": "server-b", "menus/gone.yaml": "bye" },
      binaries: { "assets/keep.png": await hashMeta("keep") },
    };
    const tree = await input(
      { "menus/a.yaml": "same", "menus/b.yaml": "import-b", "menus/new.yaml": "hello" },
      { "assets/keep.png": "keep", "assets/new.png": "new" },
    );

    const diff = diffImport(tree, reference);
    expect(diff.additions.sort()).toEqual(["assets/new.png", "menus/new.yaml"]);
    expect(diff.identical).toEqual(["assets/keep.png", "menus/a.yaml"]);
    expect(diff.conflicts.map((c) => c.path)).toEqual(["menus/b.yaml"]);
    expect(diff.serverOnly).toEqual(["menus/gone.yaml"]);
  });

  it("a differing binary is a binary conflict, without text content", async () => {
    const tree = await input({}, { "assets/icon.png": "import" });
    const reference: ImportReference = {
      files: {},
      binaries: { "assets/icon.png": await hashMeta("server") },
    };

    const diff = diffImport(tree, reference);
    expect(diff.conflicts).toEqual([
      {
        path: "assets/icon.png",
        kind: "binary",
        server: null,
        serverBinary: await hashMeta("server"),
      },
    ]);
  });
});

describe("resolveImport — overwrite", () => {
  it("the import becomes the state, the server-only files disappear", async () => {
    const tree = await input({ "menus/a.yaml": "import-a" }, { "assets/i.png": "i" });
    const reference: ImportReference = {
      files: { "menus/a.yaml": "server-a", "menus/old.yaml": "old" },
      binaries: { "assets/old.png": await hashMeta("old") },
    };

    const resolved = resolveImport(tree, reference, "overwrite");
    expect(resolved.files).toEqual({ "menus/a.yaml": "import-a" });
    expect(Object.keys(resolved.binaries)).toEqual(["assets/i.png"]);
    expect(resolved.binaries["assets/i.png"]!.bytes).toBeDefined();
  });
});

describe("resolveImport — fusion", () => {
  const reference = async (): Promise<ImportReference> => ({
    files: { "menus/a.yaml": "same", "menus/b.yaml": "server-b", "menus/kept.yaml": "kept" },
    binaries: {
      "assets/same.png": await hashMeta("same"),
      "assets/diff.png": await hashMeta("server-diff"),
    },
  });

  it("adds the import, keeps the server-only files, and the import wins conflicts by default", async () => {
    const tree = await input(
      { "menus/a.yaml": "same", "menus/b.yaml": "import-b", "menus/new.yaml": "new" },
      { "assets/same.png": "same", "assets/diff.png": "import-diff" },
    );

    const resolved = resolveImport(tree, await reference(), "merge");
    expect(resolved.files).toEqual({
      "menus/a.yaml": "same",
      "menus/b.yaml": "import-b",
      "menus/kept.yaml": "kept",
      "menus/new.yaml": "new",
    });
    expect(resolved.binaries["assets/diff.png"]!.bytes).toBeDefined();
    expect(resolved.binaries["assets/same.png"]!.hash).toBe((await hashMeta("same")).hash);
  });

  it("a 'server' choice keeps the server's content and identity", async () => {
    const tree = await input({ "menus/b.yaml": "import-b" }, { "assets/diff.png": "import-diff" });

    const resolved = resolveImport(tree, await reference(), "merge", {
      "menus/b.yaml": "server",
      "assets/diff.png": "server",
    });
    expect(resolved.files["menus/b.yaml"]).toBe("server-b");
    expect(resolved.binaries["assets/diff.png"]).toEqual({
      hash: (await hashMeta("server-diff")).hash,
      size: (await hashMeta("server-diff")).size,
    });
    expect(resolved.binaries["assets/diff.png"]!.bytes).toBeUndefined();
  });
});

describe("prepareImportTree", () => {
  it("separates text and binaries and computes the binaries' identity", async () => {
    const entries = { "menus/a.yaml": "x: 1", "assets/i.png": new Uint8Array([1, 2, 3]) };
    const tree = await prepareImportTree(entries);
    expect(tree.files).toEqual({ "menus/a.yaml": "x: 1" });
    expect(tree.binaries["assets/i.png"]).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      hash: await hashBytes(new Uint8Array([1, 2, 3])),
      size: 3,
    });
  });
});

async function hashMeta(content: string): Promise<{ hash: string; size: number }> {
  const bytes = new TextEncoder().encode(content);
  return { hash: await hashBytes(bytes), size: bytes.length };
}
