import type { Context } from "hono";
import { getProject } from "./projectStorage";
import { resolveProjectStorage } from "./storage/resolveProjectStorage";
import { DraftAssetStorage } from "./storage/DraftAssetStorage";
import { projectRuntime } from "./projectRuntime";
import { ProjectAssets } from "./projectAssets";
import type { DraftSnapshot } from "./storage/DraftStore";
import { validDraftBody } from "./projectDrafts";
import {requestProjectPrincipal} from '../middleware/demoAuth';
export async function resolveProjectAssets(c: Context, projectId: string, mutation = false) {
  const principal=await requestProjectPrincipal(c,projectId);
  const draftId = c.req.query("draftId");
  const storage = await resolveProjectStorage(principal, projectId, mutation ? draftId ? "edit_content" : "publish_content" : undefined);
  const project = await getProject(projectId);
  if (!project) throw Object.assign(new Error("not_found"), { status: 404 });
  const operationId = c.req.header("Idempotency-Key") ?? crypto.randomUUID();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(operationId)) throw Object.assign(new Error("invalid_operation_id"), { status: 422 });
  if (!draftId) return { projectId, assets: new ProjectAssets(projectId, storage, operationId, () => projectRuntime(project).afterAssetWrite()) };
  const current = await storage.drafts.read(draftId);
  if (current.kind !== "result") throw Object.assign(new Error("server_offline"), { status: 503 });
  if (!current.result.ok || !current.result.draft) throw Object.assign(new Error(current.result.error ?? "not_found"), { status: 404 });
  let snapshot: DraftSnapshot | undefined, revision: number | undefined, name: string | undefined;
  if (mutation) {
    if (!c.req.header("Idempotency-Key")) throw Object.assign(new Error("operation_id_required"), { status: 422 });
    const body = c.req.header("Content-Type")?.includes("multipart/form-data") ? await c.req.parseBody() : await c.req.json().catch(() => ({}));
    try { snapshot = typeof body.draftSnapshot === "string" ? JSON.parse(body.draftSnapshot) : body.draftSnapshot; }
    catch { throw Object.assign(new Error("invalid_draft"), { status: 422 }); }
    revision = Number(c.req.query("draftRevision") ?? body.draftRevision); name = body.draftName;
    if (!validDraftBody({ name, snapshot }) || !Number.isInteger(revision) || revision! < 1) throw Object.assign(new Error("invalid_draft"), { status: 422 });
  }
  const overlay = new DraftAssetStorage(storage, current.result.draft, snapshot, revision, name);
  return { projectId, assets: new ProjectAssets(projectId, overlay, operationId), overlay };
}
export function assetAccessError(c: Context, error: unknown) {
  const err = error as { status?: number; code?: string; message?: string };
  const code = err.code ?? err.message ?? "";
  const statuses: Record<string, number> = { demo_expired:410,claim_pending:409,demo_quota_exceeded:413,demo_capacity_exceeded:429,demo_rate_limited:429, unauthorized: 401, not_found: 404, forbidden: 403, invalid_operation_id: 422, operation_id_required: 422, invalid_draft: 422, draft_conflict: 409, server_offline: 503, migration_in_progress: 503, storage_unavailable: 503 };
  if (!statuses[code]) console.error("[project-assets] storage operation failed", error);
  return c.json({ error: statuses[code] ? code : "storage_unavailable" }, (statuses[code] ?? 503) as 401);
}
