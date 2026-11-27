// @vitest-environment node
import type { ProjectDraft } from "@/features/project/draft";
import type { AssetMutation } from "@/features/project/persistedDrafts";
import { DraftApiError } from "@/lib/api/projectDrafts";
import { diskAssetsFromTree } from "@/lib/pack/diskAssets";
import { createImage, decodePng, encodePng } from "@/lib/pack/png";
import { sha256Hex } from "@/lib/sha256";
import { useKitStore } from "@/state/kitStore";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import {
  freeAssetName,
  listLocalAssets,
  performLocalAssetMutation,
  readAssetFiles,
} from "./localAssets";

// The kit's base, which a composed image may be made of: one cell, without the bundler's files.
vi.mock("@/lib/pack/kitUrls", () => ({
  kitImageUrl: () => undefined,
  kitImageBytes: async (id: string) => {
    if (id !== "cell") throw new Error(`kit_image_missing:${id}`);
    const image = createImage(18, 18);
    image.data.fill(255);
    return encodePng(image);
  },
}));

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
    snapshot.tree["assets/glyphs/star.yml"] = "codepoint: 57344\n";
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
    expect(parse(written.tree["assets/glyphs/heart.yml"]!)).toEqual({
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

  it("takes a name of the kit's base in the kit module only", async () => {
    const hub = fakeHub(empty());
    const refused = await rejection(
      performLocalAssetMutation(
        "p",
        createOp(hub, { type: "glyph", name: "button.3x1" }, png(54, 18)),
      ),
    );
    expect(refused.code).toBe("Invalid name (must match [a-z0-9_-]+)");

    useKitStore.setState({ read: { projectId: "p", files: {}, binaries: [] } });
    try {
      const result = await performLocalAssetMutation(
        "p",
        createOp(hub, { type: "glyph", name: "button.3x1" }, png(54, 18)),
      );
      expect(result.asset).toMatchObject({ id: "button.3x1", width: 54, height: 18 });
      const other = await rejection(
        performLocalAssetMutation(
          "p",
          createOp(hub, { type: "glyph", name: "my.logo" }, png(4, 4)),
        ),
      );
      expect(other.status).toBe(400);
    } finally {
      useKitStore.setState({ read: undefined });
    }
  });

  it("unpacks a font zip into one PNG per glyph plus font.yml", async () => {
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
    const descriptor = snapshot.tree["assets/fonts/pixel/font.yml"]!;
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

  it("writes a theme's image of a module's under that module, lists it apart, and deletes it", async () => {
    const hub = fakeHub(empty());
    const bytes = png(12, 6);
    const fields = { type: "texture", name: "banner", under: "shop" };
    const made = await performLocalAssetMutation(
      "p",
      op(hub, {
        suffix: "",
        method: "POST",
        fields,
        file: { name: "b.png", type: "image/png", base64: b64(bytes) },
      }),
    );
    expect(made.asset).toMatchObject({
      id: "shop/banner",
      name: "banner",
      under: "shop",
      type: "texture",
      width: 12,
      height: 6,
    });
    // The PNG the packs read, and beside it the size the editor shows.
    expect(made.draft.snapshot.binaryTree!["overrides/shop/banner.png"]?.hash).toBe(
      sha256Hex(bytes),
    );
    expect(parse(made.draft.snapshot.tree["overrides/shop/banner.yml"]!)).toEqual({
      width: 12,
      height: 6,
    });
    expect(made.draft.snapshot.binaryTree).not.toHaveProperty("assets/textures/banner.png");
    const listed = await listLocalAssets("p", {}, "d1");
    expect(listed.map((a) => [a.id, a.under, a.width])).toEqual([["shop/banner", "shop", 12]]);

    // A second one of the name is refused; `replace` writes over it; nothing else is edited there.
    const again = {
      suffix: "",
      method: "POST" as const,
      fields,
      file: { name: "b.png", type: "image/png", base64: b64(png(4, 4)) },
    };
    await expect(performLocalAssetMutation("p", op(hub, again))).rejects.toMatchObject({
      status: 409,
    });
    const over = await performLocalAssetMutation(
      "p",
      op(hub, { ...again, fields: { ...fields, replace: "true" } }),
    );
    expect(over.asset).toMatchObject({ id: "shop/banner", width: 4 });
    await expect(
      performLocalAssetMutation(
        "p",
        op(hub, {
          suffix: `/${encodeURIComponent("shop/banner")}`,
          method: "PATCH",
          fields: { name: "other" },
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      performLocalAssetMutation(
        "p",
        op(hub, { ...again, fields: { type: "texture", name: "banner", under: "artisan" } }),
      ),
    ).rejects.toMatchObject({ status: 400 });

    const removed = await performLocalAssetMutation(
      "p",
      op(hub, { suffix: `/${encodeURIComponent("shop/banner")}`, method: "DELETE", fields: {} }),
    );
    expect(removed.draft.snapshot.binaryTree).not.toHaveProperty("overrides/shop/banner.png");
    expect(removed.draft.snapshot.tree).not.toHaveProperty("overrides/shop/banner.yml");
  });

  it("deletes an image and its descriptor, and duplicates a glyph on a new codepoint", async () => {
    const bytes = png(8, 8);
    const snapshot = empty();
    snapshot.tree["assets/glyphs/star.yml"] = "ascent: 8\ncodepoint: 57344\nwidth: 8\nheight: 8\n";
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
    expect(removed.draft.snapshot.tree).not.toHaveProperty("assets/glyphs/star.yml");
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
    expect(Object.keys(result.draft.snapshot.tree)).toEqual(["assets/glyphs/new.yml"]);
  });

  it("states an image's function in its descriptor, keeps it across a retouch and a rename, and clears it", async () => {
    const hub = fakeHub(empty());
    await performLocalAssetMutation(
      "p",
      createOp(hub, { type: "texture", name: "panel", function: "menu" }, png(8, 8)),
    );
    expect(parse(hub.draft.snapshot.tree["assets/textures/panel.yml"]!)).toMatchObject({
      function: "menu",
    });
    const retouched = await performLocalAssetMutation(
      "p",
      createOp(hub, { type: "texture", name: "panel", retouch: "true" }, png(8, 8, 2)),
    );
    expect(retouched.asset).toMatchObject({ function: "menu" });
    const renamed = await performLocalAssetMutation(
      "p",
      op(hub, { suffix: "/panel", method: "PATCH", fields: { name: "frame", function: "hud" } }),
    );
    expect(renamed.asset).toMatchObject({ id: "frame", function: "hud" });
    expect(parse(hub.draft.snapshot.tree["assets/textures/frame.yml"]!)).toMatchObject({
      function: "hud",
    });
    const refused = await rejection(
      performLocalAssetMutation(
        "p",
        op(hub, { suffix: "/frame", method: "PATCH", fields: { function: "button" } }),
      ),
    );
    expect([refused.status, refused.code]).toEqual([400, "Invalid function (menu, glyph, hud)"]);
    const cleared = await performLocalAssetMutation(
      "p",
      op(hub, { suffix: "/frame", method: "PATCH", fields: { function: "" } }),
    );
    expect(cleared.asset?.function).toBeUndefined();
    expect(parse(hub.draft.snapshot.tree["assets/textures/frame.yml"]!)).not.toHaveProperty(
      "function",
    );
  });

  it("keeps an image's margins across a retouch and a rename, sets them on a menu image and takes them off", async () => {
    const hub = fakeHub(empty());
    await performLocalAssetMutation(
      "p",
      createOp(hub, { type: "texture", name: "panel", function: "menu" }, png(8, 8)),
    );
    await performLocalAssetMutation(
      "p",
      op(hub, { suffix: "/panel", method: "PATCH", fields: { slice: '{"left":2,"right":3}' } }),
    );
    const slice = { left: 2, right: 3, top: 0, bottom: 0 };
    const retouched = await performLocalAssetMutation(
      "p",
      createOp(hub, { type: "texture", name: "panel", retouch: "true" }, png(8, 8, 2)),
    );
    expect(retouched.asset).toMatchObject({ slice });
    const renamed = await performLocalAssetMutation(
      "p",
      op(hub, { suffix: "/panel", method: "PATCH", fields: { name: "frame" } }),
    );
    expect(renamed.asset).toMatchObject({ id: "frame", slice });
    expect(parse(hub.draft.snapshot.tree["assets/textures/frame.yml"]!)).toMatchObject({ slice });
    const set = await performLocalAssetMutation(
      "p",
      op(hub, { suffix: "/frame", method: "PATCH", fields: { slice: '{"top":1}' } }),
    );
    expect(set.asset).toMatchObject({ slice: { left: 0, right: 0, top: 1, bottom: 0 } });
    const refused = await rejection(
      performLocalAssetMutation(
        "p",
        op(hub, { suffix: "/frame", method: "PATCH", fields: { slice: '{"top":1.5}' } }),
      ),
    );
    expect(refused.status).toBe(400);
    const cleared = await performLocalAssetMutation(
      "p",
      op(hub, { suffix: "/frame", method: "PATCH", fields: { slice: "null" } }),
    );
    expect(cleared.asset?.slice).toBeUndefined();
    expect(parse(hub.draft.snapshot.tree["assets/textures/frame.yml"]!)).not.toHaveProperty(
      "slice",
    );
  });

  it("retouches an image the module ships: the owner's version beside the original", async () => {
    const original = png(8, 8, 6);
    const snapshot = empty();
    snapshot.tree["originals/assets/glyphs/gem.yml"] =
      "ascent: 7\ncodepoint: 57350\nwidth: 16\nheight: 16\nusages: [button]\n";
    snapshot.binaryTree = {
      "originals/assets/glyphs/gem.png": { hash: sha256Hex(original), size: original.length },
    };
    snapshot.binaryBaseline = { ...snapshot.binaryTree };
    const hub = fakeHub(snapshot, { "originals/assets/glyphs/gem.png": original });
    const mine = png(8, 8, 3);
    const result = await performLocalAssetMutation(
      "p",
      createOp(hub, { type: "glyph", name: "gem", retouch: "true" }, mine),
    );
    // The original's codepoint, ascent, shown size and uses: menus need nothing.
    expect(result.asset).toMatchObject({
      id: "gem",
      codepoint: 57350,
      ascent: 7,
      width: 16,
      height: 16,
      usages: ["button"],
      contentHash: sha256Hex(mine),
    });
    expect(parse(result.draft.snapshot.tree["assets/glyphs/gem.yml"]!)).toMatchObject({
      ascent: 7,
      codepoint: 57350,
      width: 16,
      height: 16,
      usages: ["button"],
    });
    // The original stays as the server wrote it.
    expect(result.draft.snapshot.binaryTree).toEqual({
      "originals/assets/glyphs/gem.png": { hash: sha256Hex(original), size: original.length },
      "assets/glyphs/gem.png": { hash: sha256Hex(mine), size: mine.length },
    });
    expect(result.draft.snapshot.tree["originals/assets/glyphs/gem.yml"]).toBe(
      snapshot.tree["originals/assets/glyphs/gem.yml"],
    );
    // Another size than the original's is refused, as for any retouch.
    const resized = await rejection(
      performLocalAssetMutation(
        "p",
        createOp(
          fakeHub(snapshot, { "originals/assets/glyphs/gem.png": original }),
          {
            type: "glyph",
            name: "gem",
            retouch: "true",
          },
          png(8, 9),
        ),
      ),
    );
    expect([resized.status, resized.code]).toEqual([400, "A retouch keeps the image's size"]);
  });

  it("gives layers to an image the module ships: the owner's composed image takes its name", async () => {
    const original = png(8, 8, 6);
    const snapshot = empty();
    snapshot.tree["originals/assets/glyphs/gem.yml"] = "ascent: 7\ncodepoint: 57350\n";
    snapshot.binaryTree = {
      "originals/assets/glyphs/gem.png": { hash: sha256Hex(original), size: original.length },
    };
    snapshot.binaryBaseline = { ...snapshot.binaryTree };
    const hub = fakeHub(snapshot, { "originals/assets/glyphs/gem.png": original });
    // The owner holds no file of that name: nothing to rename (what the atelier used to ask).
    const renamed = await rejection(
      performLocalAssetMutation(
        "p",
        op(hub, { suffix: "/gem", method: "PATCH", fields: { name: "gem_layer" } }),
      ),
    );
    expect(renamed.status).toBe(404);
    // Its pixels are copied as a layer of the owner's, then composed under the shipped name.
    await performLocalAssetMutation(
      "p",
      createOp(hub, { type: "glyph", name: "gem_layer", usages: "[]", ascent: "7" }, original),
    );
    const made = await performLocalAssetMutation(
      "p",
      op(hub, {
        suffix: "",
        method: "POST",
        fields: {
          type: "glyph",
          name: "gem",
          ascent: "7",
          compose: JSON.stringify({
            layers: [{ image: "gem_layer", x: 0, y: 0, columns: 1, rows: 1 }],
            width: null,
            height: null,
          }),
        },
      }),
    );
    expect(made.asset).toMatchObject({ id: "gem", ascent: 7, width: 8, height: 8 });
    expect(made.asset?.compose?.layers).toHaveLength(1);
    // The library lists the name once, as the composed image; the original stays on the disk.
    const listed = await listLocalAssets("p", {}, "d1");
    expect(listed.map((a) => [a.id, !!a.compose])).toEqual([
      ["gem", true],
      ["gem_layer", false],
    ]);
    expect(Object.keys(made.draft.snapshot.binaryTree!).sort()).toEqual([
      "assets/glyphs/gem_layer.png",
      "originals/assets/glyphs/gem.png",
    ]);
  });

  it("retouches an image: other pixels under the same name, at the size it is shown", async () => {
    const hub = fakeHub(empty());
    await performLocalAssetMutation(
      "p",
      createOp(
        hub,
        { type: "glyph", name: "gem", ascent: "7", usages: '["button"]' },
        png(8, 8, 6),
      ),
    );
    // Shown twice its file's height: the descriptor says 16, the file stays 8 pixels.
    await performLocalAssetMutation(
      "p",
      op(hub, { suffix: "/gem", method: "PATCH", fields: { height: "16" } }),
    );
    const retouched = png(8, 8, 3);
    const result = await performLocalAssetMutation(
      "p",
      createOp(hub, { type: "glyph", name: "gem", retouch: "true" }, retouched),
    );
    expect(result.asset).toMatchObject({
      id: "gem",
      codepoint: 57344,
      ascent: 7,
      width: 16,
      height: 16,
      usages: ["button"],
      contentHash: sha256Hex(retouched),
    });
    expect(parse(result.draft.snapshot.tree["assets/glyphs/gem.yml"]!)).toEqual({
      ascent: 7,
      codepoint: 57344,
      width: 16,
      height: 16,
      content_width: 6,
      usages: ["button"],
    });
    expect(result.draft.snapshot.binaryTree).toEqual({
      "assets/glyphs/gem.png": { hash: sha256Hex(retouched), size: retouched.length },
    });

    // A reimport takes the new file's size; a retouch refuses another one.
    const resized = await rejection(
      performLocalAssetMutation(
        "p",
        createOp(hub, { type: "glyph", name: "gem", retouch: "true" }, png(8, 9)),
      ),
    );
    expect([resized.status, resized.code]).toEqual([400, "A retouch keeps the image's size"]);
    const missing = await rejection(
      performLocalAssetMutation(
        "p",
        createOp(hub, { type: "glyph", name: "none", retouch: "true" }, png(8, 8)),
      ),
    );
    expect(missing.status).toBe(404);
    const reimported = await performLocalAssetMutation(
      "p",
      createOp(hub, { type: "glyph", name: "gem", replace: "true" }, png(8, 9)),
    );
    expect(reimported.asset).toMatchObject({ width: 8, height: 9, codepoint: 57344 });
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
    snapshot.baseline["assets/textures/bg.yml"] = "width: 8\nheight: 8\n";
    snapshot.binaryBaseline = {
      "assets/textures/bg.png": { hash: sha256Hex(bytes), size: bytes.length },
    };
    snapshot.tree = { ...snapshot.baseline, "assets/glyphs/star.yml": "codepoint: 57344\n" };
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

describe("composed images", () => {
  const recipe =
    "ascent: 13\ncodepoint: 57344\nusages: [menu]\ncompose:\n  - use: 'kit:cell'\n  - image: frame\n    x: 18\n  - grid: icon\n    x: 2\n    y: 2\n    columns: 2\n  - image: gone\n";
  function hubWithRecipe() {
    const [frame, icon] = [png(20, 10), png(4, 4)];
    const snapshot = empty();
    snapshot.tree["assets/glyphs/window.yml"] = recipe;
    snapshot.binaryTree = {
      "assets/textures/frame.png": { hash: sha256Hex(frame), size: frame.length },
      "assets/textures/icon.png": { hash: sha256Hex(icon), size: icon.length },
    };
    snapshot.binaryBaseline = { ...snapshot.binaryTree };
    return fakeHub(snapshot, {
      "assets/textures/frame.png": frame,
      "assets/textures/icon.png": icon,
    });
  }
  const sizeOf = (url: string | undefined) => {
    const { width, height } = decodePng(Buffer.from((url ?? "").split(",")[1] ?? "", "base64"));
    return [width, height];
  };

  it("lists one with the picture the pack assembles, its size and its layers", async () => {
    hubWithRecipe();
    const listed = await listLocalAssets("p", {}, "d1");
    expect(listed.map((a) => a.id)).toEqual(["window", "frame", "icon"]);
    const window = listed[0]!;
    // As large as its first layer, the kit's cell; the frame beside it is clipped away.
    expect(window).toMatchObject({
      type: "glyph",
      codepoint: 57344,
      width: 18,
      height: 18,
      compose: { width: null, height: null },
    });
    expect(window.previewUrl).toMatch(/^data:image\/png;base64,/);
    expect(sizeOf(window.previewUrl)).toEqual([18, 18]);
    expect(window.compose?.layers.map((layer) => layer.image)).toEqual([
      "kit:cell",
      "frame",
      "icon",
      "gone",
    ]);
    expect(listed[1]).not.toHaveProperty("compose");
    // A list to copy from leaves it out, and it cannot be read for a copy.
    expect((await listLocalAssets("p", { composed: false }, "d1")).map((a) => a.id)).toEqual([
      "frame",
      "icon",
    ]);
    const refused = await rejection(readAssetFiles("p", { id: "window", type: "glyph" }, "d1"));
    expect(refused.status).toBe(400);
  });

  it("renames, duplicates and deletes one through its descriptor alone", async () => {
    const hub = hubWithRecipe();
    const binaries = Object.keys(hub.draft.snapshot.binaryTree!);

    const renamed = await performLocalAssetMutation(
      "p",
      op(hub, { suffix: "/window", method: "PATCH", fields: { name: "hall", ascent: "9" } }),
    );
    expect(renamed.asset).toMatchObject({ id: "hall", ascent: 9, codepoint: 57344, width: 18 });
    expect(sizeOf(renamed.asset?.previewUrl)).toEqual([18, 18]);
    expect(renamed.draft.snapshot.tree).not.toHaveProperty("assets/glyphs/window.yml");
    const kept = parse(renamed.draft.snapshot.tree["assets/glyphs/hall.yml"]!);
    expect(kept).toMatchObject({ ascent: 9, codepoint: 57344, usages: ["menu"] });
    expect(kept.compose).toEqual(parse(recipe).compose);

    const copy = await performLocalAssetMutation(
      "p",
      op(hub, { suffix: "/hall/duplicate", method: "POST", fields: {} }),
    );
    expect(copy.asset).toMatchObject({ id: "hall_copy", codepoint: 57345 });
    expect(parse(copy.draft.snapshot.tree["assets/glyphs/hall_copy.yml"]!).compose).toEqual(
      kept.compose,
    );

    // A PNG imported under its name would hide the recipe: refused, as any taken name.
    const taken = await rejection(
      performLocalAssetMutation("p", createOp(hub, { type: "glyph", name: "hall" }, png(8, 8))),
    );
    expect([taken.status, taken.code]).toEqual([409, "Asset name already exists"]);
    const resized = await rejection(
      performLocalAssetMutation(
        "p",
        op(hub, { suffix: "/hall", method: "PATCH", fields: { height: "16" } }),
      ),
    );
    expect(resized.status).toBe(400);

    const removed = await performLocalAssetMutation(
      "p",
      op(hub, { suffix: "/hall", method: "DELETE", fields: {} }),
    );
    expect(Object.keys(removed.draft.snapshot.tree)).toEqual(["assets/glyphs/hall_copy.yml"]);
    expect(Object.keys(removed.draft.snapshot.binaryTree!)).toEqual(binaries);
  });

  it("turns a PNG into a composed image of the same name, the PNG kept as its layer", async () => {
    const button = png(54, 18);
    const snapshot = empty();
    snapshot.tree["assets/glyphs/go.yml"] =
      "ascent: 8\ncodepoint: 57344\nwidth: 54\nheight: 18\nusages: [button]\n";
    snapshot.binaryTree = {
      "assets/glyphs/go.png": { hash: sha256Hex(button), size: button.length },
    };
    snapshot.binaryBaseline = { ...snapshot.binaryTree };
    const hub = fakeHub(snapshot, { "assets/glyphs/go.png": button });
    // What `toLayers` asks for (imageLayers.ts): the PNG renamed, then a recipe under its name.
    const renamed = await performLocalAssetMutation(
      "p",
      op(hub, {
        suffix: "/go",
        method: "PATCH",
        fields: { name: "go_layer", usages: "[]" },
      }),
    );
    expect(renamed.asset).toMatchObject({ id: "go_layer", width: 54, height: 18, usages: [] });
    const made = await performLocalAssetMutation(
      "p",
      op(hub, {
        suffix: "",
        method: "POST",
        fields: {
          type: "glyph",
          name: "go",
          ascent: "8",
          usages: '["button"]',
          compose: JSON.stringify({
            width: null,
            height: null,
            layers: [{ image: "go_layer", x: 0, y: 0, columns: 1, rows: 1 }],
          }),
        },
      }),
    );
    expect(made.asset).toMatchObject({ id: "go", width: 54, height: 18, usages: ["button"] });
    expect(Object.keys(made.draft.snapshot.tree).sort()).toEqual([
      "assets/glyphs/go.yml",
      "assets/glyphs/go_layer.yml",
    ]);
    expect(Object.keys(made.draft.snapshot.binaryTree!)).toEqual(["assets/glyphs/go_layer.png"]);
    expect(parse(made.draft.snapshot.tree["assets/glyphs/go.yml"]!).compose).toEqual([
      { image: "go_layer" },
    ]);
  });

  it("creates one from a recipe, and rewrites its layers and size on a patch", async () => {
    const hub = hubWithRecipe();
    const layer = (image: string, x = 0, y = 0, columns = 1, rows = 1) => ({
      image,
      x,
      y,
      columns,
      rows,
    });
    const compose = (
      layers: unknown[],
      width: number | null = null,
      height: number | null = null,
    ) => JSON.stringify({ layers, width, height });

    const made = await performLocalAssetMutation(
      "p",
      op(hub, {
        suffix: "",
        method: "POST",
        fields: {
          type: "glyph",
          name: "panel",
          ascent: "13",
          usages: '["menu"]',
          compose: compose([layer("kit:cell"), layer("icon", 2, 2)]),
        },
      }),
    );
    expect(made.asset).toMatchObject({
      id: "panel",
      type: "glyph",
      ascent: 13,
      codepoint: 57345,
      usages: ["menu"],
      width: 18,
      height: 18,
    });
    expect(sizeOf(made.asset?.previewUrl)).toEqual([18, 18]);
    expect(parse(made.draft.snapshot.tree["assets/glyphs/panel.yml"]!)).toEqual({
      ascent: 13,
      codepoint: 57345,
      usages: ["menu"],
      compose: [{ use: "kit:cell" }, { image: "icon", x: 2, y: 2 }],
    });
    expect(Object.keys(made.draft.snapshot.binaryTree!)).toHaveLength(2);

    const edited = await performLocalAssetMutation(
      "p",
      op(hub, {
        suffix: "/panel",
        method: "PATCH",
        fields: { compose: compose([layer("kit:cell", 0, 0, 3, 2), layer("frame", 4, 1)], 60, 40) },
      }),
    );
    expect(edited.asset).toMatchObject({ id: "panel", codepoint: 57345, width: 60, height: 40 });
    expect(edited.asset?.compose).toEqual({
      layers: [layer("kit:cell", 0, 0, 3, 2), layer("frame", 4, 1)],
      width: 60,
      height: 40,
    });
    expect(sizeOf(edited.asset?.previewUrl)).toEqual([60, 40]);
    expect(parse(edited.draft.snapshot.tree["assets/glyphs/panel.yml"]!)).toEqual({
      ascent: 13,
      codepoint: 57345,
      usages: ["menu"],
      width: 60,
      height: 40,
      compose: [
        { grid: "kit:cell", columns: 3, rows: 2 },
        { image: "frame", x: 4, y: 1 },
      ],
    });

    // Back to a size the layers give: the two sides leave the file together.
    const grown = await performLocalAssetMutation(
      "p",
      op(hub, {
        suffix: "/panel",
        method: "PATCH",
        fields: { compose: compose([layer("frame")]) },
      }),
    );
    expect(grown.asset).toMatchObject({ width: 20, height: 10 });
    expect(parse(grown.draft.snapshot.tree["assets/glyphs/panel.yml"]!)).toEqual({
      ascent: 13,
      codepoint: 57345,
      usages: ["menu"],
      compose: [{ image: "frame" }],
    });

    // What the pack would not draw is refused, as is a recipe for an image that has a PNG.
    for (const bad of [
      compose([]),
      compose([layer("icon", 0, 0, 99)]),
      compose([layer("icon", 600)]),
      compose([layer("icon")], 60),
      compose([{ x: 1 }]),
    ]) {
      const refused = await rejection(
        performLocalAssetMutation(
          "p",
          op(hub, { suffix: "/panel", method: "PATCH", fields: { compose: bad } }),
        ),
      );
      expect(refused.status).toBe(400);
    }
    const png = await rejection(
      performLocalAssetMutation(
        "p",
        op(hub, {
          suffix: "/frame",
          method: "PATCH",
          fields: { compose: compose([layer("icon")]) },
        }),
      ),
    );
    expect(png.status).toBe(400);
    const taken = await rejection(
      performLocalAssetMutation(
        "p",
        op(hub, {
          suffix: "",
          method: "POST",
          fields: { type: "glyph", name: "frame", compose: compose([layer("icon")]) },
        }),
      ),
    );
    expect(taken.status).toBe(409);
  });
});

const copyOp = (state: Parameters<typeof op>[0], fields: Record<string, string>) =>
  op(state, { suffix: "/copy", method: "POST", fields });

describe("copying an asset from another project", () => {
  it("picks name, name_2, name_3… among every asset id", () => {
    expect(freeAssetName("star", ["bg"])).toBe("star");
    expect(freeAssetName("star", ["star", "star_2"])).toBe("star_3");
  });

  it("reads an image and its descriptor from the published disk", async () => {
    const bytes = png(8, 8);
    const snapshot = empty();
    snapshot.baseline["assets/glyphs/star.yml"] = "ascent: 6\ncodepoint: 57344\n";
    snapshot.binaryBaseline = {
      "assets/glyphs/star.png": { hash: sha256Hex(bytes), size: bytes.length },
    };
    fakeHub(snapshot, { "assets/glyphs/star.png": bytes });

    const files = await readAssetFiles("p", { id: "star", type: "glyph" });
    expect(files.type).toBe("glyph");
    expect(files.descriptor).toBe("ascent: 6\ncodepoint: 57344\n");
    expect(Buffer.from(files.binaries[0]!.bytes).equals(Buffer.from(bytes))).toBe(true);
  });

  it("lands a glyph under a free name, on a codepoint of this project, keeping its metrics", async () => {
    const mine = png(8, 8);
    const theirs = png(4, 4);
    const snapshot = empty();
    snapshot.tree["assets/glyphs/star.yml"] = "codepoint: 57344\n";
    snapshot.binaryTree = {
      "assets/glyphs/star.png": { hash: sha256Hex(mine), size: mine.length },
    };
    const hub = fakeHub(snapshot);

    const result = await performLocalAssetMutation(
      "p",
      copyOp(hub, {
        type: "glyph",
        name: "star",
        descriptor: "ascent: 6\ncodepoint: 57344\nusages:\n  - button\n",
        files: JSON.stringify([{ path: "", base64: b64(theirs) }]),
      }),
    );

    const written = result.draft.snapshot;
    expect(parse(written.tree["assets/glyphs/star_2.yml"]!)).toEqual({
      ascent: 6,
      codepoint: 57345,
      usages: ["button"],
    });
    expect(written.binaryTree!["assets/glyphs/star_2.png"]?.hash).toBe(sha256Hex(theirs));
    expect(written.binaryTree!["assets/glyphs/star.png"]?.hash).toBe(sha256Hex(mine));
    expect(result.asset).toMatchObject({
      id: "star_2",
      name: "star_2",
      projectId: "p",
      codepoint: 57345,
      ascent: 6,
      usages: ["button"],
    });
  });

  it("copies a font folder, renaming its namespace with it", async () => {
    const glyph = png(8, 8);
    const snapshot = empty();
    snapshot.tree["assets/fonts/pixel/font.yml"] = "namespace: artisan:pixel\nglyphs: []\n";
    const hub = fakeHub(snapshot);

    const result = await performLocalAssetMutation(
      "p",
      copyOp(hub, {
        type: "font",
        name: "pixel",
        descriptor:
          "namespace: artisan:pixel\nglyphs:\n  - char: a\n    texture: a.png\n    ascent: 7\n    height: 8\n    width: 8\n",
        files: JSON.stringify([{ path: "a.png", base64: b64(glyph) }]),
      }),
    );

    const written = result.draft.snapshot;
    expect(parse(written.tree["assets/fonts/pixel_2/font.yml"]!).namespace).toBe("artisan:pixel_2");
    expect(written.binaryTree!["assets/fonts/pixel_2/a.png"]?.hash).toBe(sha256Hex(glyph));
    expect(written.tree["assets/fonts/pixel/font.yml"]).toBe(
      "namespace: artisan:pixel\nglyphs: []\n",
    );
    expect(result.asset).toMatchObject({ id: "pixel_2", type: "font" });
    expect(result.asset?.fontMeta?.glyphMap.map((g) => g.char)).toEqual(["a"]);
  });

  it("refuses a font glyph outside its folder", async () => {
    const hub = fakeHub(empty());
    const error = await rejection(
      performLocalAssetMutation(
        "p",
        copyOp(hub, {
          type: "font",
          name: "pixel",
          descriptor: "glyphs: []\n",
          files: JSON.stringify([{ path: "../x.png", base64: b64(png(2, 2)) }]),
        }),
      ),
    );
    expect([error.status, error.code]).toEqual([400, "Invalid path"]);
  });
});
