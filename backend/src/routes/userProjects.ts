// backend/src/routes/userProjects.ts
import { Hono } from "hono";
import type { Context } from "hono";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { projects as projectsTable } from "../db/schema";
import { broadcastDraftUpdate, clearPendingDivergence, getMcVersion, getPendingDivergence, pushBundleAvailable, pushProjectDeleted } from "../ws/hub";
import { advanceBranchHead, getBranch } from "../lib/branchStorage";
import { createCommit } from "../lib/commitStorage";
import { customItemsCacheDir, readCustomItems } from "../lib/customItems";
import { diffDivergence, mergeDivergence } from "../lib/divergence";
import { computeBundleHash } from "../lib/hashUtils";
import { getProject, resolveProjectRef, softDeleteProject, upsertProjectContent } from "../lib/projectStorage";
import { getNetworkOfProject, requireMember } from "../lib/membershipGuard";
import type { AuthUser } from "../middleware/userAuth";

type Vars = { user: AuthUser | null };

export const userProjectsRouter = new Hono<{ Variables: Vars }>();

function getUserId(c: Context<{ Variables: Vars }>): string | null {
  return c.get("user")?.id ?? null;
}

/** Resolve the serverKeyId for the project (1:1 ownership via projects.serverKeyId). */
async function getServerKeyIdForProject(projectId: string): Promise<string | null> {
  const rows = await db
    .select({ serverKeyId: projectsTable.serverKeyId })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  return rows[0]?.serverKeyId ?? null;
}

/** Load vanilla items for a given MC version, with fallback scan. */
async function loadVanillaItems(
  version: string | undefined,
): Promise<{ version: string; items: unknown[] } | null> {
  const itemsDir = join(import.meta.dir, "../../data/items");
  const tried: string[] = [];

  if (version) {
    const [major, minor] = version.split(".");
    const candidates = [version, `${major}.${minor}`];
    for (const candidate of candidates) {
      tried.push(candidate);
      try {
        const f = Bun.file(join(itemsDir, `${candidate}.json`));
        const items = (await f.json()) as unknown[];
        return { version: candidate, items };
      } catch {
        /* try next */
      }
    }
    try {
      const entries = await import("node:fs/promises").then((m) => m.readdir(itemsDir));
      const prefix = `${major}.${minor}.`;
      const match = entries
        .filter((e) => e.startsWith(prefix) && e.endsWith(".json"))
        .sort()
        .at(-1);
      if (match) {
        const f = Bun.file(join(itemsDir, match));
        const items = (await f.json()) as unknown[];
        return { version: match.replace(/\.json$/, ""), items };
      }
    } catch {
      /* ignore */
    }
  }

  // No version known (server offline / never connected) — fall back to the
  // newest available file so the editor library still works in user-auth mode.
  try {
    const entries = await import("node:fs/promises").then((m) => m.readdir(itemsDir));
    const newest = entries.filter((e) => e.endsWith(".json")).sort().at(-1);
    if (newest) {
      const f = Bun.file(join(itemsDir, newest));
      const items = (await f.json()) as unknown[];
      return { version: newest.replace(/\.json$/, ""), items };
    }
  } catch {
    /* ignore */
  }

  return null;
}

// GET /api/user/projects/:projectId — read project (member only)
userProjectsRouter.get("/:projectId", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  // L'URL de l'éditeur porte le serveur : il sert de portée pour résoudre un
  // slug de project (unique par serveur seulement).
  const projectId = await resolveProjectRef(c.req.param("projectId"), c.req.query("server"));
  if (projectId === null) return c.json({ error: "not_found" }, 404);

  const networkId = await getNetworkOfProject(projectId);
  if (networkId === null) return c.json({ error: "not_found" }, 404);

  try {
    await requireMember(userId, networkId);
  } catch {
    return c.json({ error: "forbidden" }, 403);
  }

  const project = await getProject(projectId);
  if (project === null) return c.json({ error: "not_found" }, 404);

  const webFiles = JSON.parse(project.filesJson) as Record<string, string>;
  const pending = getPendingDivergence(projectId);
  return c.json({
    project,
    networkId,
    serverKeyId: project.serverKeyId,
    // Files-first: the file tree IS the Project — the editor parses it
    // client-side (projectFromFiles). No editor JSON is stored anymore.
    files: webFiles,
    // Files-first P3c: pending disk↔web divergence, per-file detail for the
    // resolution banner. Absent when the trees agree.
    ...(pending
      ? {
          divergence: {
            disk_hash: pending.diskHash,
            at: pending.at,
            files: diffDivergence(webFiles, pending.files, projectId),
          },
        }
      : {}),
  });
});

// POST /api/user/projects/:projectId/resolve-divergence — apply per-file
// choices ("disk" | "web", default web) to a pending divergence: the merged
// tree becomes the new WIP + a commit on main, the plugin re-syncs via
// bundle_available, and the pending report is cleared.
userProjectsRouter.post("/:projectId/resolve-divergence", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const projectId = c.req.param("projectId");
  const networkId = await getNetworkOfProject(projectId);
  if (networkId === null) return c.json({ error: "not_found" }, 404);
  try {
    await requireMember(userId, networkId);
  } catch {
    return c.json({ error: "forbidden" }, 403);
  }

  const pending = getPendingDivergence(projectId);
  if (!pending) return c.json({ error: "no_divergence" }, 404);
  const project = await getProject(projectId);
  if (!project) return c.json({ error: "not_found" }, 404);

  let body: { choices?: Record<string, "disk" | "web"> };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }
  const choices = body.choices ?? {};

  const webFiles = JSON.parse(project.filesJson) as Record<string, string>;
  const merged = mergeDivergence(webFiles, pending.files, projectId, choices);
  const hash = await computeBundleHash(merged, projectId);

  // Unconditioned write (like local_push): the version bump invalidates other
  // open tabs through the existing optimistic-lock banner.
  const version = await upsertProjectContent(projectId, {
    hash,
    filesJson: JSON.stringify(merged),
  });

  const branch = await getBranch(projectId, "main");
  let contentHash = hash;
  if (branch) {
    const commit = await createCommit({
      projectId,
      parentId: branch.headCommitId,
      files: merged,
      authorUserId: userId,
      message: "Resolve disk/web divergence",
    });
    await advanceBranchHead(projectId, "main", commit.id);
    contentHash = commit.contentHash;
  }
  await pushBundleAvailable(projectId, "main", contentHash, { force: true });
  clearPendingDivergence(projectId, project.serverKeyId);

  return c.json({ ok: true, version, hash });
});

