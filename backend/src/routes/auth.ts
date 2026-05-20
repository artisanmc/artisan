import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { db } from "../db/index";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "../lib/passwordHasher";
import { normalizeEmail } from "../lib/emailNormalizer";
import { createSession } from "../lib/sessionManager";

const router = new Hono();

function newUserId(): string {
  return "user_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function setSessionCookie(c: Parameters<typeof setCookie>[0], sessionId: string, expires: Date) {
  setCookie(c, "ifz_user_session", sessionId, {
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
  return c.json({ user: { id, email, name: body.name, avatarUrl: null } }, 201);
});

export { router as authRouter };
