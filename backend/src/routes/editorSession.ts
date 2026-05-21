import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { and, eq, isNull } from "drizzle-orm";
import { join } from "path";
import { db } from "../db/index";
import { editorSessions, packs, serverKeys } from "../db/schema";
import { generateEditorToken, generateTrustCode, validateAccessToken } from "../lib/auth";
import { checkRateLimit } from "../lib/rateLimit";
import { computeBundleHash } from "../lib/hashUtils";
import { broadcastDraftUpdate, pushBundleAvailable, pushPackDeleted, getMcVersion, trackEditorIp } from "../ws/hub";
import { customItemsCacheDir, readCustomItems } from "../lib/customItems";
import { readEditorLayoutFromFiles } from "../lib/packImport";
import { listPacksForServerKey, createBinding } from "../lib/packBindingManager";
import { getPack, upsertPackContent, createPack, softDeletePack } from "../lib/packStorage";

function buildEditorJsonWithLayout(rawPack: unknown, files: Record<string, string>, packId: string): string {
  // Spread to a fresh object — mutating rawPack in place is a footgun for any
  // caller that later reads body.pack.
  const pack = { ...(rawPack as Record<string, unknown>) };
  pack.canvasLayout = readEditorLayoutFromFiles(files, packId); // files win
  return JSON.stringify(pack);
}

const router = new Hono();

function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header("x-forwarded-for") ?? c.req.header("cf-connecting-ip") ?? "unknown";
}

router.post("/refresh", async (c) => {
  const token = getCookie(c, "ifz_refresh");
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

  setCookie(c, "ifz_refresh", newRefreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict",
    maxAge: 7 * 24 * 60 * 60,
    path: "/api/editor-session/refresh",
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

  setCookie(c, "ifz_refresh", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict",
    maxAge: 7 * 24 * 60 * 60,
    path: "/api/editor-session/refresh",
  });

  return c.json({ access_token: accessToken, expires_in: 300, trust_code: trustCode });
});

router.get("/:token", async (c) => {
  if (!checkRateLimit(`editor-validate:${clientIp(c)}`, 20)) return c.json({ error: "Too many requests" }, 429);
  const token = c.req.param("token");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  trackEditorIp(session.sessionId, clientIp(c));
  return c.json({ server_key_id: session.serverKeyId, trusted: session.trusted, trust_code: session.trustCode });
});

router.delete("/:token", async (c) => {
  const token = c.req.param("token");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  await db.update(editorSessions).set({ revokedAt: new Date() })
    .where(eq(editorSessions.token, session.sessionId));
  return c.json({ ok: true });
});

router.get("/:token/packs", async (c) => {
  const session = await validateAccessToken(c.req.param("token"));
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const packList = await listPacksForServerKey(session.serverKeyId);
  return c.json({
    packs: packList.map((p) => ({
      pack_id: p.id,
      name: p.name,
      hash: p.hash,
      files: JSON.parse(p.filesJson),
      editor: p.editorJson ? JSON.parse(p.editorJson) : null,
    })),
  });
});

router.put("/:token/packs/:packId", async (c) => {
  const session = await validateAccessToken(c.req.param("token"));
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const packId = c.req.param("packId");

  const body = await c.req.json<{ pack: unknown; files: Record<string, string> }>();
  if (body.pack == null || typeof body.pack !== "object") {
    return c.json({ error: "missing_or_invalid_pack" }, 400);
  }

  // server_key → network → pack must be in same network
  const skRows = await db.select().from(serverKeys).where(eq(serverKeys.id, session.serverKeyId));
  if (skRows.length === 0) return c.json({ error: "Server key missing" }, 500);
  const sk = skRows[0];

  let pack = await getPack(packId);
  if (!pack) {
    pack = await createPack({ networkId: sk.networkId, name: packId, id: packId });
    await createBinding(session.serverKeyId, packId);
  } else if (pack.networkId !== sk.networkId) {
    return c.json({ error: "Cross-network pack" }, 403);
  }

  const hash = await computeBundleHash(body.files, packId);
  const filesJson = JSON.stringify(body.files);
  const editorJson = buildEditorJsonWithLayout(body.pack, body.files, packId);

  await upsertPackContent(packId, { hash, filesJson, editorJson });

  return c.json({ hash }, 201);
});

router.post("/:token/packs/:packId/deploy", async (c) => {
  const session = await validateAccessToken(c.req.param("token"));
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const packId = c.req.param("packId");

  if (!session.trusted) return c.json({ error: "session_not_trusted" }, 403);
  if (session.trustedIp !== clientIp(c)) return c.json({ error: "session_not_trusted" }, 403);

  const body = await c.req.json<{ pack: unknown; files: Record<string, string> }>();
  if (body.pack == null || typeof body.pack !== "object") {
    return c.json({ error: "missing_or_invalid_pack" }, 400);
  }

  // server_key → network → pack must be in same network
  const skRows = await db.select().from(serverKeys).where(eq(serverKeys.id, session.serverKeyId));
  if (skRows.length === 0) return c.json({ error: "Server key missing" }, 500);
  const sk = skRows[0];

  let pack = await getPack(packId);
  if (!pack) {
    pack = await createPack({ networkId: sk.networkId, name: packId, id: packId });
    await createBinding(session.serverKeyId, packId);
  } else if (pack.networkId !== sk.networkId) {
    return c.json({ error: "Cross-network pack" }, 403);
  }

  const hash = await computeBundleHash(body.files, packId);
  const filesJson = JSON.stringify(body.files);
  const editorJson = buildEditorJsonWithLayout(body.pack, body.files, packId);

  await upsertPackContent(packId, {
    hash,
    filesJson,
    editorJson,
    deployedEditorJson: editorJson,
  });

  await pushBundleAvailable(packId, hash);
  return c.json({ hash }, 201);
});

router.get("/:token/packs/:packId/deployed", async (c) => {
  const session = await validateAccessToken(c.req.param("token"));
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const pack = await getPack(c.req.param("packId"));
  if (!pack || !pack.deployedEditorJson) return c.json({ deployed: null });
  return c.json({ deployed: JSON.parse(pack.deployedEditorJson) });
});

router.delete("/:token/packs/:packId", async (c) => {
  const session = await validateAccessToken(c.req.param("token"));
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const packId = c.req.param("packId");
  const pack = await getPack(packId);
  if (!pack || pack.deletedAt) return c.json({ error: "Not found" }, 404);

  await softDeletePack(packId);
  await pushPackDeleted(packId);
  return c.json({ deleted: true });
});

router.post("/:token/draft", async (c) => {
  const token = c.req.param("token");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json<{ pack_id: string; menu_id: string; menu_yaml: string }>();
  broadcastDraftUpdate(session.serverKeyId, body.pack_id, body.menu_id, body.menu_yaml, session.sessionId);
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
