import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { db } from "../db/index";
import { users } from "../db/schema";
import { findSession, touchSession } from "../lib/sessionManager";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  editorLanguage: string | null;
}

declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser | null;
  }
}

export const userAuth = () => createMiddleware(async (c, next) => {
  const sessionId = getCookie(c, "ifz_user_session");
  if (!sessionId) {
    c.set("user", null);
    return next();
  }
  const session = await findSession(sessionId);
  if (!session) {
    c.set("user", null);
    return next();
  }
  const rows = await db.select().from(users).where(eq(users.id, session.userId));
  if (rows.length === 0) {
    c.set("user", null);
    return next();
  }
  const row = rows[0];
  c.set("user", {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl,
    editorLanguage: row.editorLanguage,
  });
  await touchSession(sessionId);
  return next();
});
