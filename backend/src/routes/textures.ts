import { Hono } from "hono";
import { existsSync } from "fs";
import { join, resolve, sep } from "path";
import { textureFilePath, assetsDone, ensureAssets } from "../lib/mcAssets";
import { customItemsCacheDir } from "../lib/customItems";

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
      "Cache-Control": "no-cache",
    },
  });
});

export { router as texturesRouter };
