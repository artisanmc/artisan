import { Hono } from "hono";
import { existsSync } from "fs";
import { rebuildResourcePack } from "../lib/resourcePack";
import { resourcePackPath } from "../lib/resourcePackStorage";
import { pushResourcePackUpdated } from "../ws/hub";

const HASH_RE = /^[0-9a-f]{40}$/;
const SK_RE = /^[a-zA-Z0-9_-]+$/;

export const resourcePackPublicRouter = new Hono();

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

/**
 * Shared handler — rebuild the resource project for `serverKeyId` and broadcast
 * the update. Called from the user-scoped route (cookie + membership, see
 * userNetworks.ts).
 */
export async function handleResourcePackRebuild(c: { json: (body: unknown, status?: number) => Response }, serverKeyId: string) {
  const info = await rebuildResourcePack(serverKeyId);
  pushResourcePackUpdated(serverKeyId, info.url, info.hash);
  return c.json(info);
}
