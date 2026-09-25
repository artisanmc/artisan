import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { db } from "../db/index";
import { users, type EditorTourState } from "../db/schema";
import { findSession, touchSession } from "../lib/sessionManager";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  editorLanguage: string | null;
  theme: string | null;
  editorTour: EditorTourState | null;
  isAdmin: boolean;
}

declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser | null;
  }
}

export const userAuth = () => createMiddleware(async (c, next) => {
  const sessionId = getCookie(c, "artisan_user_session");
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

  // Super-admin bootstrap: any user whose email is in ADMIN_BOOTSTRAP_EMAILS is
  // promoted to admin on first authenticated request. The DB write is guarded by
  // `!isAdmin`, so it happens at most once per user (covers all auth paths:
  // login / signup / Discord, and retroactively for existing users).
  const bootstrap = (process.env.ADMIN_BOOTSTRAP_EMAILS ?? "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  let isAdmin = row.isAdmin ?? false;
  if (!isAdmin && bootstrap.includes(row.email.toLowerCase())) {
    await db.update(users).set({ isAdmin: true }).where(eq(users.id, row.id));
    isAdmin = true;
  }

  c.set("user", {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl,
    editorLanguage: row.editorLanguage,
    theme: row.theme ?? null,
    editorTour: row.editorTour,
    isAdmin,
  });
  await touchSession(sessionId);
  return next();
});
