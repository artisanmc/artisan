import { Hono } from "hono";
import { existsSync } from "fs";
import { join, resolve, sep } from "path";
import { assetsRoot, assetsDone, ensureAssets } from "../lib/mcAssets";
import { customItemsCacheDir, SERVER_KEY_ID_PATTERN } from "../lib/customItems";

const router = new Hono();

router.get(`/custom/:serverKeyId{${SERVER_KEY_ID_PATTERN}}/*`, async (c) => {
  const serverKeyId = c.req.param("serverKeyId");
  const fullPath = c.req.path;
  const prefix = `/custom/${serverKeyId}/`;
  const rest = fullPath.includes(prefix) ? fullPath.split(prefix)[1] : "";
  if (!rest) return c.newResponse(null, 404);

  const baseDir = resolve(customItemsCacheDir(serverKeyId), "models");
  const filePath = resolve(join(baseDir, rest + ".json"));
  if (!filePath.startsWith(baseDir + sep)) return c.newResponse(null, 404);
  if (!existsSync(filePath)) return c.newResponse(null, 404);

  return new Response(Bun.file(filePath), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
  });
});

router.get("/:version/*", async (c) => {
  const version = c.req.param("version");
  const fullPath = c.req.path;
  const prefix = `/${version}/`;
  const rest = fullPath.includes(prefix) ? fullPath.split(prefix)[1] : "";
  if (!rest) return c.newResponse(null, 404);

  if (!assetsDone(version)) {
    ensureAssets(version).catch((err) =>
      console.error(`[mc-assets] Download failed for ${version}:`, err),
    );
    return c.newResponse(null, 404);
  }

  const baseDir = resolve(assetsRoot(version), "models");
  const filePath = resolve(join(baseDir, rest + ".json"));
  if (!filePath.startsWith(baseDir + sep)) return c.newResponse(null, 404);
  if (!existsSync(filePath)) return c.newResponse(null, 404);

  return new Response(Bun.file(filePath), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=31536000, immutable" },
  });
});

export { router as modelsRouter };
