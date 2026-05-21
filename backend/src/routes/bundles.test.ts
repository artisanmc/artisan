import { describe, expect, test, beforeEach } from "bun:test";
import { Hono } from "hono";
import { db } from "../db/index";
import { networks, serverKeys, packBindings, packs, editorSessions, linkCodes } from "../db/schema";
import { bundlesRouter } from "./bundles";
import { generateServerKey } from "../lib/auth";
import { createNetwork } from "../lib/networkManager";

const PACK_FILES = {
  "plugins/Interfaze/packs/p_test/manifest.yaml": "schema: manifest/v1\npack_id: p_test\n",
  "plugins/Interfaze/packs/p_test/menus/shop.yaml": "id: shop\nsize: 27\n",
};

function buildApp() {
  const app = new Hono();
  app.route("/api/bundles", bundlesRouter);
  return app;
}

async function seedServerKey(label: string): Promise<{ key: string; id: string; networkId: string }> {
  const { id, key, hash } = await generateServerKey();
  const network = await createNetwork(label + "-net");
  await db.insert(serverKeys).values({
    id,
    hash,
    label,
    networkId: network.id,
    createdAt: new Date(),
  });
  return { key, id, networkId: network.id };
}

beforeEach(async () => {
  await db.delete(packBindings);
  await db.delete(packs);
  await db.delete(editorSessions);
  await db.delete(linkCodes);
  await db.delete(serverKeys);
  await db.delete(networks);
});

describe("bundle upload/download", () => {
  test("POST /api/bundles/p_test requires Authorization header", async () => {
    const app = buildApp();
    const res = await app.request("/api/bundles/p_test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: PACK_FILES }),
    });
    expect(res.status).toBe(401);
  });

  test("POST + GET round-trip stores and retrieves bundle", async () => {
    const app = buildApp();
    const { key } = await seedServerKey("bundle-test");

    const uploadRes = await app.request("/api/bundles/p_test", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ files: PACK_FILES }),
    });
    expect(uploadRes.status).toBe(200);
    const uploadBody = (await uploadRes.json()) as { ok: boolean };
    expect(uploadBody.ok).toBe(true);

    const downloadRes = await app.request("/api/bundles/p_test", {
      headers: { "Authorization": `Bearer ${key}` },
    });
    expect(downloadRes.status).toBe(200);
    const body = (await downloadRes.json()) as { files: Record<string, string>; hash: string };
    expect(body.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.files["plugins/Interfaze/packs/p_test/manifest.yaml"]).toContain("manifest/v1");
  });

  test("GET returns 404 Not bound when server key has no binding for pack", async () => {
    const app = buildApp();
    const { key } = await seedServerKey("no-bind-test");

    const res = await app.request("/api/bundles/p_unbound", {
      headers: { "Authorization": `Bearer ${key}` },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Not bound");
  });

  test("second POST by same server key reuses existing pack (no duplicate binding)", async () => {
    const app = buildApp();
    const { key, id: serverKeyId } = await seedServerKey("reuse-test");

    // First push — creates pack + binding
    const res1 = await app.request("/api/bundles/p_reuse", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ files: { "plugins/Interfaze/packs/p_reuse/manifest.yaml": "schema: manifest/v1\npack_id: p_reuse\n" } }),
    });
    expect(res1.status).toBe(200);

    // Second push — pack already exists, should update content not fail
    const updatedFiles = {
      "plugins/Interfaze/packs/p_reuse/manifest.yaml": "schema: manifest/v1\npack_id: p_reuse\n",
      "plugins/Interfaze/packs/p_reuse/menus/shop.yaml": "id: shop\nsize: 54\n",
    };
    const res2 = await app.request("/api/bundles/p_reuse", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ files: updatedFiles }),
    });
    expect(res2.status).toBe(200);

    // Only one binding should exist
    const bindings = await db.select().from(packBindings).where(
      and(eq(packBindings.serverKeyId, serverKeyId), eq(packBindings.packId, "p_reuse"))
    );
    expect(bindings.length).toBe(1);

    // GET should return updated content
    const getRes = await app.request("/api/bundles/p_reuse", {
      headers: { "Authorization": `Bearer ${key}` },
    });
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as { files: Record<string, string>; hash: string };
    expect(getBody.files["plugins/Interfaze/packs/p_reuse/menus/shop.yaml"]).toContain("size: 54");
  });
});
