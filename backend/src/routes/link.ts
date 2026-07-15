import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { linkCodes, networks } from "../db/schema";
import { redeemLinkCode } from "../lib/linkCodeStorage";

const router = new Hono();

// GET /:code — link code status, for the editor "Add server" screen to show
// whether the server has connected yet. No auth (the code is the bearer).
router.get("/:code", async (c) => {
  const code = c.req.param("code");
  const rows = await db.select().from(linkCodes).where(eq(linkCodes.code, code));
  if (rows.length === 0) return c.json({ error: "Not found" }, 404);
  const row = rows[0];
  if (row.claimedAt) return c.json({ status: "claimed", code });
  if (row.expiresAt < new Date()) return c.json({ status: "expired", code });
  return c.json({ status: "pending", code, expires_at: row.expiresAt.toISOString() });
});

// POST /:code/redeem — the plugin (`/artisan link <code>`) exchanges the code
// for the server_key secret. No auth: the code itself is the single-use bearer,
// minted by an authenticated editor user when the server was added. The secret
// is generated here (never stored in plaintext) and returned exactly once.
router.post("/:code/redeem", async (c) => {
  const code = c.req.param("code");
  const result = await redeemLinkCode(code);
  if (!result.ok) {
    switch (result.reason) {
      case "expired":
        return c.json({ error: "expired" }, 410);
      case "claimed":
        return c.json({ error: "already_redeemed" }, 409);
      default:
        return c.json({ error: "not_found" }, 404);
    }
  }
  const [net] = await db
    .select({ name: networks.name })
    .from(networks)
    .where(eq(networks.id, result.networkId));
  return c.json(
    {
      server_key: result.serverKey,
      server_key_id: result.serverKeyId,
      network_name: net?.name ?? null,
    },
    200,
  );
});

export { router as linkRouter };
