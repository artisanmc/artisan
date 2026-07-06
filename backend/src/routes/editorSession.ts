import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { and, eq, isNull } from "drizzle-orm";
import { join } from "path";
import { db } from "../db/index";
import { editorSessions, projects, serverKeys, serverModules } from "../db/schema";
import { generateEditorToken, generateTrustCode, validateAccessToken } from "../lib/auth";
import { checkRateLimit } from "../lib/rateLimit";
import { computeBundleHash } from "../lib/hashUtils";
import { broadcastDraftUpdate, pushBundleAvailable, pushProjectDeleted, getMcVersion, trackEditorIp } from "../ws/hub";
import { customItemsCacheDir, readCustomItems } from "../lib/customItems";
import { readEditorEdgesFromFiles, readEditorLayoutFromFiles } from "../lib/projectImport";
import { getProject, upsertProjectContent, createProject, softDeleteProject } from "../lib/projectStorage";
import { getBranch, advanceBranchHead } from "../lib/branchStorage";
import { createCommit } from "../lib/commitStorage";

function buildEditorJsonWithLayout(rawProject: unknown, files: Record<string, string>, projectId: string): string {
  // Spread to a fresh object — mutating rawProject in place is a footgun for any
  // caller that later reads body.project.
  const project = { ...(rawProject as Record<string, unknown>) };
  project.canvasLayout = readEditorLayoutFromFiles(files, projectId); // files win
  project.canvasEdges = readEditorEdgesFromFiles(files, projectId);
  return JSON.stringify(project);
}

const router = new Hono();

function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header("x-forwarded-for") ?? c.req.header("cf-connecting-ip") ?? "unknown";
}

router.post("/refresh", async (c) => {
  const token = getCookie(c, "artisan_refresh");
  if (!token) return c.json({ error: "Unauthorized" }, 401);

  const rows = await db.select().from(editorSessions).where(eq(editorSessions.refreshToken, token));
  if (rows.length === 0) return c.json({ error: "Unauthorized" }, 401);
  const row = rows[0];
  if (row.revokedAt || row.expiresAt < new Date()) return c.json({ error: "Unauthorized" }, 401);

  const newAccessToken = generateEditorToken();
  const newRefreshToken = generateEditorToken();
  const now = new Date();
  const accessExpiresAt = new Date(now.getTime() + 5 * 60 * 1000);

  // Atomic rotation: only succeeds if refreshToken still matches (prevents replay)
  const updated = await db.update(editorSessions)
    .set({ accessToken: newAccessToken, accessExpiresAt, refreshToken: newRefreshToken })
    .where(and(eq(editorSessions.token, row.token), eq(editorSessions.refreshToken, token)))
    .returning({ token: editorSessions.token });

  if (updated.length === 0) return c.json({ error: "Unauthorized" }, 401);

  setCookie(c, "artisan_refresh", newRefreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict",
    maxAge: 7 * 24 * 60 * 60,
    path: "/api/v1/editor-session/refresh",
  });

  return c.json({ access_token: newAccessToken, expires_in: 300 });
});

router.post("/:urlToken/exchange", async (c) => {
  const urlToken = c.req.param("urlToken");
  // Validate the session exists and is valid first (for correct error messages)
  const rows = await db.select().from(editorSessions).where(eq(editorSessions.token, urlToken));
  if (rows.length === 0) return c.json({ error: "Unauthorized" }, 401);
  const row = rows[0];
  if (row.revokedAt || row.expiresAt < new Date()) return c.json({ error: "Unauthorized" }, 401);

  const accessToken = generateEditorToken();
  const refreshToken = generateEditorToken();
  const now = new Date();
  const accessExpiresAt = new Date(now.getTime() + 5 * 60 * 1000);
  const trustCode = row.trustCode ?? generateTrustCode();

  // Atomic claim: only succeeds if exchangedAt is still NULL
  const updated = await db.update(editorSessions)
    .set({ exchangedAt: now, accessToken, accessExpiresAt, refreshToken, trustCode })
    .where(and(eq(editorSessions.token, urlToken), isNull(editorSessions.exchangedAt)))
    .returning({ token: editorSessions.token });

  if (updated.length === 0) return c.json({ error: "already_used" }, 401);

  setCookie(c, "artisan_refresh", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict",
    maxAge: 7 * 24 * 60 * 60,
    path: "/api/v1/editor-session/refresh",
  });

  return c.json({ access_token: accessToken, expires_in: 300, trust_code: trustCode });
});

