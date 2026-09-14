// backend/src/routes/userProjects.ts
import { Hono } from "hono";
import type { Context } from "hono";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { projects as projectsTable } from "../db/schema";
import { broadcastDraftUpdate, getMcVersion, pushProjectDeleted, requestProjectList, reconcileServerProjectIdentity } from "../ws/hub";
import { customItemsCacheDir, readCustomItems } from "../lib/customItems";
import { ensureProjectForServer, getProject, projectDiskId, resolveProjectRef, softDeleteProject } from "../lib/projectStorage";
import { getNetworkOfProject, requireMember } from "../lib/membershipGuard";
import type { AuthUser } from "../middleware/userAuth";
import { resolveProjectStorage } from "../lib/storage/resolveProjectStorage";
import { projectRuntime } from "../lib/projectRuntime";
import { deleteStoredProject } from "../lib/deleteStoredProject";
import {requestProjectPrincipal} from '../middleware/demoAuth';
import { authorizeProjectPrincipal } from '../lib/projectPrincipal';
import { resolveProjectServer } from '../lib/refs';

type Vars = { user: AuthUser | null };

export const userProjectsRouter = new Hono<{ Variables: Vars }>();

/**
 * Crée (ou retrouve) la ligne d'ancrage d'un Project que le serveur porte sur son
 * disque mais que la base ne connaît pas encore.
 *
 * Depuis que la liste vient du disque, un dossier neuf ou renommé est visible et
 * ouvrable avant toute écriture en base. La ligne ne décrit plus « ce qui
 * existe » — elle sert de point d'accroche aux objets que le backend possède
 * vraiment (assets, resource pack, conversations d'assistant).
 *
 * Renvoie l'id interne, ou null si le serveur est inconnu / hors du network du
 * membre.
 */
async function ensureAnchorForDiskId(
  userId: string,
  serverRef: string,
  diskId: string,
  networkRef?: string | null,
): Promise<string | null> {
  const sk = await resolveProjectServer(serverRef, networkRef);
  if (!sk) return null;
  try {
    await requireMember(userId, sk.networkId);
  } catch {
    return null;
  }
  // C'est le DISQUE qui décide de ce qui existe : on n'ancre que ce que le
  // serveur porte réellement. Sans cette vérification, une référence mal tapée
  // sèmerait une ligne fantôme — le même piège que `create` à l'écriture.
  // Serveur hors ligne : on n'invente rien, l'appelant répondra 404.
  const listed = await requestProjectList(sk.id);
  if (listed.kind !== "result" || !listed.result.ok) return null;
  if (!(listed.result.project_ids ?? []).includes(diskId)) return null;

  const project = await ensureProjectForServer({
    networkId: sk.networkId,
    serverKeyId: sk.id,
    diskId,
  });
  await reconcileServerProjectIdentity(sk.id, { project_roots: listed.result.project_roots });
  return project.id;
}

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
  strictVersion = false,
): Promise<{ version: string; items: unknown[] } | null> {
  const itemsDir = join(import.meta.dir, "../../data/items");
  const tried: string[] = [];

  if (version) {
    const [major, minor] = version.split(".");
    const candidates = strictVersion ? [version] : [version, `${major}.${minor}`];
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
    if (strictVersion) return null;
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

  if (strictVersion) return null;
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
  let principal;
  try{principal=await requestProjectPrincipal(c,c.req.param('projectId')!);}catch(error){return c.json({error:(error as any).code},(error as any).status);}

  // Resolve the exact project ID or historical alias in its URL location.
  const ref = c.req.param("projectId")!;
  const serverRef = c.req.query("server");
  let projectId = await resolveProjectRef(ref, serverRef, c.req.query("network"));

  // Rien en base ? Le project existe peut-être quand même : la liste vient
  // désormais du DISQUE (ADR `server-disk-only-storage`), donc un dossier créé
  // ou renommé apparaît dans l'éditeur avant d'avoir la moindre ligne. On crée
  // son point d'ancrage à la volée — c'est lui qui portera les assets, le
  // resource pack et les conversations, pas le contenu.
  if (projectId === null && serverRef&&typeof principal==='string') {
    const anchored = await ensureAnchorForDiskId(principal, serverRef, ref, c.req.query("network"));
    if (anchored) projectId = anchored;
  }
  if (projectId === null) return c.json({ error: "not_found" }, 404);

  const project = await getProject(projectId);
  if (project === null || project.deletedAt) return c.json({ error: "not_found" }, 404);
  let storage;try{storage=await resolveProjectStorage(principal,project.id);}catch{return c.json({error:'forbidden'},403);}
  const runtime = projectRuntime(project);

  // L'IDENTITÉ seule : ID interne, dossier, serveur propriétaire, network. Le contenu vit
  // sur le disque du serveur et se lit par `project_read` (ADR
  // `server-disk-only-storage`).
  return c.json({
    project,
    networkId:project.networkId,
    serverKeyId: project.serverKeyId,
    capabilities: storage.capabilities,
    minecraftVersion: await runtime.minecraftVersion(),
    connection: { available: runtime.available() },
  });
});

