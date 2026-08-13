// backend/src/routes/userProjects.ts
import { Hono } from "hono";
import type { Context } from "hono";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { projects as projectsTable } from "../db/schema";
import { broadcastDraftUpdate, getMcVersion, pushProjectDeleted } from "../ws/hub";
import { customItemsCacheDir, readCustomItems } from "../lib/customItems";
import { getProject, projectDiskId, resolveProjectRef, softDeleteProject } from "../lib/projectStorage";
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

  // L'IDENTITÉ seule : nom, slug, serveur propriétaire, network. Le contenu vit
  // sur le disque du serveur et se lit par `project_read` (ADR
  // `server-disk-only-storage`).
  return c.json({
    project,
    networkId,
    serverKeyId: project.serverKeyId,
  });
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
