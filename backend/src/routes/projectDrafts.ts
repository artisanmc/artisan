import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { db } from "../db";
import { projectDrafts } from "../db/schema";
import { requireCapability } from "../lib/membershipGuard";
import { publishDraftSnapshot, validDraftBody } from "../lib/projectDrafts";
import { getProject, projectDiskId } from "../lib/projectStorage";
import type { AuthUser } from "../middleware/userAuth";

export const projectDraftsRouter = new Hono<{ Variables: { user: AuthUser | null } }>();
const base = "/:projectId/drafts";
for (const path of [base, `${base}/*`]) {
  projectDraftsRouter.use(path, bodyLimit({ maxSize: 8 * 1024 * 1024 }));
  projectDraftsRouter.use(path, async (c, next) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const project = await getProject(c.req.param("projectId")!);
    if (!project || project.deletedAt) return c.json({ error: "not_found" }, 404);
    try {
      await requireCapability(user.id, project.networkId, "edit_content");
    } catch {
      return c.json({ error: "forbidden" }, 403);
    }
    await next();
  });
}

projectDraftsRouter.get(base, async (c) => {
  const drafts = await db
    .select()
    .from(projectDrafts)
    .where(
      and(
        eq(projectDrafts.projectId, c.req.param("projectId")),
        eq(projectDrafts.ownerId, c.get("user")!.id),
        eq(projectDrafts.status, "active"),
      ),
    )
    .orderBy(desc(projectDrafts.updatedAt));
  return c.json({ drafts });
});
projectDraftsRouter.get(`${base}/:draftId`, async (c) => {
  const [draft] = await db
    .select()
    .from(projectDrafts)
    .where(
      and(
        eq(projectDrafts.id, c.req.param("draftId")),
        eq(projectDrafts.projectId, c.req.param("projectId")),
        eq(projectDrafts.ownerId, c.get("user")!.id),
      ),
    );
  return draft ? c.json({ draft }) : c.json({ error: "not_found" }, 404);
});
projectDraftsRouter.post(base, async (c) => {
  const body = await c.req.json().catch(() => null);
  const id = body?.id;
  if (!validDraftBody(body) || typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(id))
    return c.json({ error: "invalid_input" }, 422);
  const now = new Date();
  const [draft] = await db
    .insert(projectDrafts)
    .values({
      id,
      projectId: c.req.param("projectId"),
      ownerId: c.get("user")!.id,
      name: body.name,
      snapshot: body.snapshot,
      updatedBy: c.get("user")!.id,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (!draft) return c.json({ error: "draft_exists" }, 409);
  return c.json({ draft }, 201);
});

for (const method of ["put", "delete"] as const) {
  projectDraftsRouter[method](`${base}/:draftId`, async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!Number.isSafeInteger(body?.revision) || body.revision < 1)
      return c.json({ error: "invalid_input" }, 422);
    if (method === "put" && !validDraftBody(body)) return c.json({ error: "invalid_input" }, 422);
    const scope = and(
      eq(projectDrafts.id, c.req.param("draftId")),
      eq(projectDrafts.projectId, c.req.param("projectId")),
      eq(projectDrafts.ownerId, c.get("user")!.id),
    );
    const [draft] = await db
      .update(projectDrafts)
      .set({
        ...(method === "delete"
          ? { status: "discarded" }
          : { name: body.name, snapshot: body.snapshot }),
        revision: sql`${projectDrafts.revision} + 1`,
        updatedAt: new Date(),
        updatedBy: c.get("user")!.id,
      })
      .where(
        and(scope, eq(projectDrafts.revision, body.revision), eq(projectDrafts.status, "active")),
      )
      .returning();
    if (draft) return c.json({ draft });
    const [current] = await db.select().from(projectDrafts).where(scope);
    return current
      ? c.json({ error: "draft_conflict", draft: current }, 409)
      : c.json({ error: "not_found" }, 404);
  });
}

projectDraftsRouter.post(`${base}/:draftId/publish`, async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!Number.isSafeInteger(body?.revision) || body.revision < 1)
    return c.json({ error: "invalid_input" }, 422);
  const project = await getProject(c.req.param("projectId"));
  if (!project || project.deletedAt) return c.json({ error: "not_found" }, 404);
  try {
    await requireCapability(c.get("user")!.id, project.networkId, "publish_content");
  } catch {
    return c.json({ error: "forbidden" }, 403);
  }
  return db.transaction(async (tx) => {
    const [draft] = await tx
      .select()
      .from(projectDrafts)
      .where(
        and(
          eq(projectDrafts.id, c.req.param("draftId")),
          eq(projectDrafts.projectId, project.id),
          eq(projectDrafts.ownerId, c.get("user")!.id),
        ),
      )
      .for("update");
    if (!draft) return c.json({ error: "not_found" }, 404);
    if (draft.revision !== body.revision || draft.status !== "active")
      return c.json({ error: "draft_conflict", draft }, 409);
    const outcome = await publishDraftSnapshot(
      project.serverKeyId,
      projectDiskId(project),
      draft.snapshot,
    );
    if (outcome.kind === "offline") return c.json({ error: "server_offline" }, 503);
    if (outcome.kind === "timeout") return c.json({ error: "fetch_timeout" }, 504);
    if (!outcome.result.ok) {
      const result = outcome.result;
      return c.json(result, result.error === "conflict" ? 409 : 422);
    }
    const [published] = await tx
      .update(projectDrafts)
      .set({ status: "published", revision: draft.revision + 1, updatedAt: new Date() })
      .where(eq(projectDrafts.id, draft.id))
      .returning();
    return c.json({ ok: true, draft: published, wrote: outcome.wrote });
  });
});