// GET /api/user/projects/:projectId/items — vanilla item bundle for the project's MC version
userProjectsRouter.get("/:projectId/items", async (c: Context<{ Variables: Vars }>) => {
  let principal;try{principal=await requestProjectPrincipal(c,c.req.param('projectId')!);}catch(error){return c.json({error:(error as any).code},(error as any).status);}

  // Identity reads share the same scoped resolution.
  const projectId = await resolveProjectRef(c.req.param("projectId")!, c.req.query("server"), c.req.query("network"));
  if (projectId === null) return c.json({ error: "not_found" }, 404);
  try {
      const project = await getProject(projectId);
      if (!project || project.deletedAt) return c.json({ error: "not_found" }, 404);
      await authorizeProjectPrincipal(principal, project);
  } catch {
    return c.json({ error: "forbidden" }, 403);
  }

  const anchor = await getProject(projectId);
  if (!anchor || anchor.deletedAt) return c.json({ error: "not_found" }, 404);
  const runtime = projectRuntime(anchor);
  const version = await runtime.minecraftVersion();
  const result = await loadVanillaItems(version ?? undefined, !runtime.allowCatalogFallback);
  if (!result) return c.json({ error: "unknown_version" }, 404);

  return c.json(result);
});

// GET /api/user/projects/:projectId/custom-items — custom item bundle for the project's server_key
userProjectsRouter.get("/:projectId/custom-items", async (c: Context<{ Variables: Vars }>) => {
  try{const principal=await requestProjectPrincipal(c,c.req.param('projectId')!);if(typeof principal!=='string'){await resolveProjectStorage(principal,c.req.param('projectId')!);return c.json({serverKeyId:'',items:[]});}}catch(error){return c.json({error:(error as any).code??'forbidden'},(error as any).status??403);}
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const projectId = await resolveProjectRef(c.req.param("projectId")!, c.req.query("server"), c.req.query("network"));
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

  const projectId = c.req.param("projectId")!;
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

  const projectId = c.req.param("projectId")!;
  const networkId = await getNetworkOfProject(projectId);
  if (networkId === null) return c.json({ error: "not_found" }, 404);

  try {
    await requireMember(userId, networkId);
  } catch {
    return c.json({ error: "forbidden" }, 403);
  }

  const project = await getProject(projectId);
  if (!project || project.deletedAt) return c.json({ error: "not_found" }, 404);

  try { await deleteStoredProject(projectId, c.req.header("Idempotency-Key") ?? crypto.randomUUID()); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "rename_in_progress") return c.json({ error: "rename_in_progress" }, 409);
    throw error;
  }
  return c.json({ deleted: true });
});
