import { describe, expect, test } from "bun:test";
import { app } from "../app";

const PACK_FILES = {
  "plugins/Interfaze/packs/p_test/manifest.yaml": "schema: manifest/v1\npack_id: p_test\n",
  "plugins/Interfaze/packs/p_test/menus/shop.yaml": "id: shop\nsize: 27\n",
};

describe("bundle upload/download", () => {
  test("POST /api/bundles/p_test requires Authorization header", async () => {
    const res = await app.request("/api/bundles/p_test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: PACK_FILES }),
    });
    expect(res.status).toBe(401);
  });

  test("POST + GET round-trip stores and retrieves bundle", async () => {
    const keyRes = await app.request("/api/server-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "bundle-test" }),
    });
    const { key } = (await keyRes.json()) as { key: string };

    const uploadRes = await app.request("/api/bundles/p_test", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ files: PACK_FILES }),
    });
    expect(uploadRes.status).toBe(201);
    const { hash } = (await uploadRes.json()) as { hash: string };
    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    const downloadRes = await app.request("/api/bundles/p_test", {
      headers: { "Authorization": `Bearer ${key}` },
    });
    expect(downloadRes.status).toBe(200);
    const body = (await downloadRes.json()) as { files: Record<string, string>; hash: string };
    expect(body.hash).toBe(hash);
    expect(body.files["plugins/Interfaze/packs/p_test/manifest.yaml"]).toContain("manifest/v1");
  });

  test("POST overwrites canvasLayout from manifest editor_layout (files win)", async () => {
    const keyRes = await app.request("/api/server-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "layout-publish" }),
    });
    const { key } = (await keyRes.json()) as { key: string };

    const files = {
      "plugins/Interfaze/packs/p_layout/manifest.yaml": [
        "schema: manifest/v1",
        "pack_id: p_layout",
        "default_lang: en",
        "files:",
        "  menus: [shop]",
        "  commands: []",
        "  dialogs: []",
        "editor_layout:",
        "  shop: { x: 111, y: 222 }",
      ].join("\n") + "\n",
      "plugins/Interfaze/packs/p_layout/menus/shop.yaml": "id: shop\nsize: 27\n",
    };

    const res = await app.request("/api/bundles/p_layout", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ files }),
    });
    expect(res.status).toBe(201);

    // Verify editorJson.canvasLayout was populated. We round-trip through
    // GET /api/editor-session/:token/packs to read editorJson, but that requires
    // a session. Easier: inspect the DB directly.
    const { db } = await import("../db/index");
    const { packBundles } = await import("../db/schema");
    const { and, eq } = await import("drizzle-orm");
    const row = (await db.select().from(packBundles)
      .where(and(eq(packBundles.packId, "p_layout"))))[0];
    const pack = JSON.parse(row.editorJson!) as { canvasLayout: Record<string, { x: number; y: number }> };
    expect(pack.canvasLayout).toEqual({ shop: { x: 111, y: 222 } });
  });

  test("POST without editor_layout in manifest resets canvasLayout to {}", async () => {
    // Same key as previous test → existing editorJson has canvasLayout. Now
    // publish files with NO editor_layout: files-win means canvasLayout = {}.
    const keyRes = await app.request("/api/server-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "layout-reset" }),
    });
    const { key } = (await keyRes.json()) as { key: string };

    // First publish: with positions.
    const withPos = {
      "plugins/Interfaze/packs/p_reset/manifest.yaml": [
        "schema: manifest/v1", "pack_id: p_reset", "default_lang: en",
        "files:", "  menus: [shop]", "  commands: []", "  dialogs: []",
        "editor_layout:", "  shop: { x: 9, y: 9 }",
      ].join("\n") + "\n",
      "plugins/Interfaze/packs/p_reset/menus/shop.yaml": "id: shop\nsize: 27\n",
    };
    await app.request("/api/bundles/p_reset", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ files: withPos }),
    });

    // Second publish: no editor_layout.
    const withoutPos = {
      "plugins/Interfaze/packs/p_reset/manifest.yaml": [
        "schema: manifest/v1", "pack_id: p_reset", "default_lang: en",
        "files:", "  menus: [shop]", "  commands: []", "  dialogs: []",
      ].join("\n") + "\n",
      "plugins/Interfaze/packs/p_reset/menus/shop.yaml": "id: shop\nsize: 27\n",
    };
    await app.request("/api/bundles/p_reset", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ files: withoutPos }),
    });

    const { db } = await import("../db/index");
    const { packBundles } = await import("../db/schema");
    const { and, eq } = await import("drizzle-orm");
    const row = (await db.select().from(packBundles)
      .where(and(eq(packBundles.packId, "p_reset"))))[0];
    const pack = JSON.parse(row.editorJson!) as { canvasLayout: Record<string, unknown> };
    expect(pack.canvasLayout).toEqual({});
  });

  test("POST overwrites pre-existing non-stub canvasLayout from manifest (real files-win branch)", async () => {
    const keyRes = await app.request("/api/server-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "layout-overwrite" }),
    });
    const { key, id: serverId } = (await keyRes.json()) as { key: string; id: string };

    const { db } = await import("../db/index");
    const { packBundles } = await import("../db/schema");
    const { and, eq } = await import("drizzle-orm");

    // Seed a non-stub editorJson with a stale canvasLayout. isEmptyStub returns
    // false when source !== "imported" OR commands have non-empty steps. Use a
    // user_created source + one command with one step to be safe.
    const staleEditorJson = JSON.stringify({
      id: "p_overwrite",
      name: "Overwrite Me",
      source: "user_created",
      menus: [{ id: "shop" }],
      commands: [{ id: "c1", steps: [{ kind: "action", action: { type: "close_menu" } }] }],
      dialogs: [],
      canvasLayout: { ghost: { x: 1, y: 1 } }, // STALE — must be overwritten
    });
    await db.insert(packBundles).values({
      id: crypto.randomUUID(),
      serverId,
      packId: "p_overwrite",
      hash: "0".repeat(64),
      filesJson: "{}",
      editorJson: staleEditorJson,
      createdAt: new Date(),
    });

    const files = {
      "plugins/Interfaze/packs/p_overwrite/manifest.yaml": [
        "schema: manifest/v1",
        "pack_id: p_overwrite",
        "default_lang: en",
        "files:",
        "  menus: [shop]",
        "  commands: []",
        "  dialogs: []",
        "editor_layout:",
        "  shop: { x: 333, y: 444 }",
      ].join("\n") + "\n",
      "plugins/Interfaze/packs/p_overwrite/menus/shop.yaml": "id: shop\nsize: 27\n",
    };
    const res = await app.request("/api/bundles/p_overwrite", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ files }),
    });
    expect(res.status).toBe(201);

    const row = (await db.select().from(packBundles)
      .where(and(eq(packBundles.serverId, serverId), eq(packBundles.packId, "p_overwrite"))))[0];
    const pack = JSON.parse(row.editorJson!) as { canvasLayout: Record<string, { x: number; y: number }> };
    expect(pack.canvasLayout).toEqual({ shop: { x: 333, y: 444 } }); // manifest wins, ghost is gone
  });
});