// GET /api/user/projects/:projectId/items — vanilla item bundle for the project's MC version
userProjectsRouter.get("/:projectId/items", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  // Même résolution id-ou-slug que `GET /:projectId` — la sidebar navigue en
  // slug, la bibliothèque doit suivre.
  const projectId = await resolveProjectRef(c.req.param("projectId"), c.req.query("server"));
  if (projectId === null) return c.json({ error: "not_found" }, 404);
  const networkId = await getNetworkOfProject(projectId);
  if (networkId === null) return c.json({ error: "not_found" }, 404);

  try {
    await requireMember(userId, networkId);
  } catch {
    return c.json({ error: "forbidden" }, 403);
  }

  const serverKeyId = await getServerKeyIdForProject(projectId);
  const version = serverKeyId ? await getMcVersion(serverKeyId) : undefined;
  const result = await loadVanillaItems(version);
  if (!result) return c.json({ error: "unknown_version" }, 404);

  return c.json(result);
});

// GET /api/user/projects/:projectId/custom-items — custom item bundle for the project's server_key
userProjectsRouter.get("/:projectId/custom-items", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const projectId = await resolveProjectRef(c.req.param("projectId"), c.req.query("server"));
  if (projectId === null) return c.json({ error: "not_found" }, 404);
  const networkId = await getNetworkOfProject(projectId);
  if (networkId === null) return c.json({ error: "not_found" }, 404);

  try {
    await requireMember(userId, networkId);
  } catch {
    return c.json({ error: "forbidden" }, 403);
  }

  const serverKeyId = await getServerKeyIdForProject(projectId);
  if (!serverKeyId) return c.json({ serverKeyId: "", items: [] });

  const cacheDir = customItemsCacheDir(serverKeyId);
  const items = await readCustomItems(cacheDir);
  return c.json({ serverKeyId, items });
});

// PUT /api/user/projects/:projectId — write project content + broadcast (member only)
userProjectsRouter.put("/:projectId", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const projectId = c.req.param("projectId");

  const networkId = await getNetworkOfProject(projectId);
  if (networkId === null) return c.json({ error: "not_found" }, 404);

  try {
    await requireMember(userId, networkId);
  } catch {
    return c.json({ error: "forbidden" }, 403);
  }

  const body = await c.req.json<{ hash: string; files: Record<string, string>; baseVersion?: number }>();
  if (typeof body.baseVersion !== "number") {
    return c.json({ error: "missing_base_version" }, 400);
  }

  const newVersion = await upsertProjectContent(
    projectId,
    {
      hash: body.hash,
      filesJson: JSON.stringify(body.files),
    },
    { expectedVersion: body.baseVersion },
  );
  if (newVersion === null) {
    const current = await getProject(projectId);
    return c.json({ error: "version_conflict", currentVersion: current?.version ?? 0 }, 409);
  }

  return c.json({ ok: true, version: newVersion });
});

// POST /api/user/projects/:projectId/draft — broadcast a WIP menu edit to other
// editor connections and the plugin (co-edit live preview). projectId comes
// from the URL (membership already scopes it), so the body only carries
// menu_id/menu_yaml.
userProjectsRouter.post("/:projectId/draft", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const projectId = c.req.param("projectId");
  const networkId = await getNetworkOfProject(projectId);
  if (networkId === null) return c.json({ error: "not_found" }, 404);

  try {
    await requireMember(userId, networkId);
  } catch {
    return c.json({ error: "forbidden" }, 403);
  }

  const serverKeyId = await getServerKeyIdForProject(projectId);
  if (!serverKeyId) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json<{ menu_id: string; menu_yaml: string }>();
  // Editor WS session ids are minted per-connection at ws upgrade ("user_" +
  // randomUUID(), cf. app.ts `/ws/editor`), not derived from userId — this
  // HTTP request isn't tied to any one of the user's WS tabs, so there is no
  // real session id to exclude here. `userId` below therefore never matches a
  // live session and excludes nothing (every open tab for this server,
  // including the sender's own, receives the echo). No client currently
  // calls this route; when a producer lands it must ignore echoes of the
  // menu_yaml it just sent.
  broadcastDraftUpdate(serverKeyId, projectId, body.menu_id, body.menu_yaml, userId);
  return c.json({ ok: true });
});

// DELETE /api/user/projects/:projectId — soft-delete + notify plugin/editor
// connections.
userProjectsRouter.delete("/:projectId", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const projectId = c.req.param("projectId");
  const networkId = await getNetworkOfProject(projectId);
  if (networkId === null) return c.json({ error: "not_found" }, 404);

  try {
    await requireMember(userId, networkId);
  } catch {
    return c.json({ error: "forbidden" }, 403);
  }

  const project = await getProject(projectId);
  if (!project || project.deletedAt) return c.json({ error: "not_found" }, 404);

  await softDeleteProject(projectId);
  await pushProjectDeleted(projectId);
  return c.json({ deleted: true });
});
