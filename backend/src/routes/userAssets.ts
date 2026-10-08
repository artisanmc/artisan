import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AuthUser } from "../middleware/userAuth";
import { resolveProjectAssets, assetAccessError } from "../lib/resolveProjectAssets";
import { getProject } from "../lib/projectStorage";
import { requestNexoGlyphs } from "../ws/hub";
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

// Import de glyphes Nexo : relais vers le serveur propriétaire du projet, lecture seule.
userAssetsRouter.get("/:projectId/nexo-glyphs/:glyphId?", async (c) => {
  try {
    const projectId = c.req.param("projectId");
    await resolveProjectAssets(c, projectId);
    const project = await getProject(projectId);
    if (!project?.serverKeyId) return c.json({ error: "server_offline" }, 503);
    const glyphId = c.req.param("glyphId");
    const outcome = await requestNexoGlyphs(project.serverKeyId,
      glyphId === undefined ? { type: "nexo_glyphs_list" } : { type: "nexo_glyph_read", glyph_id: glyphId });
    if (outcome.kind !== "result") return c.json({ error: "server_offline" }, 503);
    const { result } = outcome;
    if (!result.ok) return c.json({ error: result.error ?? "read_error" }, result.error === "not_found" ? 404 : 502);
    if (glyphId === undefined) return c.json({ glyphs: result.glyphs ?? [] });
    return c.body(Buffer.from(result.content_base64 ?? "", "base64"), 200, { "Content-Type": "image/png", "Cache-Control": "private, no-cache" });
  } catch (error) { return assetAccessError(c, error); }
});
