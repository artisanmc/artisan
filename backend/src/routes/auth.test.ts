import { afterEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../app";
import { db } from "../db/index";
import { users, userSessions } from "../db/schema";

async function cleanupByEmail(email: string) {
  await db.delete(users).where(eq(users.email, email));
}

describe("POST /api/auth/signup", () => {
  test("creates a user and sets the session cookie", async () => {
    const email = `signup_${Date.now()}@example.com`;
    const res = await app.fetch(new Request("http://x/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "correct horse battery staple", name: "Alice" }),
    }));
    expect(res.status).toBe(201);
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("ifz_user_session=");
    expect(setCookie).toContain("HttpOnly");
    const body = await res.json();
    expect(body.user.email).toBe(email);
    expect(body.user.name).toBe("Alice");
    expect(body.user.id).toMatch(/^user_/);
    expect(body.user).not.toHaveProperty("passwordHash");

    const rows = await db.select().from(users).where(eq(users.email, email));
    expect(rows).toHaveLength(1);
    expect(rows[0].passwordHash).toBeTruthy();
    expect(rows[0].passwordHash).not.toContain("correct horse"); // hashed

    await cleanupByEmail(email);
  });
});
