import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { linkCodes, serverKeys } from "../db/schema";
import { generateCode, generateServerKey } from "../lib/auth";
import { pushLinkConfirmed } from "../ws/hub";

const EDITOR_URL = process.env.EDITOR_URL ?? "http://localhost:5173";

const router = new Hono();

router.post("/", async (c) => {
  const code = generateCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
  await db.insert(linkCodes).values({ code, createdAt: now, expiresAt });
  return c.json({ code, url: `${EDITOR_URL}/link?code=${code}`, expires_at: expiresAt.toISOString() }, 201);
});

router.get("/:code", async (c) => {
  const code = c.req.param("code");
  const rows = await db.select().from(linkCodes).where(eq(linkCodes.code, code));
  if (rows.length === 0) return c.json({ error: "Not found" }, 404);
  const row = rows[0];
  if (row.claimedAt) return c.json({ status: "claimed", code });
  if (row.expiresAt < new Date()) return c.json({ status: "expired", code });
  return c.json({ status: "pending", code, expires_at: row.expiresAt.toISOString() });
});

router.post("/:code/claim", async (c) => {
  const code = c.req.param("code");
  const rows = await db.select().from(linkCodes).where(eq(linkCodes.code, code));
  if (rows.length === 0) return c.json({ error: "Not found" }, 404);
  const row = rows[0];
  if (row.claimedAt) return c.json({ error: "Already claimed" }, 409);
  if (row.expiresAt < new Date()) return c.json({ error: "Expired" }, 410);

  const { id, key, hash } = await generateServerKey();
  await db.transaction(async (tx) => {
    await tx.insert(serverKeys).values({ id, hash, label: null, createdAt: new Date() });
    await tx.update(linkCodes).set({ claimedAt: new Date(), serverKeyId: id }).where(eq(linkCodes.code, code));
  });

  // B1 flow: push server_key to the plugin WS session that sent setup_request for this code.
  // No-op until Task 4 populates codeToConn via setup_request handling.
  // Also a correct no-op in B2 (dashboard-first) where no plugin WS session is waiting.
  pushLinkConfirmed(code, key);

  return c.json({ server_key_id: id }, 200);
});

export { router as linkRouter };
