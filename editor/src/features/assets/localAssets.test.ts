// @vitest-environment node
import type { ProjectDraft } from "@/features/project/draft";
import type { AssetMutation } from "@/features/project/persistedDrafts";
import { DraftApiError } from "@/lib/api/projectDrafts";
import { diskAssetsFromTree } from "@/lib/pack/diskAssets";
import { createImage, encodePng } from "@/lib/pack/png";
import { sha256Hex } from "@/lib/sha256";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { listLocalAssets, performLocalAssetMutation } from "./localAssets";

/** `w`×`h` PNG whose first `opaque` columns only are opaque. */
function png(w: number, h: number, opaque = w): Uint8Array {
  const image = createImage(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < opaque; x++) image.data[(y * w + x) * 4 + 3] = 255;
  return encodePng(image);
}
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/** The plugin as seen through the hub: a draft, its blobs, the published disk. */
function fakeHub(snapshot: ProjectDraft, published: Record<string, Uint8Array> = {}) {
  const state = {
    draft: {
      id: "d1",
      projectId: "p",
      ownerId: "o",
      name: "Work",
      revision: 3,
      status: "active",
      snapshot,
      source: "editor",
      updatedAt: "",
    },
    blobs: new Map<string, Uint8Array>(),
    calls: [] as string[],
  };
  const fetcher = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    state.calls.push(`${method} ${url.pathname}`);
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    const blob = url.pathname.match(/\/drafts\/d1\/blobs\/([a-f0-9]{64})$/);
    if (method === "GET" && blob) {
      const bytes = state.blobs.get(blob[1]!);
      return bytes
        ? new Response(bytes as Uint8Array<ArrayBuffer>)
        : json({ ok: false, error: "not_found" }, 404);
    }
    if (method === "POST" && url.pathname.endsWith("/drafts/d1/blobs")) {
      const bytes = new Uint8Array(Buffer.from(body.contentBase64, "base64"));
      if (sha256Hex(bytes) !== body.hash || body.revision !== state.draft.revision)
        return json({ ok: false, error: "invalid_blob" }, 422);
      state.blobs.set(body.hash, bytes);
      return json({ ok: true, draft: state.draft });
    }
    if (method === "PUT" && url.pathname.endsWith("/drafts/d1")) {
      if (body.revision !== state.draft.revision)
        return json({ ok: false, error: "draft_conflict", draft: state.draft }, 409);
      state.draft = { ...state.draft, revision: state.draft.revision + 1, snapshot: body.snapshot };
      return json({ ok: true, draft: state.draft });
    }
    if (method === "GET" && url.pathname.endsWith("/drafts/d1"))
      return json({ ok: true, draft: state.draft });
    if (method === "GET" && url.pathname.endsWith("/binary")) {
      const bytes = published[url.searchParams.get("path")!];
      return bytes
        ? new Response(bytes as Uint8Array<ArrayBuffer>)
        : json({ error: "not_found" }, 404);
    }
    if (method === "GET" && url.pathname.endsWith("/files"))
      return json({
        files: Object.entries(snapshot.baseline).map(([path, content]) => ({ path, content })),
        binaries: Object.entries(snapshot.binaryBaseline ?? {}).map(([path, meta]) => ({
          path,
          ...meta,
        })),
        failed: [],
        hash: "h",
      });
    return json({ error: "unexpected" }, 500);
  });
  vi.stubGlobal("fetch", fetcher);
  return state;
}

function op(
  state: { draft: { revision: number; snapshot: ProjectDraft } },
  asset: AssetMutation["asset"],
): AssetMutation {
  return {
    kind: "asset",
    operationId: `op-${Math.random().toString(36).slice(2)}`,
    id: "d1",
    name: "Work",
    revision: state.draft.revision,
    snapshot: state.draft.snapshot,
    asset,
  };
}
const createOp = (
  state: Parameters<typeof op>[0],
  fields: Record<string, string>,
  bytes: Uint8Array,
) =>
  op(state, {
    suffix: "",
    method: "POST",
    fields,
    file: { name: "f", type: "image/png", base64: b64(bytes) },
  });

async function rejection(promise: Promise<unknown>): Promise<DraftApiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DraftApiError);
  return error as DraftApiError;
}

const empty = (): ProjectDraft => ({
  baseline: {},
  tree: {},
  at: 1,
  binaryBaseline: {},
  binaryTree: {},
});

beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("performLocalAssetMutation", () => {
  it("creates a glyph: PNG blob + descriptor with the first free codepoint", async () => {
    const existing = png(8, 8);
    const snapshot = empty();
    snapshot.tree["assets/glyphs/star.yaml"] = "codepoint: 57344\n";
    snapshot.binaryTree = {
      "assets/glyphs/star.png": { hash: sha256Hex(existing), size: existing.length },
    };
    const hub = fakeHub(snapshot);
    const bytes = png(16, 12, 10);

    const result = await performLocalAssetMutation(
      "p",
      createOp(hub, { type: "glyph", name: "heart", ascent: "7", usages: '["menu"]' }, bytes),
    );

    expect(result.draft.revision).toBe(4);
    const written = result.draft.snapshot;
    expect(parse(written.tree["assets/glyphs/heart.yaml"]!)).toEqual({
      ascent: 7,
      codepoint: 57345,
      width: 16,
      height: 12,
      content_width: 10,
      usages: ["menu"],
    });
    expect(written.binaryTree!["assets/glyphs/heart.png"]).toEqual({
      hash: sha256Hex(bytes),
      size: bytes.length,
    });
    expect(Buffer.from(hub.blobs.get(sha256Hex(bytes))!).equals(Buffer.from(bytes))).toBe(true);
    expect(result.asset).toMatchObject({
      id: "heart",
      type: "glyph",
      codepoint: 57345,
      ascent: 7,
      width: 16,
      height: 12,
      usages: ["menu"],
      contentHash: sha256Hex(bytes),
      fontMeta: null,
    });
  });

  it("rejects an existing name with 409 and invalid inputs with the backend messages", async () => {
    const existing = png(8, 8);
    const snapshot = empty();
    snapshot.binaryTree = {
      "assets/textures/bg.png": { hash: sha256Hex(existing), size: existing.length },
    };
    const hub = fakeHub(snapshot);

    const conflict = await rejection(
      performLocalAssetMutation("p", createOp(hub, { type: "texture", name: "bg" }, png(4, 4))),
    );
    expect([conflict.status, conflict.code]).toEqual([409, "Asset name already exists"]);
    const badName = await rejection(
      performLocalAssetMutation(
        "p",
        createOp(hub, { type: "texture", name: "Bad Name" }, png(4, 4)),
      ),
    );
    expect([badName.status, badName.code]).toEqual([400, "Invalid name (must match [a-z0-9_-]+)"]);
    const badPng = await rejection(
      performLocalAssetMutation(
        "p",
        createOp(hub, { type: "texture", name: "x" }, strToU8("nope")),
      ),
    );
    expect(badPng.code).toBe("Invalid PNG");
    expect(hub.calls.filter((call) => !call.startsWith("GET"))).toEqual([]);
  });

  it("unpacks a font zip into one PNG per glyph plus font.yaml", async () => {
    const glyph = png(8, 8, 5);
    const zip = zipSync({
      "font.json": strToU8(
        JSON.stringify({
          providers: [
            { type: "bitmap", file: "artisan:glyphs/a.png", ascent: 7, height: 8, chars: ["a"] },
            { type: "bitmap", file: "artisan:glyphs/b.png", ascent: 7, height: 8, chars: ["b"] },
          ],
        }),
      ),
      "glyphs/a.png": glyph,
      "glyphs/b.png": glyph,
    });
    const hub = fakeHub(empty());

    const result = await performLocalAssetMutation(
      "p",
      op(hub, {
        suffix: "",
        method: "POST",
        fields: { type: "font", name: "pixel" },
        file: { name: "f.zip", type: "application/zip", base64: b64(zip) },
      }),
    );

    const snapshot = result.draft.snapshot;
    expect(Object.keys(snapshot.binaryTree!).sort()).toEqual([
      "assets/fonts/pixel/glyphs/a.png",
      "assets/fonts/pixel/glyphs/b.png",
    ]);
    const descriptor = snapshot.tree["assets/fonts/pixel/font.yaml"]!;
    expect(parse(descriptor)).toMatchObject({
      namespace: "artisan:pixel",
      glyphs: [
        { char: "a", texture: "glyphs/a.png" },
        { char: "b", texture: "glyphs/b.png" },
      ],
    });
    expect(result.asset).toMatchObject({
      id: "pixel",
      type: "font",
      contentHash: sha256Hex(strToU8(descriptor)),
    });
    expect(result.asset!.fontMeta!.glyphMap).toHaveLength(2);
  });

  it("deletes an image and its descriptor, and duplicates a glyph on a new codepoint", async () => {
    const bytes = png(8, 8);
    const snapshot = empty();
    snapshot.tree["assets/glyphs/star.yaml"] = "ascent: 8\ncodepoint: 57344\nwidth: 8\nheight: 8\n";
    snapshot.binaryTree = {
      "assets/glyphs/star.png": { hash: sha256Hex(bytes), size: bytes.length },
    };
    snapshot.binaryBaseline = { ...snapshot.binaryTree };
    const hub = fakeHub(snapshot, { "assets/glyphs/star.png": bytes });

    const copy = await performLocalAssetMutation(
      "p",
      op(hub, { suffix: "/star/duplicate", method: "POST", fields: {} }),
    );
    expect(copy.asset).toMatchObject({ id: "star_copy", codepoint: 57345 });
    expect(copy.draft.snapshot.binaryTree!["assets/glyphs/star_copy.png"]?.hash).toBe(
      sha256Hex(bytes),
    );

    const removed = await performLocalAssetMutation(
      "p",
      op(hub, { suffix: "/star", method: "DELETE", fields: {} }),
    );
    expect(removed.asset).toBeUndefined();
    expect(removed.draft.snapshot.tree).not.toHaveProperty("assets/glyphs/star.yaml");
    expect(removed.draft.snapshot.binaryTree).not.toHaveProperty("assets/glyphs/star.png");
    expect(removed.draft.snapshot.binaryTree).toHaveProperty("assets/glyphs/star_copy.png");

    const missing = await rejection(
      performLocalAssetMutation("p", op(hub, { suffix: "/star", method: "DELETE", fields: {} })),
    );
    expect([missing.status, missing.code]).toEqual([404, "Not found"]);
  });

  it("renames through PATCH using the draft blob bytes", async () => {
    const hub = fakeHub(empty());
    const bytes = png(8, 8);
    await performLocalAssetMutation("p", createOp(hub, { type: "glyph", name: "old" }, bytes));
    const result = await performLocalAssetMutation(
      "p",
      op(hub, { suffix: "/old", method: "PATCH", fields: { name: "new", height: "16" } }),
    );
    expect(result.asset).toMatchObject({ id: "new", height: 16, width: 16, codepoint: 57344 });
    expect(Object.keys(result.draft.snapshot.binaryTree!)).toEqual(["assets/glyphs/new.png"]);
    expect(Object.keys(result.draft.snapshot.tree)).toEqual(["assets/glyphs/new.yaml"]);
  });

  it("surfaces a stale revision as draft_conflict with the server draft", async () => {
    const bytes = png(8, 8);
    const snapshot = empty();
    snapshot.binaryTree = {
      "assets/textures/bg.png": { hash: sha256Hex(bytes), size: bytes.length },
    };
    const hub = fakeHub(snapshot);
    const stale = op(hub, { suffix: "/bg", method: "DELETE", fields: {} });
    hub.draft.revision = 9;
    const error = await rejection(performLocalAssetMutation("p", stale));
    expect([error.status, error.code, error.draft?.revision]).toEqual([409, "draft_conflict", 9]);
  });
});

