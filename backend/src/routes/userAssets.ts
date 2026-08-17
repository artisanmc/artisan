// backend/src/routes/userAssets.ts
// User-scoped twin of assets.ts (cookie auth + membership guard instead of
// the session token + assertBound). Zero business-logic duplication — every
// route delegates to the shared handle* functions extracted in assets.ts.
import { Hono } from "hono";
import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { projects as projectsTable } from "../db/schema";
import { getNetworkOfProject, requireMember } from "../lib/membershipGuard";
import type { AuthUser } from "../middleware/userAuth";
import {
  handleAssetCreate,
  handleAssetList,
  handleAssetGet,
  handleAssetPatch,
  handleAssetDuplicate,
  handleAssetDelete,
} from "../lib/assetHandlers";

type Vars = { user: AuthUser | null };

export const userAssetsRouter = new Hono<{ Variables: Vars }>();

function getUserId(c: Context<{ Variables: Vars }>): string | null {
  return c.get("user")?.id ?? null;
}

type MemberResult =
  | { ok: true; serverKeyId: string }
  | { ok: false; response: Response };

/** Resolve project → networkId → membership, mirroring userProjects.ts's pattern. */
async function resolveMember(
  c: Context<{ Variables: Vars }>,
  projectId: string,
): Promise<MemberResult> {
  const userId = getUserId(c);
  if (!userId) return { ok: false, response: c.json({ error: "unauthorized" }, 401) };

  const networkId = await getNetworkOfProject(projectId);
  if (networkId === null) return { ok: false, response: c.json({ error: "not_found" }, 404) };

  try {
    await requireMember(userId, networkId);
  } catch {
    return { ok: false, response: c.json({ error: "forbidden" }, 403) };
  }

  const rows = await db
    .select({ serverKeyId: projectsTable.serverKeyId })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  const serverKeyId = rows[0]?.serverKeyId ?? null;
  if (!serverKeyId) return { ok: false, response: c.json({ error: "not_found" }, 404) };

  return { ok: true, serverKeyId };
}

userAssetsRouter.post("/:projectId/assets", async (c: Context<{ Variables: Vars }>) => {
  const projectId = c.req.param("projectId");
  const check = await resolveMember(c, projectId);
  if (!check.ok) return check.response;
  return handleAssetCreate(c, { projectId, serverKeyId: check.serverKeyId });
});

userAssetsRouter.get("/:projectId/assets", async (c: Context<{ Variables: Vars }>) => {
  const projectId = c.req.param("projectId");
  const check = await resolveMember(c, projectId);
  if (!check.ok) return check.response;
  return handleAssetList(c, { projectId, serverKeyId: check.serverKeyId });
});

userAssetsRouter.get("/:projectId/assets/:id", async (c: Context<{ Variables: Vars }>) => {
  const projectId = c.req.param("projectId");
  const check = await resolveMember(c, projectId);
  if (!check.ok) return check.response;
  return handleAssetGet(c, { projectId, serverKeyId: check.serverKeyId });
});

userAssetsRouter.patch("/:projectId/assets/:id", async (c: Context<{ Variables: Vars }>) => {
  const projectId = c.req.param("projectId");
  const check = await resolveMember(c, projectId);
  if (!check.ok) return check.response;
  return handleAssetPatch(c, { projectId, serverKeyId: check.serverKeyId });
});

userAssetsRouter.post("/:projectId/assets/:id/duplicate", async (c: Context<{ Variables: Vars }>) => {
  const projectId = c.req.param("projectId");
  const check = await resolveMember(c, projectId);
  if (!check.ok) return check.response;
  return handleAssetDuplicate(c, { projectId, serverKeyId: check.serverKeyId });
});

userAssetsRouter.delete("/:projectId/assets/:id", async (c: Context<{ Variables: Vars }>) => {
  const projectId = c.req.param("projectId");
  const check = await resolveMember(c, projectId);
  if (!check.ok) return check.response;
  return handleAssetDelete(c, { projectId, serverKeyId: check.serverKeyId });
});
