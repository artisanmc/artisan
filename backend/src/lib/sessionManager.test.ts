import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { users, userSessions } from "../db/schema";
import { createSession, destroySession, findSession, touchSession } from "./sessionManager";

async function seedUser(): Promise<string> {
  const id = "user_" + crypto.randomUUID().slice(0, 8);
  const now = new Date();
  await db.insert(users).values({
    id, email: `${id}@example.com`, name: "Test", createdAt: now, updatedAt: now,
  });
  return id;
}

describe("createSession", () => {
  test("creates a row in user_sessions with a 32-char id", async () => {
    const userId = await seedUser();
    const session = await createSession(userId);
    expect(session.id).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(session.userId).toBe(userId);

    const rows = await db.select().from(userSessions).where(eq(userSessions.id, session.id));
    expect(rows).toHaveLength(1);
  });

  test("sets expiresAt 30 days in the future by default", async () => {
    const userId = await seedUser();
    const session = await createSession(userId);
    const delta = session.expiresAt.getTime() - Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(delta - thirtyDays)).toBeLessThan(5_000);
  });
});

describe("findSession", () => {
  test("returns the session when valid", async () => {
    const userId = await seedUser();
    const session = await createSession(userId);
    const found = await findSession(session.id);
    expect(found?.userId).toBe(userId);
  });

  test("returns null when expired", async () => {
    const userId = await seedUser();
    const session = await createSession(userId);
    await db.update(userSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(userSessions.id, session.id));
    expect(await findSession(session.id)).toBeNull();
  });

  test("returns null for unknown id", async () => {
    expect(await findSession("not-a-real-session-id")).toBeNull();
  });
});

describe("touchSession", () => {
  test("updates lastUsedAt", async () => {
    const userId = await seedUser();
    const session = await createSession(userId);
    const before = session.lastUsedAt.getTime();
    await new Promise((r) => setTimeout(r, 10));
    await touchSession(session.id);
    const rows = await db.select().from(userSessions).where(eq(userSessions.id, session.id));
    expect(rows[0].lastUsedAt.getTime()).toBeGreaterThan(before);
  });
});

describe("destroySession", () => {
  test("removes the row", async () => {
    const userId = await seedUser();
    const session = await createSession(userId);
    await destroySession(session.id);
    const rows = await db.select().from(userSessions).where(eq(userSessions.id, session.id));
    expect(rows).toHaveLength(0);
  });

  test("no-ops on unknown id", async () => {
    await destroySession("not-a-real-session-id");
    // pas d'exception = succès
  });
});
