import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index";
import { users } from "../db/schema";
import { createSession } from "../lib/sessionManager";
import { userAuth } from "./userAuth";

async function seedUser(email?: string): Promise<{ userId: string; email: string; sessionId: string }> {
  const userId = "user_" + crypto.randomUUID().slice(0, 8);
  const userEmail = email ?? `${userId}@example.com`;
  const now = new Date();
  await db.insert(users).values({
    id: userId, email: userEmail, name: "Test", createdAt: now, updatedAt: now,
  });
  const session = await createSession(userId);
  return { userId, email: userEmail, sessionId: session.id };
}

describe("userAuth middleware", () => {
  test("attaches user when cookie is valid", async () => {
    const { userId, sessionId } = await seedUser();
    const app = new Hono();
    app.use("/x", userAuth());
    app.get("/x", (c) => c.json({ userId: c.var.user?.id ?? null }));

    const res = await app.fetch(new Request("http://x/x", {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe(userId);
  });

  test("attaches null when no cookie", async () => {
    const app = new Hono();
    app.use("/x", userAuth());
    app.get("/x", (c) => c.json({ userId: c.var.user?.id ?? null }));

    const res = await app.fetch(new Request("http://x/x"));
    const body = await res.json();
    expect(body.userId).toBeNull();
  });

  test("attaches null when cookie references unknown session", async () => {
    const app = new Hono();
    app.use("/x", userAuth());
    app.get("/x", (c) => c.json({ userId: c.var.user?.id ?? null }));

    const res = await app.fetch(new Request("http://x/x", {
      headers: { Cookie: "artisan_user_session=does-not-exist" },
    }));
    const body = await res.json();
    expect(body.userId).toBeNull();
  });

  test("bootstraps an admin when email is in ADMIN_BOOTSTRAP_EMAILS", async () => {
    const email = `boot_${crypto.randomUUID().slice(0, 8)}@example.com`;
    const prev = process.env.ADMIN_BOOTSTRAP_EMAILS;
    process.env.ADMIN_BOOTSTRAP_EMAILS = `someone-else@x.com, ${email.toUpperCase()}`;
    try {
      const { userId, sessionId } = await seedUser(email);
      const app = new Hono();
      app.use("/x", userAuth());
      app.get("/x", (c) => c.json({ isAdmin: c.var.user?.isAdmin ?? null }));

      const res = await app.fetch(new Request("http://x/x", {
        headers: { Cookie: `artisan_user_session=${sessionId}` },
      }));
      const body = await res.json();
      expect(body.isAdmin).toBe(true);

      // The promotion is persisted to the DB row, not just the request context.
      const [row] = await db.select().from(users).where(eq(users.id, userId));
      expect(row.isAdmin).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.ADMIN_BOOTSTRAP_EMAILS;
      else process.env.ADMIN_BOOTSTRAP_EMAILS = prev;
    }
  });

  test("does not bootstrap a user whose email is not in the list", async () => {
    const prev = process.env.ADMIN_BOOTSTRAP_EMAILS;
    process.env.ADMIN_BOOTSTRAP_EMAILS = "someone-else@x.com";
    try {
      const { userId, sessionId } = await seedUser();
      const app = new Hono();
      app.use("/x", userAuth());
      app.get("/x", (c) => c.json({ isAdmin: c.var.user?.isAdmin ?? null }));

      const res = await app.fetch(new Request("http://x/x", {
        headers: { Cookie: `artisan_user_session=${sessionId}` },
      }));
      const body = await res.json();
      expect(body.isAdmin).toBe(false);

      const [row] = await db.select().from(users).where(eq(users.id, userId));
      expect(row.isAdmin).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.ADMIN_BOOTSTRAP_EMAILS;
      else process.env.ADMIN_BOOTSTRAP_EMAILS = prev;
    }
  });
});
