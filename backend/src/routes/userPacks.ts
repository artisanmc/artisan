// backend/src/routes/userPacks.ts
import { Hono } from "hono";
import type { Context } from "hono";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { packs as packsTable } from "../db/schema";
import { getMcVersion } from "../ws/hub";
import { customItemsCacheDir, readCustomItems } from "../lib/customItems";
import { getPack, upsertPackContent } from "../lib/packStorage";
import { getNetworkOfPack, requireMember } from "../lib/membershipGuard";
import type { AuthUser } from "../middleware/userAuth";

type Vars = { user: AuthUser | null };

export const userPacksRouter = new Hono<{ Variables: Vars }>();

function getUserId(c: Context<{ Variables: Vars }>): string | null {
  return c.get("user")?.id ?? null;
}

/** Resolve the serverKeyId for the pack (1:1 ownership via packs.serverKeyId). */
async function getServerKeyIdForPack(packId: string): Promise<string | null> {
  const rows = await db
    .select({ serverKeyId: packsTable.serverKeyId })
    .from(packsTable)
    .where(eq(packsTable.id, packId))
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

// GET /api/user/packs/:packId — read pack (member only)
userPacksRouter.get("/:packId", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const packId = c.req.param("packId");

  const networkId = await getNetworkOfPack(packId);
  if (networkId === null) return c.json({ error: "not_found" }, 404);

  try {
    await requireMember(userId, networkId);
  } catch {
    return c.json({ error: "forbidden" }, 403);
  }

  const pack = await getPack(packId);
  if (pack === null) return c.json({ error: "not_found" }, 404);

  return c.json({
    pack,
    networkId,
    files: JSON.parse(pack.filesJson),
    editor: pack.editorJson ? JSON.parse(pack.editorJson) : null,
  });
});

// GET /api/user/packs/:packId/items — vanilla item bundle for the pack's MC version
userPacksRouter.get("/:packId/items", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const packId = c.req.param("packId");
  const networkId = await getNetworkOfPack(packId);
  if (networkId === null) return c.json({ error: "not_found" }, 404);

  try {
    await requireMember(userId, networkId);
  } catch {
    return c.json({ error: "forbidden" }, 403);
  }

  const serverKeyId = await getServerKeyIdForPack(packId);
  const version = serverKeyId ? await getMcVersion(serverKeyId) : undefined;
  const result = await loadVanillaItems(version);
  if (!result) return c.json({ error: "unknown_version" }, 404);

  return c.json(result);
});

// GET /api/user/packs/:packId/custom-items — custom item bundle for the pack's server_key
userPacksRouter.get("/:packId/custom-items", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const packId = c.req.param("packId");
  const networkId = await getNetworkOfPack(packId);
  if (networkId === null) return c.json({ error: "not_found" }, 404);

  try {
    await requireMember(userId, networkId);
  } catch {
    return c.json({ error: "forbidden" }, 403);
  }

  const serverKeyId = await getServerKeyIdForPack(packId);
  if (!serverKeyId) return c.json({ serverKeyId: "", items: [] });

  const cacheDir = customItemsCacheDir(serverKeyId);
  const items = await readCustomItems(cacheDir);
  return c.json({ serverKeyId, items });
});

// PUT /api/user/packs/:packId — write pack content + broadcast (member only)
userPacksRouter.put("/:packId", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const packId = c.req.param("packId");

  const networkId = await getNetworkOfPack(packId);
  if (networkId === null) return c.json({ error: "not_found" }, 404);

  try {
    await requireMember(userId, networkId);
  } catch {
    return c.json({ error: "forbidden" }, 403);
  }

  const body = await c.req.json<{ hash: string; files: Record<string, string>; editor: unknown }>();

  await upsertPackContent(packId, {
    hash: body.hash,
    filesJson: JSON.stringify(body.files),
    editorJson: body.editor ? JSON.stringify(body.editor) : null,
  });

  return c.json({ ok: true });
});
