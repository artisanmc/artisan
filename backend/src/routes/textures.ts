import { Hono } from "hono";
import { listDiskAssets, readDiskAssetBytes } from "../lib/diskAssets";
import { existsSync } from "fs";
import { join, resolve, sep } from "path";
import { textureFilePath, assetsDone, ensureAssets } from "../lib/mcAssets";
import { customItemsCacheDir } from "../lib/customItems";
import { assetPath } from "../lib/assetStorage";
import { db } from "../db/index";
import { assets, projects } from "../db/schema";
import { eq } from "drizzle-orm";
import { readFontGlyph } from "../lib/fontStorage";

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
 * Aperçu d'un asset. Le disque du serveur d'abord, le volume backend ensuite
 * (ADR `assets-on-server-disk`) — ce dernier disparaît en P6 avec la table.
 *
 * `assetId` est désormais un NOM de fichier : la vieille garde
 * `^asset_[a-zA-Z0-9]+$` refuserait tout asset descendu.
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

  const filePath = assetPath(projectId, assetId);
  if (!existsSync(filePath)) return c.newResponse(null, 404);
  return new Response(Bun.file(filePath), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-cache" },
  });
});

router.get("/asset-font/:assetId/*", async (c) => {
  const assetId = c.req.param("assetId");
  const fullPath = c.req.path;
  const prefix = `/asset-font/${assetId}/`;
  const idx = fullPath.indexOf(prefix);
  const rest = idx >= 0 ? fullPath.slice(idx + prefix.length) : "";
  if (!rest) return c.newResponse(null, 404);

  const rows = await db.select().from(assets).where(eq(assets.id, assetId));
  const row = rows[0];
  if (!row || row.type !== "font") return c.newResponse(null, 404);

  const bytes = await readFontGlyph(row.projectId, assetId, rest);
  if (!bytes) return c.newResponse(null, 404);

  return new Response(bytes, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
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
