import { Hono } from "hono";
import { existsSync } from "fs";
import { validateAccessToken } from "../lib/auth";
import { rebuildResourcePack } from "../lib/resourcePack";
import { resourcePackPath } from "../lib/resourcePackStorage";
import { pushResourcePackUpdated } from "../ws/hub";

const HASH_RE = /^[0-9a-f]{40}$/;
const SK_RE = /^[a-zA-Z0-9-]+$/;

export const resourcePackPublicRouter = new Hono();
export const resourcePackAdminRouter = new Hono();

resourcePackPublicRouter.get("/:serverKeyId/:hashFile", async (c) => {
  const serverKeyId = c.req.param("serverKeyId");
  const hashFile = c.req.param("hashFile");
  if (!SK_RE.test(serverKeyId)) return c.newResponse(null, 400);
  if (!hashFile.endsWith(".zip")) return c.newResponse(null, 404);
  const hash = hashFile.slice(0, -4);
  if (!HASH_RE.test(hash)) return c.newResponse(null, 400);

  const filePath = resourcePackPath(serverKeyId, hash);
  if (!existsSync(filePath)) return c.newResponse(null, 404);

  return new Response(Bun.file(filePath), {
    headers: {
      "Content-Type": "application/zip",
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: `"${hash}"`,
    },
  });
});

resourcePackAdminRouter.post("/:token/resource-pack/rebuild", async (c) => {
  const token = c.req.param("token");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const info = await rebuildResourcePack(session.serverKeyId);
  pushResourcePackUpdated(session.serverKeyId, info.url, info.hash);
  return c.json(info);
});
