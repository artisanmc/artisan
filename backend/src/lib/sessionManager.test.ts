import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { users, userSessions } from "../db/schema";
import { createSession } from "./sessionManager";

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
