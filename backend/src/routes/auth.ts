import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { db } from "../db/index";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "../lib/passwordHasher";
import { normalizeEmail } from "../lib/emailNormalizer";
import { createSession, destroySession, destroyUserSessions } from "../lib/sessionManager";
import { userAuth } from "../middleware/userAuth";
import { sendSafely } from "../lib/mail/mailer";
import { passwordResetEmail, welcomeEmail } from "../lib/mail/templates";
import { consumeResetToken, createResetToken, invalidateUserResetTokens } from "../lib/passwordResetStorage";

const router = new Hono();

function newUserId(): string {
  return "user_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function setSessionCookie(c: Parameters<typeof setCookie>[0], sessionId: string, expires: Date) {
  setCookie(c, "artisan_user_session", sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    expires,
    path: "/",
  });
}

router.post("/signup", async (c) => {
  const body = await c.req.json().catch(() => null) as
    | { email?: string; password?: string; name?: string }
    | null;
  if (!body || !body.email || !body.password || !body.name) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const email = normalizeEmail(body.email);
  if (!email.includes("@") || email.length < 3) {
    return c.json({ error: "invalid_email" }, 422);
  }
  if (body.password.length < 8) {
    return c.json({ error: "weak_password" }, 422);
  }
  const existing = await db.select().from(users).where(eq(users.email, email));
  if (existing.length > 0) {
    return c.json({ error: "email_taken" }, 409);
  }
  const id = newUserId();
  const now = new Date();
  const passwordHash = await hashPassword(body.password);
  await db.insert(users).values({
    id, email, name: body.name, passwordHash,
    avatarUrl: null, createdAt: now, updatedAt: now,
  });
  const session = await createSession(id);
  setSessionCookie(c, session.id, session.expiresAt);
  sendSafely(welcomeEmail({ to: email, displayName: body.name }));
  return c.json({ user: { id, email, name: body.name, avatarUrl: null } }, 201);
});

router.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null) as
    | { email?: string; password?: string }
    | null;
  if (!body || !body.email || !body.password) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const email = normalizeEmail(body.email);
  const rows = await db.select().from(users).where(eq(users.email, email));
  if (rows.length === 0) {
    return c.json({ error: "invalid_credentials" }, 401);
  }
  const row = rows[0];
  if (!row.passwordHash) {
    return c.json({ error: "invalid_credentials" }, 401);
  }
  const ok = await verifyPassword(body.password, row.passwordHash);
  if (!ok) {
    return c.json({ error: "invalid_credentials" }, 401);
  }
  const session = await createSession(row.id);
  setSessionCookie(c, session.id, session.expiresAt);
  return c.json({
    user: {
      id: row.id, email: row.email, name: row.name, avatarUrl: row.avatarUrl,
    },
  });
});

router.post("/logout", async (c) => {
  const sessionId = getCookie(c, "artisan_user_session");
  if (sessionId) await destroySession(sessionId);
  deleteCookie(c, "artisan_user_session", { path: "/" });
  return c.body(null, 204);
});

// Always 204, whether or not the email matches an account — a differing status
// or timing-free error body would turn this route into an account enumerator.
// NOTE (prod-readiness backlog): no rate limiting, same standing gap as
// POST /invites/accept.
router.post("/forgot-password", async (c) => {
  const body = await c.req.json().catch(() => null) as { email?: string } | null;
  if (!body || !body.email) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const email = normalizeEmail(body.email);
  const rows = await db.select().from(users).where(eq(users.email, email));
  const row = rows[0];
  if (row) {
    const token = await createResetToken(row.id);
    const editorUrl = process.env.EDITOR_URL ?? "http://localhost:5173";
    sendSafely(passwordResetEmail({
      to: row.email,
      displayName: row.name,
      url: `${editorUrl}/reset-password?token=${encodeURIComponent(token)}`,
      locale: row.editorLanguage === "fr" ? "fr" : "en",
    }));
  }
  return c.body(null, 204);
});

router.post("/reset-password", async (c) => {
  const body = await c.req.json().catch(() => null) as
    | { token?: string; password?: string }
    | null;
  if (!body || !body.token || !body.password) {
    return c.json({ error: "invalid_body" }, 400);
  }
  // Validate the password BEFORE consuming — a rejected attempt must leave the
  // link usable, otherwise a typo forces a whole new email round-trip.
  if (body.password.length < 8) {
    return c.json({ error: "weak_password" }, 422);
  }
  const userId = await consumeResetToken(body.token);
  if (!userId) {
    return c.json({ error: "invalid_token" }, 400);
  }
  const passwordHash = await hashPassword(body.password);
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
  // Whoever held a stolen session loses it, and any other outstanding reset
  // link dies with it.
  await destroyUserSessions(userId);
  await invalidateUserResetTokens(userId);
  return c.body(null, 204);
});

router.get("/me", userAuth(), (c) => {
  const user = c.var.user;
  if (!user) return c.json({ error: "unauthorized" }, 401);
  return c.json({
    user: {
      id: user.id, email: user.email, name: user.name,
      avatarUrl: user.avatarUrl, editorLanguage: user.editorLanguage,
      theme: user.theme, isAdmin: user.isAdmin,
    },
  });
});

router.patch("/me", userAuth(), async (c) => {
  const user = c.var.user;
  if (!user) return c.json({ error: "unauthorized" }, 401);

  let body: { editor_language?: string | null; theme?: string | null };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }

  const updates: Record<string, unknown> = {};
  if ("editor_language" in body) {
    updates.editorLanguage = body.editor_language ?? null;
  }
  if ("theme" in body) {
    if (body.theme !== "dark" && body.theme !== "light" && body.theme !== null) {
      return c.json({ error: "invalid_theme" }, 422);
    }
    updates.theme = body.theme;
  }

  if (Object.keys(updates).length === 0) {
    return c.json({
      user: {
        id: user.id, email: user.email, name: user.name,
        avatarUrl: user.avatarUrl, editorLanguage: user.editorLanguage,
        theme: user.theme, isAdmin: user.isAdmin,
      },
    });
  }

  await db.update(users).set(updates).where(eq(users.id, user.id));
  const [row] = await db.select().from(users).where(eq(users.id, user.id));
  return c.json({
    user: {
      id: row.id, email: row.email, name: row.name,
      avatarUrl: row.avatarUrl, editorLanguage: row.editorLanguage,
      theme: row.theme, isAdmin: row.isAdmin,
    },
  });
});

export { router as authRouter };
