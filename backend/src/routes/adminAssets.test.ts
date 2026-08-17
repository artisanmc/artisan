import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { db } from "../db/index";
import { assets, memberships, networks, projects, serverKeys, users, userSessions } from "../db/schema";
import { buildAdminAssetsRouter } from "./adminAssets";
import { registerConn, connToServerId, connSenders, handlePluginMessage } from "../ws/hub";
import { writeAssetFile } from "../lib/assetStorage";

/**
 * Descente déclenchée depuis l'admin (ADR `assets-on-server-disk`, P3).
 *
 * Une route plutôt qu'un script : la descente doit s'exécuter là où vivent les
 * connexions WS des plugins, donc dans l'instance déployée.
 */
describe("POST /admin/assets/descend", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  function makeApp() {
    const app = new Hono();
    app.route("/api/v1/admin", buildAdminAssetsRouter());
    return app;
  }

  beforeEach(async () => {
    await db.delete(assets);
    await db.delete(projects);
    await db.delete(serverKeys);
    await db.delete(memberships);
    await db.delete(networks);
    await db.delete(userSessions);
    await db.delete(users);
  });

  async function seed(serverKeyId: string) {
    await db.insert(networks).values({
      id: "net_a", name: "N", slug: "n", tier: "free", createdAt: new Date(), updatedAt: new Date(),
    });
    await db.insert(serverKeys).values({
      id: serverKeyId, hash: `h_${serverKeyId}`, networkId: "net_a", createdAt: new Date(), label: null,
    });
    await db.insert(projects).values({
      id: "p_a", networkId: "net_a", serverKeyId, name: "boutique", slug: "boutique",
      externalId: "boutique", createdAt: new Date(), updatedAt: new Date(),
    });
    await db.insert(assets).values({
      id: "ast_1", projectId: "p_a", type: "glyph", name: "diamant",
      width: 16, height: 16, ascent: 8, codepoint: 57344, contentWidth: 12,
      fontMeta: null, contentHash: "c", createdAt: new Date(), updatedAt: new Date(),
    });
    await writeAssetFile("p_a", "ast_1", png);
  }

  test("descend ce qui doit l'être et rend le détail", async () => {
    await seed("sk_live");
    const connId = "conn-admin-descend";
    registerConn(connId, (raw: string) => {
      const msg = JSON.parse(raw) as { type: string; request_id: string };
      if (msg.type === "project_read") {
        void handlePluginMessage(connId, JSON.stringify({
          type: "project_read_result", request_id: msg.request_id, ok: true,
          files: [], binaries: [],
        }));
      } else if (msg.type === "asset_write" || msg.type === "project_write") {
        void handlePluginMessage(connId, JSON.stringify({
          type: `${msg.type}_result`, request_id: msg.request_id, ok: true,
        }));
      }
    });
    connToServerId.set(connId, "sk_live");
    try {
      const res = await makeApp().request("/api/v1/admin/assets/descend", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.descended).toEqual(["sk_live/boutique assets/glyphs/diamant.png"]);
      expect(body.failures).toEqual([]);
    } finally {
      connSenders.delete(connId);
      connToServerId.delete(connId);
    }
  });

  test("un serveur hors ligne est SAUTÉ, pas mis en échec", async () => {
    // La descente se rejoue : un serveur éteint au mauvais moment doit pouvoir
    // être repris plus tard, pas faire échouer toute la migration.
    await seed("sk_off");
    const res = await makeApp().request("/api/v1/admin/assets/descend", { method: "POST" });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.skipped).toEqual(["sk_off/boutique"]);
    expect(body.descended).toEqual([]);
  });
});