describe("listLocalAssets", () => {
  it("lists the draft tree exactly like diskAssetsFromTree, and the published tree without draft", async () => {
    const bytes = png(8, 8);
    const snapshot = empty();
    snapshot.baseline["assets/textures/bg.yaml"] = "width: 8\nheight: 8\n";
    snapshot.binaryBaseline = {
      "assets/textures/bg.png": { hash: sha256Hex(bytes), size: bytes.length },
    };
    snapshot.tree = { ...snapshot.baseline, "assets/glyphs/star.yaml": "codepoint: 57344\n" };
    snapshot.binaryTree = {
      ...snapshot.binaryBaseline,
      "assets/glyphs/star.png": { hash: "ab", size: 3 },
    };
    fakeHub(snapshot);

    const expected = diskAssetsFromTree(
      "p",
      Object.entries(snapshot.tree).map(([path, content]) => ({ path, content })),
      Object.entries(snapshot.binaryTree).map(([path, meta]) => ({ path, ...meta })),
    ).map(({ row: { contentWidth: _, createdAt: __, updatedAt: ___, ...row } }) =>
      JSON.parse(JSON.stringify(row)),
    );
    const listed = await listLocalAssets("p", {}, "d1");
    expect(listed.map(({ createdAt: _, updatedAt: __, ...asset }) => asset)).toEqual(expected);
    expect((await listLocalAssets("p", { type: "glyph" }, "d1")).map((a) => a.id)).toEqual([
      "star",
    ]);
    expect((await listLocalAssets("p", {})).map((a) => a.id)).toEqual(["bg"]);
  });
});
