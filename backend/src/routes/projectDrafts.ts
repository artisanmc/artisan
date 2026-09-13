import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { validDraftBody } from "../lib/projectDrafts";
import { resolveProjectStorage, ProjectStorageError } from "../lib/storage/resolveProjectStorage";
import type { ProjectStorage } from "../lib/storage/ProjectStorage";
import type { DraftOutcome, StoredDraft } from "../lib/storage/DraftStore";
import type { AuthUser } from "../middleware/userAuth";
import {requestProjectPrincipal,demoErrorResponse} from '../middleware/demoAuth';

type Env = { Variables: { user: AuthUser | null; projectStorage: ProjectStorage } };
export const projectDraftsRouter = new Hono<Env>();
projectDraftsRouter.onError((error,c)=>demoErrorResponse(c,error));
const base = "/:projectId/drafts";
const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
for (const path of [base, `${base}/*`]) {
  projectDraftsRouter.use(path, bodyLimit({ maxSize: 8 * 1024 * 1024 }));
  projectDraftsRouter.use(path, async (c, next) => {
    try { const principal=await requestProjectPrincipal(c,c.req.param('projectId')!);c.set("projectStorage", await resolveProjectStorage(principal, c.req.param("projectId")!, c.req.path.endsWith("/publish") ? "publish_content" : "edit_content")); }
    catch (error) {
      if(error&&typeof error==='object'&&'status'in error)return c.json({error:'code'in error?error.code:'forbidden'},error.status as 401);
      if (error instanceof ProjectStorageError) return c.json({ error: error.code }, error.code === "forbidden" ? 403 : error.code === "not_found" ? 404 : 503);
      throw error;
    }
    await next();
  });
}

function response(c: Context<Env>, outcome: DraftOutcome, created = false) {
  if (outcome.kind === "offline") return c.json({ error: "server_offline" }, 503);
  if (outcome.kind === "timeout") return c.json({ error: "fetch_timeout" }, 504);
  const result = outcome.result;
  const attach = (draft: StoredDraft) => ({ ...draft, projectId: c.req.param("projectId") });
  const body = { ...result, ...(result.draft ? { draft: attach(result.draft) } : {}), ...(result.drafts ? { drafts: result.drafts.map(attach) } : {}) };
  if (result.ok) return c.json(body, created ? 201 : 200);
  const error = result.error ?? "draft_error";
  // A storage failure may follow a durable commit intent: preserve the client's retry key.
  return c.json(body, error === "not_found" ? 404 : ["draft_migration_pending", "storage_error", "rename_in_progress", "rename_pending"].includes(error) ? 503 : ["draft_conflict", "draft_exists", "draft_closed", "conflict", "operation_mismatch", "operation_conflict", "operation_expired"].includes(error) ? 409 : 422);
}
function operation(body: Record<string, unknown>) {
  return body.operationId === undefined ? crypto.randomUUID() : identifier(body.operationId) ? body.operationId : null;
}
projectDraftsRouter.get(base, async (c) => response(c, await c.get("projectStorage").drafts.list()));
projectDraftsRouter.get(`${base}/:draftId`, async (c) => response(c, await c.get("projectStorage").drafts.read(c.req.param("draftId"))));
projectDraftsRouter.get(`${base}/:draftId/blobs/:hash`, async (c) => {
  const hash = c.req.param("hash");
  if (!/^[a-f0-9]{64}$/.test(hash)) return c.json({ error: "invalid_input" }, 422);
  const outcome = await c.get("projectStorage").drafts.readBlob(c.req.param("draftId"), hash);
  if (outcome.kind !== "result" || !outcome.result.ok || outcome.result.content_base64 === undefined) return response(c, outcome);
  c.header("Cache-Control", "private, no-store");
  c.header("Content-Type", "application/octet-stream");
  return c.body(Buffer.from(outcome.result.content_base64, "base64"));
});
projectDraftsRouter.post(base, async (c) => {
  const body = await c.req.json().catch(() => null);
  const id = body?.id;
  if (!validDraftBody(body) || !identifier(id)) return c.json({ error: "invalid_input" }, 422);
  const operationId = operation(body);
  if (!operationId) return c.json({ error: "invalid_input" }, 422);
  return response(c, await c.get("projectStorage").drafts.create(id, operationId, { name: body.name, snapshot: body.snapshot }), true);
});
for (const method of ["put", "delete", "publish", "blobs"] as const) {
  const suffix = method === "publish" || method === "blobs" ? `/:draftId/${method}` : "/:draftId";
  projectDraftsRouter[method === "publish" || method === "blobs" ? "post" : method](`${base}${suffix}`, async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || !Number.isSafeInteger(body.revision) || body.revision < 1) return c.json({ error: "invalid_input" }, 422);
    const operationId = operation(body);
    if (!operationId) return c.json({ error: "invalid_input" }, 422);
    const store = c.get("projectStorage").drafts;
    const id = c.req.param("draftId")!;
    const revision: number = body.revision;
    if (method === "put") {
      if (!validDraftBody(body)) return c.json({ error: "invalid_input" }, 422);
      return response(c, await store.update(id, revision, operationId, { name: body.name, snapshot: body.snapshot }));
    }
    if (method === "blobs") {
      if (typeof body.hash !== "string" || !/^[a-f0-9]{64}$/.test(body.hash) || typeof body.contentBase64 !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.contentBase64)) return c.json({ error: "invalid_input" }, 422);
      return response(c, await store.writeBlob(id, body.revision, operationId, body.hash, body.contentBase64));
    }
    return response(c, method === "delete" ? await store.discard(id, body.revision, operationId) : await store.publish(id, body.revision, operationId));
  });
}
