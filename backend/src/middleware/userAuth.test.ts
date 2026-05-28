import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { db } from "../db/index";
import { users } from "../db/schema";
import { createSession } from "../lib/sessionManager";
import { userAuth } from "./userAuth";

async function seedUser(): Promise<{ userId: string; sessionId: string }> {
  const userId = "user_" + crypto.randomUUID().slice(0, 8);
  const now = new Date();
  await db.insert(users).values({
    id: userId, email: `${userId}@example.com`, name: "Test", createdAt: now, updatedAt: now,
  });
  const session = await createSession(userId);
  return { userId, sessionId: session.id };
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
});
