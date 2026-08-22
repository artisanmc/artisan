import { Hono } from "hono";
import { listDiskAssets, readDiskAssetBytes } from "../lib/diskAssets";
import { existsSync } from "fs";
import { join, resolve, sep } from "path";
import { textureFilePath, assetsDone, ensureAssets } from "../lib/mcAssets";
import { customItemsCacheDir } from "../lib/customItems";
import { db } from "../db/index";
import { projects } from "../db/schema";
import { eq } from "drizzle-orm";

const router = new Hono();

router.get("/custom/:serverKeyId/*", async (c) => {
  const serverKeyId = c.req.param("serverKeyId");
  const fullPath = c.req.path;
  const prefix = `/custom/${serverKeyId}/`;
  const rest = fullPath.includes(prefix) ? fullPath.split(prefix)[1] : "";
  if (!rest) return c.newResponse(null, 404);

  const baseDir = resolve(customItemsCacheDir(serverKeyId), "textures");
  const filePath = resolve(join(baseDir, rest + ".png"));
  // Reject any path that escapes the base directory
  if (!filePath.startsWith(baseDir + sep)) return c.newResponse(null, 404);
  if (!existsSync(filePath)) return c.newResponse(null, 404);

  return new Response(Bun.file(filePath), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-cache" },
  });
});

/**
 * Aperçu d'un asset, lu sur le disque du serveur (ADR `assets-on-server-disk`).
 * Le repli sur le volume backend est parti avec la table (P6) : un aperçu servi
 * depuis une copie que plus personne ne met à jour finirait par montrer autre
 * chose que ce qui est en jeu.
 *
 * `assetId` est un NOM de fichier : la vieille garde `^asset_[a-zA-Z0-9]+$`
 * refuserait tout asset descendu.
 */
router.get("/asset/:projectId/:assetId", async (c) => {
  const projectId = c.req.param("projectId");
  const assetId = c.req.param("assetId");
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId) || !/^[a-zA-Z0-9_.-]+$/.test(assetId)) {
    return c.newResponse(null, 400);
  }

  const anchor = (await db.select().from(projects).where(eq(projects.id, projectId)))[0];
  if (anchor?.serverKeyId) {
    const diskId = anchor.externalId ?? anchor.id;
    const found = await listDiskAssets(anchor.serverKeyId, diskId, anchor.id);
    const asset = found?.find((a) => a.row.id === assetId);
    if (asset) {
      const bytes = await readDiskAssetBytes(anchor.serverKeyId, diskId, asset);
      if (bytes) {
        return new Response(bytes as unknown as BodyInit, {
          headers: {
            "Content-Type": "image/png",
            // L'URL porte déjà le hash (`?h=`) : une réponse ne peut pas
            // devenir fausse sans que l'URL change.
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }
    }
  }

  return c.newResponse(null, 404);
});

/**
 * Un glyphe d'une police, par son chemin dans le dossier de la police.
 *
 * Une seule forme, servie par une route large parce que le chemin d'un glyphe
 * compte un nombre de segments variable :
 *
 *   /asset-font/<projectId>/<police>/<chemin>
 *
 * L'URL porte le Project depuis que les polices vivent sur le disque (ADR
 * `assets-on-server-disk`) : leur identité est un nom de dossier, unique dans
 * leur Project et nulle part ailleurs. L'ancienne forme sans Project est partie
 * avec la table (P6).
 */
router.get("/asset-font/*", async (c) => {
  const marker = "/asset-font/";
  const idx = c.req.path.indexOf(marker);
  const tail = idx >= 0 ? c.req.path.slice(idx + marker.length) : "";
  const segments = tail.split("/").filter(Boolean);
  if (segments.length < 2 || tail.includes("..")) return c.newResponse(null, 404);

  const anchor = (await db.select().from(projects).where(eq(projects.id, segments[0]!)))[0];
  if (anchor?.serverKeyId && segments.length >= 3) {
    const assetId = segments[1]!;
    const rest = segments.slice(2).join("/");
    const diskId = anchor.externalId ?? anchor.id;
    const found = await listDiskAssets(anchor.serverKeyId, diskId, anchor.id);
    const font = found?.find((a) => a.row.type === "font" && a.row.id === assetId);
    if (font) {
      const dir = font.path.slice(0, font.path.lastIndexOf("/"));
      const bytes = await readDiskAssetBytes(anchor.serverKeyId, diskId, {
        ...font,
        path: `${dir}/${rest}`,
        // Le hash du descripteur ne décrit pas ce PNG : on ne range rien sous
        // une clé qui mentirait.
        hash: "",
      });
      if (bytes) {
        return new Response(bytes as unknown as BodyInit, {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }
    }
  }

  return c.newResponse(null, 404);
});

router.get("/:version/*", async (c) => {
  const version = c.req.param("version");
  const fullPath = c.req.path;
  const prefix = `/${version}/`;
  const rest = fullPath.includes(prefix) ? fullPath.split(prefix)[1] : "";

  // Assets not yet downloaded for this version — start background download and
  // return 404 so the editor falls back gracefully. Once done, future requests
  // will hit the fast local-file path.
  if (!assetsDone(version)) {
    ensureAssets(version).catch((err) =>
      console.error(`[mc-assets] Download failed for ${version}:`, err),
    );
    return c.newResponse(null, 404);
  }

  const filePath = textureFilePath(version, rest);
  if (!filePath) return c.newResponse(null, 404);

  const file = Bun.file(filePath);
  return new Response(file, {
    headers: {
      "Content-Type": "image/png",
      // Vanilla textures are versioned in the URL — safe to cache indefinitely.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
});

export { router as texturesRouter };