router.get("/:token", async (c) => {
  if (!checkRateLimit(`editor-validate:${clientIp(c)}`, 20)) return c.json({ error: "Too many requests" }, 429);
  const token = c.req.param("token");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  trackEditorIp(session.sessionId, clientIp(c));
  const [sk] = await db.select({ networkId: serverKeys.networkId })
    .from(serverKeys).where(eq(serverKeys.id, session.serverKeyId));
  return c.json({
    server_key_id: session.serverKeyId,
    network_id: sk?.networkId ?? null,
    trusted: session.trusted,
    trust_code: session.trustCode,
  });
});

router.delete("/:token", async (c) => {
  const token = c.req.param("token");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  await db.update(editorSessions).set({ revokedAt: new Date() })
    .where(eq(editorSessions.token, session.sessionId));
  return c.json({ ok: true });
});

// Active modules for this session's server — drives editor module visibility
// (presence activation). Source: server_modules, populated at each plugin hello.
router.get("/:token/modules", async (c) => {
  const session = await validateAccessToken(c.req.param("token"));
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const rows = await db
    .select()
    .from(serverModules)
    .where(eq(serverModules.serverKeyId, session.serverKeyId));
  return c.json({ modules: rows.map((r) => ({ id: r.moduleId, version: r.version })) });
});

router.get("/:token/projects", async (c) => {
  const session = await validateAccessToken(c.req.param("token"));
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const projectList = await db.select().from(projects).where(
    and(eq(projects.serverKeyId, session.serverKeyId), isNull(projects.deletedAt)),
  );
  return c.json({
    projects: projectList.map((p) => ({
      project_id: p.id,
      name: p.name,
      hash: p.hash,
      version: p.version,
      files: JSON.parse(p.filesJson),
      editor: p.editorJson ? JSON.parse(p.editorJson) : null,
    })),
  });
});

router.put("/:token/projects/:projectId", async (c) => {
  const session = await validateAccessToken(c.req.param("token"));
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const projectId = c.req.param("projectId");

  const body = await c.req.json<{ project: unknown; files: Record<string, string>; base_version?: number }>();
  if (body.project == null || typeof body.project !== "object") {
    return c.json({ error: "missing_or_invalid_project" }, 400);
  }

  // server_key → network → project must be in same network
  const skRows = await db.select().from(serverKeys).where(eq(serverKeys.id, session.serverKeyId));
  if (skRows.length === 0) return c.json({ error: "Server key missing" }, 500);
  const sk = skRows[0];

  let project = await getProject(projectId);
  const existed = project !== null;
  if (!project) {
    project = await createProject({ networkId: sk.networkId, serverKeyId: session.serverKeyId, name: projectId, id: projectId });
  } else if (project.networkId !== sk.networkId) {
    return c.json({ error: "Cross-network project" }, 403);
  }
  // Optimistic concurrency: an existing project can only be overwritten by a
  // client that presents the version it loaded. Auto-create has no precondition.
  if (existed && typeof body.base_version !== "number") {
    return c.json({ error: "missing_base_version" }, 400);
  }

  const hash = await computeBundleHash(body.files, projectId);
  const filesJson = JSON.stringify(body.files);
  const editorJson = buildEditorJsonWithLayout(body.project, body.files, projectId);

  const newVersion = await upsertProjectContent(
    projectId,
    { hash, filesJson, editorJson },
    existed ? { expectedVersion: body.base_version } : undefined,
  );
  if (newVersion === null) {
    const current = await getProject(projectId);
    return c.json({ error: "version_conflict", current_version: current?.version ?? 0 }, 409);
  }

  return c.json({ hash, version: newVersion }, 201);
});

