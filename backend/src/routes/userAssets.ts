import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AuthUser } from "../middleware/userAuth";
import { resolveProjectAssets, assetAccessError } from "../lib/resolveProjectAssets";
import { handleAssetCreate, handleAssetList, handleAssetGet, handleAssetPatch, handleAssetDuplicate, handleAssetDelete } from "../lib/assetHandlers";
export const userAssetsRouter = new Hono<{ Variables: { user: AuthUser | null } }>();
userAssetsRouter.use("*", bodyLimit({ maxSize: 32 * 1024 * 1024 }));
const routes = [
  ["get", "/:projectId/assets", handleAssetList], ["get", "/:projectId/assets/:id", handleAssetGet],
  ["post", "/:projectId/assets", handleAssetCreate], ["patch", "/:projectId/assets/:id", handleAssetPatch],
  ["post", "/:projectId/assets/:id/duplicate", handleAssetDuplicate], ["delete", "/:projectId/assets/:id", handleAssetDelete],
] as const;
for (const [method, path, handler] of routes) userAssetsRouter[method](path, async (c) => {
  try {
    const ctx = await resolveProjectAssets(c, c.req.param("projectId"), method !== "get");
    const response = await handler(c, ctx);
    if (ctx.overlay?.updatedDraft && response.ok) {
      const body = response.status === 204 ? {} : await response.json();
      return c.json({ ...body, draft: { ...ctx.overlay.updatedDraft, projectId: ctx.projectId } }, response.status === 201 ? 201 : 200);
    }
    return response;
  } catch (error) { return assetAccessError(c, error); }
});
