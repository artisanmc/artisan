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
});
