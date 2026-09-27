import { listVersions, readVersion } from "../lib/projectVersions";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AuthUser } from "../middleware/userAuth";
import type { ProjectStorage, ProjectWriteBatch } from "../lib/storage/ProjectStorage";
import { resolveProjectStorage } from "../lib/storage/resolveProjectStorage";
import {requestProjectPrincipal,demoErrorResponse} from '../middleware/demoAuth';
import { getServerEditorAccess } from "../modules/billing/editorAccess";
import { getProject } from "../lib/projectStorage";

type Vars = { user: AuthUser | null };

function readError(c: Context, error: string, message?: string) {
  const status = error === "unknown_project" || error === "not_found" ? 404 : error === "invalid_path" ? 422 : error === "plugin_update_required" || error === "write_error" || error === "storage_error" ? 503 : 502;
  return c.json({ error, message: message ?? null }, status);
}

export async function handleProjectRead(c: Context, storage: ProjectStorage) {
  const outcome = await storage.read(c.req.query("if_hash") ?? null);
  if (outcome.kind === "offline") return c.json({ error: "server_offline" }, 503);
  if (outcome.kind === "timeout") return c.json({ error: "fetch_timeout" }, 504);
  const r = outcome.result;
  if (!r.ok) return readError(c, r.error ?? "read_error", r.message);
  const offline = { ...(r.offline_since ? { offlineSince: r.offline_since } : {}), ...(r.unpublished ? { unpublished: true } : {}) };
  if (r.unchanged) return c.json({ unchanged: true, hash: r.hash ?? null, ...offline });
  return c.json({ files: r.files ?? [], binaries: r.binaries ?? [], failed: r.failed ?? [], hash: r.hash ?? null, ...offline });
}

export async function handleProjectHistory(c: Context, storage: ProjectStorage) {
  const path = c.req.query("path");
  if (!path) return c.json({ error: "invalid_input" }, 422);
  const outcome = await storage.history(path);
  if (outcome.kind === "offline") return c.json({ error: "server_offline" }, 503);
  if (outcome.kind === "timeout") return c.json({ error: "fetch_timeout" }, 504);
  const r = outcome.result;
  if (!r.ok) return readError(c, r.error ?? "read_error", r.message);
  return c.json({ versions: r.versions ?? [] });
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseBatch(body: unknown): ProjectWriteBatch | null {
  if (!record(body) || !Array.isArray(body.files)) return null;
  const deletes = body.deletes === undefined ? [] : body.deletes;
  const renames = body.renames === undefined ? [] : body.renames;
  if (!Array.isArray(deletes) || !Array.isArray(renames)) return null;
  if (body.files.length + deletes.length + renames.length > 5000) return null;
  const validHash = (hash: unknown) => hash === null || typeof hash === "string";
  if (!body.files.every((f) => record(f) && typeof f.path === "string" && typeof f.content === "string" && validHash(f.base_hash))) return null;
  if (!deletes.every((d) => record(d) && typeof d.path === "string" && validHash(d.base_hash))) return null;
  if (!renames.every((r) => record(r) && typeof r.from === "string" && typeof r.to === "string" && typeof r.base_hash === "string")) return null;
  if (body.operationId !== undefined && (typeof body.operationId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.operationId))) return null;
  const binaries = body.binaries;
  if (binaries !== undefined && (!Array.isArray(binaries) || !body.operationId || binaries.length + body.files.length + deletes.length + renames.length > 5000 || !binaries.every((b) => record(b) && typeof b.path === "string" && validHash(b.base_hash) && (b.content_base64 === null || (typeof b.content_base64 === "string" && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b.content_base64)))))) return null;
  return { files: body.files, deletes, renames, create: body.create === true, ...(body.operationId ? { operationId: body.operationId as string } : {}), ...(Array.isArray(binaries) ? { binaries: binaries.map((b) => ({ path: b.path, baseHash: b.base_hash, content: b.content_base64 === null ? null : new Uint8Array(Buffer.from(b.content_base64, "base64")) })) } : {}) };
}

export async function handleProjectBinary(c: Context, storage: ProjectStorage) {
  const path = c.req.query("path");
  if (!path) return c.json({ error: "invalid_input" }, 422);
  const outcome = await storage.readBinary(path);
  if (outcome.kind !== "result") return c.json({ error: outcome.kind === "offline" ? "server_offline" : "fetch_timeout" }, outcome.kind === "offline" ? 503 : 504);
  if (!outcome.result.ok || outcome.result.content === undefined) return readError(c, outcome.result.error ?? "read_error");
  const mime: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", ttf: "font/ttf", otf: "font/otf", ogg: "audio/ogg", zip: "application/zip" };
  return new Response(outcome.result.content as BodyInit, { headers: { "Content-Type": mime[path.split(".").at(-1)?.toLowerCase() ?? ""] ?? "application/octet-stream", "Cache-Control": "private, no-cache", "ETag": `"${outcome.result.hash ?? ""}"` } });
}

