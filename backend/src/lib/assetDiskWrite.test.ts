import { describe, expect, test } from "bun:test";
import { registerConn, connToServerId, connSenders, handlePluginMessage } from "../ws/hub";
import {
  assetDiskPath,
  descriptorYaml,
  nextFreeCodepoint,
  writeDiskAsset,
  deleteDiskAsset,
} from "./assetDiskWrite";
import type { DiskAsset } from "./diskAssets";

/**
 * Écriture d'un asset sur le disque du serveur (ADR `assets-on-server-disk`, P5).
 *
 * Le backend relaie, il n'écrit plus : le plugin reste le seul écrivain.
 */
describe("assetDiskWrite", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  function fakePlugin(connId: string, serverKeyId: string, opts: { failWrite?: boolean } = {}) {
    const sent: Record<string, unknown>[] = [];
    registerConn(connId, (raw: string) => {
      const msg = JSON.parse(raw) as { type: string; request_id: string };
      sent.push(msg as Record<string, unknown>);
      if (msg.type === "asset_write") {
        void handlePluginMessage(connId, JSON.stringify({
          type: "asset_write_result", request_id: msg.request_id,
          ok: !opts.failWrite, error: opts.failWrite ? "conflict" : undefined,
        }));
      } else if (msg.type === "project_write") {
        void handlePluginMessage(connId, JSON.stringify({
          type: "project_write_result", request_id: msg.request_id, ok: true,
        }));
      }
    });
    connToServerId.set(connId, serverKeyId);
    return { sent, stop: () => { connSenders.delete(connId); connToServerId.delete(connId); } };
  }

  test("le type donne le dossier, le nom donne le fichier", () => {
    expect(assetDiskPath("glyph", "Icône Diamant")).toBe("assets/glyphs/ic-ne-diamant.png");
    expect(assetDiskPath("texture", "fond_boutique")).toBe("assets/textures/fond_boutique.png");
  });

  test("le descripteur ne porte que ce qu'on sait", () => {
    expect(descriptorYaml({ ascent: 8, codepoint: 57344, width: 16, height: 16 }))
      .toBe("ascent: 8\ncodepoint: 57344\nwidth: 16\nheight: 16\n");
    // Pas de clés nulles : un fichier que l'admin ouvre doit contenir des faits,
    // pas des cases vides.
    expect(descriptorYaml({ ascent: null, codepoint: null })).toBe("{}\n");
  });

  test("le codepoint proposé est le premier libre", () => {
    const used = (cp: number): DiskAsset => ({
      path: `assets/glyphs/g${cp}.png`, hash: "h",
      row: { codepoint: cp } as DiskAsset["row"],
    });
    expect(nextFreeCodepoint([])).toBe(0xe000);
    expect(nextFreeCodepoint([used(0xe000), used(0xe001)])).toBe(0xe002);
  });

  test("écrit les octets PUIS le descripteur", async () => {
    const plugin = fakePlugin("conn-write-asset", "sk_w");
    try {
      const res = await writeDiskAsset("sk_w", "boutique", {
        type: "glyph", name: "diamant", bytes: png,
        descriptor: { ascent: 8, codepoint: 57344 },
        baseHash: null, descriptorBaseHash: null,
      });
      expect(res).toEqual({ ok: true, path: "assets/glyphs/diamant.png" });
      expect(plugin.sent.map((m) => m.type)).toEqual(["asset_write", "project_write"]);
      // L'ordre n'est pas cosmétique : les deux écritures ne peuvent pas être
      // atomiques ensemble, et l'échec entre les deux doit laisser une image
      // sans descripteur (utilisable) plutôt qu'un descripteur sans image
      // (une ligne fantôme dans la bibliothèque).
      expect((plugin.sent[0]!.files as { path: string }[])[0]!.path)
        .toBe("assets/glyphs/diamant.png");
      expect((plugin.sent[1]!.files as { path: string }[])[0]!.path)
        .toBe("assets/glyphs/diamant.yaml");
    } finally {
      plugin.stop();
    }
  });

  test("un conflit d'écriture ne touche pas au descripteur", async () => {
    const plugin = fakePlugin("conn-write-conflict", "sk_c", { failWrite: true });
    try {
      const res = await writeDiskAsset("sk_c", "boutique", {
        type: "glyph", name: "diamant", bytes: png,
        descriptor: { ascent: 8 }, baseHash: null, descriptorBaseHash: null,
      });
      expect(res.ok).toBe(false);
      expect(res.error).toBe("conflict");
      expect(plugin.sent.map((m) => m.type)).toEqual(["asset_write"]);
    } finally {
      plugin.stop();
    }
  });

  test("serveur hors ligne : rien n'est écrit, et on le dit", async () => {
    const res = await writeDiskAsset("sk_absent", "boutique", {
      type: "glyph", name: "diamant", bytes: png,
      descriptor: {}, baseHash: null, descriptorBaseHash: null,
    });
    expect(res).toEqual({ ok: false, error: "server_offline" });
  });

  test("supprimer emporte l'image et son descripteur", async () => {
    const plugin = fakePlugin("conn-del-asset", "sk_d2");
    try {
      const res = await deleteDiskAsset("sk_d2", "boutique", {
        type: "glyph", name: "diamant", baseHash: "h1", descriptorBaseHash: "h2",
      });
      expect(res.ok).toBe(true);
      expect((plugin.sent[0]!.files as { content_base64: string | null }[])[0]!.content_base64)
        .toBeNull();
      expect((plugin.sent[1]!.deletes as { path: string }[])[0]!.path)
        .toBe("assets/glyphs/diamant.yaml");
    } finally {
      plugin.stop();
    }
  });
});
