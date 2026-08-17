import { describe, expect, test, beforeEach } from "bun:test";
import { db } from "../db/index";
import { assets, memberships, networks, projects, serverKeys, users, userSessions } from "../db/schema";
import { registerConn, connToServerId, connSenders, handlePluginMessage } from "../ws/hub";
import { writeAssetFile } from "./assetStorage";
import { descendProjectAssets, targetPathFor, rewriteAssetRefs } from "./assetDescent";

/**
 * La **descente** des assets vers le disque du serveur (ADR
 * `assets-on-server-disk`, P3).
 *
 * Elle est pilotée par le hash, jamais par un drapeau « déjà migré » : un
 * serveur hors ligne au mauvais moment laisserait un Project à moitié descendu,
 * et une reprise par curseur repartirait de travers. On rejoue, tout simplement.
 */
describe("descendProjectAssets", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00]);

  beforeEach(async () => {
    await db.delete(assets);
    await db.delete(projects);
    await db.delete(serverKeys);
    await db.delete(memberships);
    await db.delete(networks);
    await db.delete(userSessions);
    await db.delete(users);
  });

  async function seed(opts: { assetId: string; name: string; type: string; codepoint?: number }) {
    await db.insert(networks).values({
      id: "net_d", name: "N", slug: "n", tier: "free", createdAt: new Date(), updatedAt: new Date(),
    });
    await db.insert(serverKeys).values({
      id: "sk_d", hash: "h", networkId: "net_d", createdAt: new Date(), label: null,
    });
    await db.insert(projects).values({
      id: "p_d", networkId: "net_d", serverKeyId: "sk_d", name: "boutique", slug: "boutique",
      externalId: "boutique", createdAt: new Date(), updatedAt: new Date(),
    });
    await db.insert(assets).values({
      id: opts.assetId, projectId: "p_d", type: opts.type, name: opts.name,
      width: 16, height: 16, ascent: 8, codepoint: opts.codepoint ?? null,
      contentWidth: 12, fontMeta: null, contentHash: "c1",
      createdAt: new Date(), updatedAt: new Date(),
    });
    await writeAssetFile("p_d", opts.assetId, png);
  }

  /** Faux plugin : consigne les écritures et répond OK. */
  function fakePlugin(connId: string, serverKeyId: string, tree: Record<string, string>) {
    const writes: Record<string, unknown>[] = [];
    registerConn(connId, (raw: string) => {
      const msg = JSON.parse(raw) as Record<string, unknown> & { type: string; request_id: string };
      if (msg.type === "project_read") {
        void handlePluginMessage(connId, JSON.stringify({
          type: "project_read_result", request_id: msg.request_id, ok: true,
          files: Object.entries(tree).map(([path, content]) => ({ path, content })),
          binaries: [],
        }));
      } else if (msg.type === "asset_write") {
        writes.push(msg);
        void handlePluginMessage(connId, JSON.stringify({
          type: "asset_write_result", request_id: msg.request_id, ok: true,
        }));
      } else if (msg.type === "project_write") {
        writes.push(msg);
        void handlePluginMessage(connId, JSON.stringify({
          type: "project_write_result", request_id: msg.request_id, ok: true,
        }));
      }
    });
    connToServerId.set(connId, serverKeyId);
    return { writes, stop: () => { connSenders.delete(connId); connToServerId.delete(connId); } };
  }

  test("le nom de l'asset devient son chemin, par type", () => {
    expect(targetPathFor("glyph", "icone diamant")).toBe("assets/glyphs/icone-diamant.png");
    expect(targetPathFor("texture", "Fond_Boutique")).toBe("assets/textures/fond_boutique.png");
    // Un nom qui tenterait de sortir du dossier est aplati, pas refusé : le nom
    // vient d'une base à nous, mais un chemin est un chemin.
    expect(targetPathFor("glyph", "../../etc/passwd")).toBe("assets/glyphs/etc-passwd.png");
  });

  test("réécrit les refs en préservant le reste du fichier, commentaires compris", () => {
    const before =
      "# portage zMenu\nschema: menu/v1\ntitle:\n  - kind: background\n    asset_id: ast_9f3c1a  # le fond\n" +
      '  - kind: text\n    font_asset_id: "ast_font1"\n';
    const after = rewriteAssetRefs(before, { ast_9f3c1a: "fond_boutique", ast_font1: "pixelmix" });
    expect(after).toContain("asset: fond_boutique  # le fond");
    expect(after).toContain("font: pixelmix");
    // Le reste du fichier n'a pas bougé — on ne reparse pas pour resérialiser,
    // ça mangerait les commentaires et la mise en forme de l'admin.
    expect(after).toContain("# portage zMenu");
    expect(after).not.toContain("asset_id");
  });

  test("descend les octets, le descripteur, et réécrit les refs", async () => {
    await seed({ assetId: "ast_9f3c1a", name: "icone diamant", type: "glyph", codepoint: 57344 });
    const plugin = fakePlugin("conn-descent", "sk_d", {
      "menus/m.yaml": "schema: menu/v1\ntitle:\n  - kind: glyph\n    asset_id: ast_9f3c1a\n",
    });
    try {
      const report = await descendProjectAssets("sk_d", "p_d", "boutique");
      expect(report.ok).toBe(true);
      expect(report.descended).toEqual(["assets/glyphs/icone-diamant.png"]);

      const assetWrite = plugin.writes.find((w) => w.type === "asset_write")!;
      expect(assetWrite.path).toBe("assets/glyphs/icone-diamant.png");
      expect(Buffer.from(assetWrite.content_base64 as string, "base64").equals(Buffer.from(png)))
        .toBe(true);

      // Le descripteur frère porte ce que le PNG ne sait pas dire, et la
      // réécriture des refs voyage dans la MÊME écriture : à moitié appliquée,
      // elle laisserait des menus qui pointent vers un asset sans descripteur.
      const projectWrite = plugin.writes.find((w) => w.type === "project_write")!;
      const paths = (projectWrite.files as { path: string; content: string }[]).map((f) => f.path);
      expect(paths).toContain("assets/glyphs/icone-diamant.yaml");
      expect(paths).toContain("menus/m.yaml");
      const descriptor = (projectWrite.files as { path: string; content: string }[])
        .find((f) => f.path === "assets/glyphs/icone-diamant.yaml")!.content;
      expect(descriptor).toContain("codepoint: 57344");
      expect(descriptor).toContain("ascent: 8");
    } finally {
      plugin.stop();
    }
  });

  test("rejouée, elle ne réécrit pas ce qui est déjà là", async () => {
    await seed({ assetId: "ast_9f3c1a", name: "diamant", type: "glyph" });
    // Le disque porte déjà l'asset ET la ref réécrite : rien à faire.
    const plugin = fakePlugin("conn-descent-2", "sk_d", {
      "menus/m.yaml": "schema: menu/v1\ntitle:\n  - kind: glyph\n    asset: diamant\n",
      "assets/glyphs/diamant.yaml": "ascent: 8\n",
    });
    try {
      // Le faux plugin annonce le binaire déjà présent avec le bon hash.
      const report = await descendProjectAssets("sk_d", "p_d", "boutique", {
        knownBinaries: { "assets/glyphs/diamant.png": hashOf(png) },
      });
      expect(report.ok).toBe(true);
      expect(report.descended).toEqual([]);
      expect(plugin.writes.filter((w) => w.type === "asset_write")).toHaveLength(0);
    } finally {
      plugin.stop();
    }
  });
});

function hashOf(bytes: Uint8Array): string {
  return require("crypto").createHash("sha256").update(bytes).digest("hex");
}