router.post("/:token/projects/:projectId/deploy", async (c) => {
  const session = await validateAccessToken(c.req.param("token"));
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const projectId = c.req.param("projectId");

  if (!session.trusted) return c.json({ error: "session_not_trusted" }, 403);
  if (session.trustedIp !== clientIp(c)) return c.json({ error: "session_not_trusted" }, 403);

  const body = await c.req.json<{ project: unknown; files: Record<string, string> }>();
  if (body.project == null || typeof body.project !== "object") {
    return c.json({ error: "missing_or_invalid_project" }, 400);
  }

  // server_key → network → project must be in same network
  const skRows = await db.select().from(serverKeys).where(eq(serverKeys.id, session.serverKeyId));
  if (skRows.length === 0) return c.json({ error: "Server key missing" }, 500);
  const sk = skRows[0];

  let project = await getProject(projectId);
  if (!project) {
    project = await createProject({ networkId: sk.networkId, serverKeyId: session.serverKeyId, name: projectId, id: projectId });
  } else if (project.networkId !== sk.networkId) {
    return c.json({ error: "Cross-network project" }, 403);
  }

  const hash = await computeBundleHash(body.files, projectId);
  const filesJson = JSON.stringify(body.files);
  const editorJson = buildEditorJsonWithLayout(body.project, body.files, projectId);

  await upsertProjectContent(projectId, {
    hash,
    filesJson,
    editorJson,
    deployedEditorJson: editorJson,
  });

  // Phase 2: deploy = commit on main + advance branch head, so the plugin
  // (which reads via branch → commit) actually receives the new files.
  const branch = await getBranch(projectId, "main");
  if (branch) {
    const editor = JSON.parse(editorJson);
    const commit = await createCommit({
      projectId,
      parentId: branch.headCommitId,
      files: body.files,
      editor,
      authorUserId: null,
      message: "deploy",
    });
    await advanceBranchHead(projectId, "main", commit.id);
    await pushBundleAvailable(projectId, "main", commit.contentHash);
  } else {
    await pushBundleAvailable(projectId, "main", hash);
  }
  return c.json({ hash }, 201);
});

router.get("/:token/projects/:projectId/deployed", async (c) => {
  const session = await validateAccessToken(c.req.param("token"));
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const project = await getProject(c.req.param("projectId"));
  if (!project || !project.deployedEditorJson) return c.json({ deployed: null });
  return c.json({ deployed: JSON.parse(project.deployedEditorJson) });
});

router.delete("/:token/projects/:projectId", async (c) => {
  const session = await validateAccessToken(c.req.param("token"));
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const projectId = c.req.param("projectId");
  const project = await getProject(projectId);
  if (!project || project.deletedAt) return c.json({ error: "Not found" }, 404);

  await softDeleteProject(projectId);
  await pushProjectDeleted(projectId);
  return c.json({ deleted: true });
});

router.post("/:token/draft", async (c) => {
  const token = c.req.param("token");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json<{ project_id: string; menu_id: string; menu_yaml: string }>();
  broadcastDraftUpdate(session.serverKeyId, body.project_id, body.menu_id, body.menu_yaml, session.sessionId);
  return c.json({ ok: true });
});

router.get("/:token/items", async (c) => {
  const token = c.req.param("token");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const version = await getMcVersion(session.serverKeyId);
  if (!version) return c.json({ error: "server_offline" }, 503);

  const itemsDir = join(import.meta.dir, "../../data/items");

  // Try exact version, then major.minor, then any available file sharing the same major.minor prefix.
  const [major, minor] = version.split(".");
  const candidates = [version, `${major}.${minor}`];
  let resolvedVersion: string | null = null;
  let items: unknown[] | null = null;

  for (const candidate of candidates) {
    try {
      const f = Bun.file(join(itemsDir, `${candidate}.json`));
      items = await f.json() as unknown[];
      resolvedVersion = candidate;
      break;
    } catch { /* try next */ }
  }

  if (!items || !resolvedVersion) {
    // Scan directory for any file matching major.minor.*
    try {
      const entries = await import("fs/promises").then((m) => m.readdir(itemsDir));
      const prefix = `${major}.${minor}.`;
      const match = entries.filter((e) => e.startsWith(prefix) && e.endsWith(".json")).sort().at(-1);
      if (match) {
        const f = Bun.file(join(itemsDir, match));
        items = await f.json() as unknown[];
        resolvedVersion = match.replace(/\.json$/, "");
      }
    } catch { /* no match */ }
  }

  if (!items || !resolvedVersion) return c.json({ error: "unknown_version" }, 404);

  return c.json({ version: resolvedVersion, items });
});

router.get("/:token/custom-items", async (c) => {
  const token = c.req.param("token");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const cacheDir = customItemsCacheDir(session.serverKeyId);
  const items = await readCustomItems(cacheDir);
  return c.json({ serverKeyId: session.serverKeyId, items });
});

export { router as editorSessionRouter };