export async function handleProjectWrite(c: Context, storage: ProjectStorage) {
  const batch = parseBatch(await c.req.json().catch(() => null));
  if (!batch) return c.json({ error: "invalid_input" }, 422);
  const outcome = await storage.write(batch);
  if (outcome.kind === "offline") return c.json({ error: "server_offline" }, 503);
  if (outcome.kind === "timeout") return c.json({ error: "fetch_timeout" }, 504);
  const r = outcome.result;
  if (!r.ok) {
    const error = r.error ?? "write_error";
    if (["operation_mismatch", "operation_conflict", "operation_expired"].includes(r.message ?? "")) return c.json({ error: r.message }, 409);
    if (error === "conflict") return c.json({ error, conflicts: r.conflicts ?? [], ...(r.disk_files === undefined ? {} : { disk_files: r.disk_files }) }, 409);
    if (error === "quota_denied") return c.json({ error, reason: r.message, message: r.message }, 403);
    if (error === "inventory_unavailable") return c.json({ error }, 503);
    return readError(c, error, r.message);
  }
  return c.json({ ok: true });
}

/** Versions du Project (ADR `snapshot-mirror-and-backend-history`, décision 6) — lecture seule. */
export async function handleProjectVersions(c: Context, _storage: ProjectStorage) {
  const project = await getProject(c.req.param("projectId")!);
  if (!project) return c.json({ error: "not_found" }, 404);
  return c.json({ versions: await listVersions(project.id) });
}

export async function handleProjectVersion(c: Context, _storage: ProjectStorage) {
  const project = await getProject(c.req.param("projectId")!);
  const version = project ? await readVersion(project.id, c.req.param("versionId")!) : null;
  if (!version) return c.json({ error: "not_found" }, 404);
  return c.json(version);
}

export function createProjectContentRouter(resolve: typeof resolveProjectStorage = resolveProjectStorage) {
  const router = new Hono<{ Variables: Vars }>();
  router.onError((error,c)=>demoErrorResponse(c,error));
  router.use("/:projectId/files", bodyLimit({ maxSize: 8 * 1024 * 1024 }));
  router.get("/:projectId/capabilities", async (c) => {
    try { return c.json((await resolve(await requestProjectPrincipal(c,c.req.param('projectId')), c.req.param("projectId"))).capabilities); }
    catch (error) { const code = record(error) ? error.code : "storage_unavailable"; return c.json({ error: code }, code === 'unauthorized'?401:code==='demo_expired'?410:code === "not_found" ? 404 : code === "forbidden" ? 403 : 503); }
  });
  router.get("/:projectId/editor-access", async (c) => {
    const projectId = c.req.param("projectId");
    try {
      await resolve(await requestProjectPrincipal(c, projectId), projectId);
      const project = await getProject(projectId);
      if (!project) return c.json({ error: "not_found" }, 404);
      if (!project.serverKeyId) return c.json({ error: "not_server_project" }, 422);
      const access = await getServerEditorAccess(project.serverKeyId);
      return c.json({ ...access, projectOrigin: project.identityKind === "addon" ? "module" : "personal" }, access.inventoryAvailable ? 200 : 503);
    } catch (error) {
      const code = record(error) && typeof error.code === "string" ? error.code : "storage_unavailable";
      return c.json({ error: code }, code === "not_found" ? 404 : code === "forbidden" ? 403 : 503);
    }
  });
  router.post("/:projectId/rename", bodyLimit({ maxSize: 1024 }), async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const body = await c.req.json().catch(() => null);
    if (!record(body) || typeof body.operationId !== "string" || typeof body.targetId !== "string") return c.json({ error: "invalid_input" }, 422);
    try {
      const storage = await resolve(user.id, c.req.param("projectId"), "publish_content");
      const result = await storage.rename(body.operationId, body.targetId);
      return c.json(result, result.ok ? 200 : result.error === "rename_pending" ? 202 : 409);
    } catch (error) {
      const code = record(error) && typeof error.code === "string" ? error.code : "storage_unavailable";
      const terminal = ["destination_exists", "destination_reserved", "operation_mismatch", "operation_conflict", "rename_in_progress", "rename_unsupported", "rename_failed"];
      return c.json({ error: code }, code === "not_found" ? 404 : code === "forbidden" || code === "addon_immutable" ? 403 : code === "invalid_input" || code === "invalid_path" ? 422 : terminal.includes(code) ? 409 : 503);
    }
  });
  const routes = [
    { method: "get", path: "/:projectId/files", handler: handleProjectRead, capability: undefined },
    { method: "get", path: "/:projectId/history", handler: handleProjectHistory, capability: undefined },
    { method: "get", path: "/:projectId/versions", handler: handleProjectVersions, capability: undefined },
    { method: "get", path: "/:projectId/versions/:versionId", handler: handleProjectVersion, capability: undefined },
    { method: "get", path: "/:projectId/binary", handler: handleProjectBinary, capability: undefined },
    { method: "put", path: "/:projectId/files", handler: handleProjectWrite, capability: "publish_content" },
  ] as const;
  for (const route of routes) {
    router[route.method](route.path, async (c) => {
      let storage: ProjectStorage;
      try {
        storage = await resolve(await requestProjectPrincipal(c,c.req.param('projectId')), c.req.param("projectId"), route.capability);
      } catch (error) {
        if(record(error)&&typeof error.status==='number')return c.json({error:error.code},error.status as 401);
        const code = record(error) ? error.code : undefined;
        if (code === "not_found") return c.json({ error: code }, 404);
        if (code === "forbidden") return c.json({ error: code }, 403);
        if (code === "storage_unavailable") return c.json({ error: code }, 503);
        throw error;
      }
      return route.handler(c, storage);
    });
  }
  return router;
}

export const projectContentRouter = createProjectContentRouter();
