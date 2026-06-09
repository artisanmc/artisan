import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { db } from "../db/index";
import { users } from "../db/schema";
import { createSession } from "../lib/sessionManager";
import { userAuth } from "./userAuth";
import { requireAdmin } from "./requireAdmin";

async function seedUser(isAdmin: boolean): Promise<{ userId: string; sessionId: string }> {
  const userId = "user_" + crypto.randomUUID().slice(0, 8);
  const now = new Date();
  await db.insert(users).values({
    id: userId, email: `${userId}@example.com`, name: "Test", isAdmin, createdAt: now, updatedAt: now,
  });
  const session = await createSession(userId);
  return { userId, sessionId: session.id };
}

function appWith() {
  const app = new Hono();
  app.use("/x", userAuth());
  app.use("/x", requireAdmin());
  app.get("/x", (c) => c.json({ ok: true }));
  return app;
}

describe("requireAdmin middleware", () => {
  test("403 without a session", async () => {
    const res = await appWith().fetch(new Request("http://x/x"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("forbidden");
  });

  test("403 for a non-admin user", async () => {
    const { sessionId } = await seedUser(false);
    const res = await appWith().fetch(new Request("http://x/x", {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    }));
    expect(res.status).toBe(403);
  });

  test("200 for an admin user", async () => {
    const { sessionId } = await seedUser(true);
    const res = await appWith().fetch(new Request("http://x/x", {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
