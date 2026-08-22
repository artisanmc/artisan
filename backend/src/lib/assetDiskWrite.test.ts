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
import { CODEPOINT_MAX, CODEPOINT_MIN } from "./codepoints";

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

  const used = (cp: number): DiskAsset => ({
    path: `assets/glyphs/g${cp}.png`,
    hash: "h",
    row: { codepoint: cp } as DiskAsset["row"],
  });

  test("le codepoint proposé est le premier libre", () => {
    expect(nextFreeCodepoint([])).toBe(0xe000);
    expect(nextFreeCodepoint([used(0xe000), used(0xe001)])).toBe(0xe002);
  });

  /**
   * U+F800..U+F8FF appartient aux providers `space` (cf. `spaceOffsets.ts`), et
   * U+F900+ au bloc CJK Compatibility dont la police par défaut a des glyphes.
   * L'allocateur SQL s'arrêtait à U+F7FF pour cette raison ; son successeur sur
   * disque montait jusqu'à U+F8FF — il aurait fini par attribuer à un glyphe le
   * codepoint d'une espace.
   */
  test("ne sort pas de la plage réservée aux glyphes", () => {
    const all: DiskAsset[] = [];
    for (let cp = CODEPOINT_MIN; cp <= CODEPOINT_MAX; cp++) all.push(used(cp));
    expect(() => nextFreeCodepoint(all)).toThrow();
    expect(nextFreeCodepoint(all.slice(0, -1))).toBe(CODEPOINT_MAX);
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
