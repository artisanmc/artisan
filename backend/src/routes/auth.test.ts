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

  test("returns 409 when email already taken", async () => {
    const email = `dup_${Date.now()}@example.com`;
    await app.fetch(new Request("http://x/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "longenoughpw", name: "A" }),
    }));
    const res = await app.fetch(new Request("http://x/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "anotherpwwww", name: "B" }),
    }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("email_taken");
    await cleanupByEmail(email);
  });

  test("returns 422 on weak password (<8 chars)", async () => {
    const res = await app.fetch(new Request("http://x/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "weak@example.com", password: "short", name: "W" }),
    }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("weak_password");
  });

  test("returns 422 on invalid email", async () => {
    const res = await app.fetch(new Request("http://x/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "noatsign", password: "longenoughpw", name: "X" }),
    }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("invalid_email");
  });

  test("returns 400 on missing fields", async () => {
    const res = await app.fetch(new Request("http://x/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "only@example.com" }),
    }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  async function createTestUser(email: string, password: string): Promise<void> {
    await app.fetch(new Request("http://x/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name: "T" }),
    }));
  }

  test("logs in with correct credentials, sets cookie", async () => {
    const email = `login_${Date.now()}@example.com`;
    await createTestUser(email, "longenoughpw");
    const res = await app.fetch(new Request("http://x/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "longenoughpw" }),
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie") ?? "").toContain("ifz_user_session=");
    expect((await res.json()).user.email).toBe(email);
    await cleanupByEmail(email);
  });

  test("returns 401 on wrong password", async () => {
    const email = `wpw_${Date.now()}@example.com`;
    await createTestUser(email, "longenoughpw");
    const res = await app.fetch(new Request("http://x/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "wrongpw1234" }),
    }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("invalid_credentials");
    await cleanupByEmail(email);
  });

  test("returns 401 on unknown email", async () => {
    const res = await app.fetch(new Request("http://x/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com", password: "whatever1234" }),
    }));
    expect(res.status).toBe(401);
  });

  test("returns 401 for Discord-only user (no password)", async () => {
    const email = `discord_only_${Date.now()}@example.com`;
    const id = "user_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const now = new Date();
    await db.insert(users).values({
      id, email, name: "DOnly", passwordHash: null,
      avatarUrl: null, createdAt: now, updatedAt: now,
    });
    const res = await app.fetch(new Request("http://x/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "whatever1234" }),
    }));
    expect(res.status).toBe(401);
    await cleanupByEmail(email);
  });
});
