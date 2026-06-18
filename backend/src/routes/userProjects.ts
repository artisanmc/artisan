// backend/src/routes/userProjects.ts
import { Hono } from "hono";
import type { Context } from "hono";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { projects as projectsTable } from "../db/schema";
import { getMcVersion } from "../ws/hub";
import { customItemsCacheDir, readCustomItems } from "../lib/customItems";
import { getProject, upsertProjectContent } from "../lib/projectStorage";
import { getNetworkOfProject, requireMember } from "../lib/membershipGuard";
import type { AuthUser } from "../middleware/userAuth";

type Vars = { user: AuthUser | null };

// TODO(phase4-wire): mount path `/user/packs` + the `:packId` route param + the
// `pack` response key stay on the old names until the Phase 4 wire flip.
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

// GET /api/user/packs/:packId — read project (member only)
userProjectsRouter.get("/:packId", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const projectId = c.req.param("packId"); // TODO(phase4-wire): :packId path param

  const networkId = await getNetworkOfProject(projectId);
  if (networkId === null) return c.json({ error: "not_found" }, 404);

  try {
    await requireMember(userId, networkId);
  } catch {
    return c.json({ error: "forbidden" }, 403);
  }

  const project = await getProject(projectId);
  if (project === null) return c.json({ error: "not_found" }, 404);

  return c.json({
    pack: project, // TODO(phase4-wire): response key `pack` → `project`
    networkId,
    serverKeyId: project.serverKeyId,
    files: JSON.parse(project.filesJson),
    editor: project.editorJson ? JSON.parse(project.editorJson) : null,
  });
});

// GET /api/user/packs/:packId/items — vanilla item bundle for the project's MC version
userProjectsRouter.get("/:packId/items", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const projectId = c.req.param("packId");
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

// GET /api/user/packs/:packId/custom-items — custom item bundle for the project's server_key
userProjectsRouter.get("/:packId/custom-items", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const projectId = c.req.param("packId");
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

// PUT /api/user/packs/:packId — write project content + broadcast (member only)
userProjectsRouter.put("/:packId", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const projectId = c.req.param("packId");

  const networkId = await getNetworkOfProject(projectId);
  if (networkId === null) return c.json({ error: "not_found" }, 404);

  try {
    await requireMember(userId, networkId);
  } catch {
    return c.json({ error: "forbidden" }, 403);
  }

  const body = await c.req.json<{ hash: string; files: Record<string, string>; editor: unknown }>();

  await upsertProjectContent(projectId, {
    hash: body.hash,
    filesJson: JSON.stringify(body.files),
    editorJson: body.editor ? JSON.stringify(body.editor) : null,
  });

  return c.json({ ok: true });
});
