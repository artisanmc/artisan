import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AuthUser } from "../middleware/userAuth";
import { beginCopy, copyDto, listCopyTargets, readCopy, resumeCopy, type CopyInput } from "../lib/projectCopy";

export const projectCopiesRouter = new Hono<{ Variables: { user: AuthUser | null } }>();
for (const path of ["/:projectId/copy-targets", "/:projectId/copies", "/:projectId/copies/*"]) projectCopiesRouter.use(path, async (c, next) => {
  if (!c.get("user")) return c.json({ error: "unauthorized" }, 401);
  await next();
});
projectCopiesRouter.onError((error, c) => {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error && error.message === "invalid_path" ? "invalid_path" : "copy_unavailable";
    return c.json({ error: code }, code === "forbidden" ? 403 : code === "not_found" ? 404 : ["invalid_input", "invalid_path"].includes(code) ? 422 : code === "copy_unavailable" ? 503 : 409);
});
projectCopiesRouter.get("/:projectId/copy-targets", async c => c.json(await listCopyTargets(c.get("user")!.id, c.req.param("projectId"))));
projectCopiesRouter.post("/:projectId/copies", bodyLimit({ maxSize: 2048 }), async c => {
  const body = await c.req.json().catch(() => null);
  if (!body || !["operationId", "targetServerKeyId", "folderName", "sourceRevision"].every(k => typeof body[k] === "string")) return c.json({ error: "invalid_input" }, 422);
  const op = await beginCopy(c.get("user")!.id, c.req.param("projectId"), body as CopyInput);
  return c.json(copyDto(op), op.status === "pending" ? 202 : op.status === "failed" ? 409 : 200);
});
projectCopiesRouter.get("/:projectId/copies/:operationId", async c => c.json(copyDto(await readCopy(c.get("user")!.id, c.req.param("projectId"), c.req.param("operationId")))));
projectCopiesRouter.post("/:projectId/copies/:operationId/resume", async c => {
  const op = await resumeCopy(c.get("user")!.id, c.req.param("projectId"), c.req.param("operationId"));
  return c.json(copyDto(op), op.status === "pending" ? 202 : op.status === "failed" ? 409 : 200);
});
