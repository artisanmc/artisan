import { Hono } from "hono";
import { resolveProjectAssets, assetAccessError } from "../lib/resolveProjectAssets";
import { userAuth } from "../middleware/userAuth";
import { existsSync } from "fs";
import { join, resolve, sep } from "path";
import { textureFilePath, assetsDone, ensureAssets } from "../lib/mcAssets";
import { customItemsCacheDir } from "../lib/customItems";

const router = new Hono();
router.use("/asset/*", userAuth());
router.use("/asset-font/*", userAuth());

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
  try {
    const ctx = await resolveProjectAssets(c, c.req.param("projectId"));
    const list = await ctx.assets.read();
    if (!list.ok) return c.json({ error: list.error }, 503);
    const asset = list.assets.find((a) => a.row.id === c.req.param("assetId"));
    const bytes = asset ? await ctx.assets.bytes(asset) : null;
    if (!bytes) return c.newResponse(null, 404);
    return new Response(bytes as BodyInit, { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-cache" } });
  } catch (error) { return assetAccessError(c, error); }
});

router.get("/asset-font/*", async (c) => {
  try {
    const tail = c.req.path.split("/asset-font/")[1] ?? "";
    const [projectId, assetId, ...parts] = tail.split("/");
    if (!projectId || !assetId || !parts.length || parts.some((p) => !p || p === ".." || p === "." || p.includes("\\"))) return c.newResponse(null, 404);
    const ctx = await resolveProjectAssets(c, projectId);
    const list = await ctx.assets.read();
    if (!list.ok) return c.json({ error: list.error }, 503);
    const font = list.assets.find((a) => a.row.type === "font" && a.row.id === assetId);
    if (!font) return c.newResponse(null, 404);
    const path = `${font.path.slice(0, font.path.lastIndexOf("/"))}/${parts.join("/")}`;
    const meta = list.binaries.find((b) => b.path === path);
    if (!meta) return c.newResponse(null, 404);
    const bytes = await ctx.assets.bytes({ ...font, path, hash: meta.hash });
    if (!bytes) return c.newResponse(null, 404);
    return new Response(bytes as BodyInit, { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-cache" } });
  } catch (error) { return assetAccessError(c, error); }
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
