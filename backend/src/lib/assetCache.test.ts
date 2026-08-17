import { describe, expect, test, beforeEach } from "bun:test";
import { rm } from "fs/promises";
import { assetCacheRoot, getCachedAsset, putCachedAsset } from "./assetCache";

/**
 * Le cache d'assets (ADR `assets-on-server-disk`, décision 3).
 *
 * C'est un **cache**, pas un store : le perdre ne perd rien, il se re-remplit au
 * prochain accès. Sa clé porte le `contentHash`, donc il n'a pas à être
 * invalidé — un contenu différent est une autre clé, et l'ancienne entrée
 * devient simplement inatteignable.
 */
describe("assetCache", () => {
  beforeEach(async () => {
    await rm(assetCacheRoot(), { recursive: true, force: true });
  });

  const key = { serverKeyId: "sk_1", projectId: "boutique", path: "assets/glyphs/d.png" };
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00]);

  test("rend ce qu'on y a mis, à l'octet près", async () => {
    await putCachedAsset({ ...key, hash: "h1" }, bytes);
    const got = await getCachedAsset({ ...key, hash: "h1" });
    expect(got).not.toBeNull();
    expect(Array.from(got!)).toEqual(Array.from(bytes));
  });

  test("un hash différent est un manque, jamais une version d'à côté", async () => {
    // Le piège que le cache doit rendre impossible : servir l'image d'hier
    // parce qu'elle est au même chemin. Le contenu demandé n'est pas là — on le
    // dit, et l'appelant ira le chercher au serveur.
    await putCachedAsset({ ...key, hash: "h1" }, bytes);
    expect(await getCachedAsset({ ...key, hash: "h2" })).toBeNull();
  });

  test("deux serveurs ne partagent pas leurs entrées", async () => {
    // Même chemin, même hash, réseaux différents : connaître un hash ne doit
    // pas suffire à lire le contenu d'un autre tenant.
    await putCachedAsset({ ...key, hash: "h1" }, bytes);
    const other = await getCachedAsset({ ...key, serverKeyId: "sk_2", hash: "h1" });
    expect(other).toBeNull();
  });

  test("un chemin ne peut pas s'échapper du cache", async () => {
    await expect(
      putCachedAsset({ ...key, path: "../../etc/passwd", hash: "h1" }, bytes),
    ).rejects.toThrow();
  });
});
