// backend/src/routes/userPacks.ts
import { Hono } from "hono";
import type { Context } from "hono";
import { getPack, upsertPackContent } from "../lib/packStorage";
import { getNetworkOfPack, requireMember } from "../lib/membershipGuard";
import { pushBundleAvailable } from "../ws/hub";
import type { AuthUser } from "../middleware/userAuth";

type Vars = { user: AuthUser | null };

export const userPacksRouter = new Hono<{ Variables: Vars }>();

function getUserId(c: Context<{ Variables: Vars }>): string | null {
  return c.get("user")?.id ?? null;
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
    files: JSON.parse(pack.filesJson),
    editor: pack.editorJson ? JSON.parse(pack.editorJson) : null,
  });
});
