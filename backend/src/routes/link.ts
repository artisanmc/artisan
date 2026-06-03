import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getCookie } from "hono/cookie";
import { db } from "../db/index";
import { linkCodes, serverKeys, memberships, users, packs } from "../db/schema";
import { generateCode, generateServerKey } from "../lib/auth";
import { pushLinkConfirmed } from "../ws/hub";
import { createNetwork } from "../lib/networkManager";
import { addMembership } from "../lib/membershipManager";
import { findSession } from "../lib/sessionManager";
import { createPack } from "../lib/packStorage";

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
  // Auth gate — requires valid artisan_user_session cookie
  const userSessionId = getCookie(c, "artisan_user_session");
  if (!userSessionId) return c.json({ error: "unauthorized" }, 401);
  const session = await findSession(userSessionId);
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const userRows = await db.select().from(users).where(eq(users.id, session.userId));
  if (userRows.length === 0) return c.json({ error: "unauthorized" }, 401);
  const user = userRows[0];

  const code = c.req.param("code");
  const rows = await db.select().from(linkCodes).where(eq(linkCodes.code, code));
  if (rows.length === 0) return c.json({ error: "Not found" }, 404);
  const row = rows[0];
  if (row.claimedAt) return c.json({ error: "Already claimed" }, 409);
  if (row.expiresAt < new Date()) return c.json({ error: "Expired" }, 410);

  // Body lets the caller pick or create the destination network AND pack in
  // one shot. The legacy "smart count" path stays as a fallback when no body
  // is sent, so older clients keep working.
  let body: {
    network_id?: unknown;
    network_name?: unknown;
    pack_id?: unknown;
    pack_name?: unknown;
    server_key_label?: unknown;
  } = {};
  try { body = await c.req.json(); } catch { /* empty body */ }
  const networkIdInput = typeof body.network_id === "string" ? body.network_id : undefined;
  const networkNameInput = typeof body.network_name === "string" ? body.network_name.trim() : undefined;
  const packIdInput = typeof body.pack_id === "string" ? body.pack_id : undefined;
  const packNameInput = typeof body.pack_name === "string" ? body.pack_name.trim() : undefined;
  const serverKeyLabel = typeof body.server_key_label === "string"
    ? body.server_key_label.trim() || null
    : null;

  if (networkIdInput && networkNameInput) {
    return c.json({ error: "ambiguous_network" }, 400);
  }
  if (packIdInput && packNameInput) {
    return c.json({ error: "ambiguous_pack" }, 400);
  }

  // Resolve target network: explicit id > new (with name) > smart count fallback.
  const userMemberships = await db
    .select({ networkId: memberships.networkId })
    .from(memberships)
    .where(eq(memberships.userId, user.id));
  const ownedNetworkIds = userMemberships.map((m) => m.networkId);

  let targetNetworkId: string;
  if (networkIdInput) {
    if (!ownedNetworkIds.includes(networkIdInput)) {
      return c.json({ error: "forbidden" }, 403);
    }
    targetNetworkId = networkIdInput;
  } else if (networkNameInput) {
    if (networkNameInput.length === 0) {
      return c.json({ error: "invalid_network_name" }, 422);
    }
    const network = await createNetwork(networkNameInput);
    await addMembership(user.id, network.id, "owner");
    targetNetworkId = network.id;
  } else if (ownedNetworkIds.length === 0) {
    const network = await createNetwork("Mon Network");
    await addMembership(user.id, network.id, "owner");
    targetNetworkId = network.id;
  } else if (ownedNetworkIds.length === 1) {
    targetNetworkId = ownedNetworkIds[0]!;
  } else {
    return c.json({ error: "must_choose_network", networks: ownedNetworkIds }, 400);
  }

  // Generate the server key id up-front so it can be embedded in the pack row
  // (packs.serverKeyId is NOT NULL — pack creation requires an owning key).
  const { id, key, hash } = await generateServerKey();

  // Resolve target pack: explicit id (within target network) > new (with name)
  // > skip (no pack created).
  let targetPackId: string | null = null;
  if (packIdInput) {
    const packRows = await db.select().from(packs).where(eq(packs.id, packIdInput));
    if (packRows.length === 0 || packRows[0]?.networkId !== targetNetworkId) {
      return c.json({ error: "pack_not_in_network" }, 404);
    }
    targetPackId = packIdInput;
  } else if (packNameInput) {
    if (packNameInput.length === 0) {
      return c.json({ error: "invalid_pack_name" }, 422);
    }
    const pack = await createPack({
      networkId: targetNetworkId,
      serverKeyId: id,
      name: packNameInput,
      description: null,
    });
    targetPackId = pack.id;
  }

  await db.transaction(async (tx) => {
    await tx.insert(serverKeys).values({
      id,
      hash,
      label: serverKeyLabel,
      networkId: targetNetworkId,
      createdAt: new Date(),
    });
    await tx.update(linkCodes).set({ claimedAt: new Date(), serverKeyId: id })
      .where(eq(linkCodes.code, code));
  });

  // Push server_key to any plugin WS session waiting on this code.
  pushLinkConfirmed(code, key);

  return c.json({
    server_key_id: id,
    network_id: targetNetworkId,
    pack_id: targetPackId,
  }, 200);
});

export { router as linkRouter };
