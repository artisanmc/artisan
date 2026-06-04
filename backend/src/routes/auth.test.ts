import { afterEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../app";
import { db } from "../db/index";
import { users, userSessions } from "../db/schema";

async function cleanupByEmail(email: string) {
  await db.delete(users).where(eq(users.email, email));
}

describe("POST /api/v1/auth/signup", () => {
  test("creates a user and sets the session cookie", async () => {
    const email = `signup_${Date.now()}@example.com`;
    const res = await app.fetch(new Request("http://x/api/v1/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "correct horse battery staple", name: "Alice" }),
    }));
    expect(res.status).toBe(201);
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("artisan_user_session=");
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
    await app.fetch(new Request("http://x/api/v1/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "longenoughpw", name: "A" }),
    }));
    const res = await app.fetch(new Request("http://x/api/v1/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "anotherpwwww", name: "B" }),
    }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("email_taken");
    await cleanupByEmail(email);
  });

  test("returns 422 on weak password (<8 chars)", async () => {
    const res = await app.fetch(new Request("http://x/api/v1/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "weak@example.com", password: "short", name: "W" }),
    }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("weak_password");
  });

  test("returns 422 on invalid email", async () => {
    const res = await app.fetch(new Request("http://x/api/v1/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "noatsign", password: "longenoughpw", name: "X" }),
    }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("invalid_email");
  });

  test("returns 400 on missing fields", async () => {
    const res = await app.fetch(new Request("http://x/api/v1/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "only@example.com" }),
    }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/auth/login", () => {
  async function createTestUser(email: string, password: string): Promise<void> {
    await app.fetch(new Request("http://x/api/v1/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name: "T" }),
    }));
  }

  test("logs in with correct credentials, sets cookie", async () => {
    const email = `login_${Date.now()}@example.com`;
    await createTestUser(email, "longenoughpw");
    const res = await app.fetch(new Request("http://x/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "longenoughpw" }),
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie") ?? "").toContain("artisan_user_session=");
    expect((await res.json()).user.email).toBe(email);
    await cleanupByEmail(email);
  });

  test("returns 401 on wrong password", async () => {
    const email = `wpw_${Date.now()}@example.com`;
    await createTestUser(email, "longenoughpw");
    const res = await app.fetch(new Request("http://x/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "wrongpw1234" }),
    }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("invalid_credentials");
    await cleanupByEmail(email);
  });

  test("returns 401 on unknown email", async () => {
    const res = await app.fetch(new Request("http://x/api/v1/auth/login", {
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
    const res = await app.fetch(new Request("http://x/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "whatever1234" }),
    }));
    expect(res.status).toBe(401);
    await cleanupByEmail(email);
  });
});

describe("POST /api/v1/auth/logout", () => {
  test("destroys session and clears cookie", async () => {
    const email = `lo_${Date.now()}@example.com`;
    await app.fetch(new Request("http://x/api/v1/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "longenoughpw", name: "Lo" }),
    }));
    const loginRes = await app.fetch(new Request("http://x/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "longenoughpw" }),
    }));
    const cookieRaw = loginRes.headers.get("Set-Cookie") ?? "";
    const sessionId = /artisan_user_session=([^;]+)/.exec(cookieRaw)?.[1] ?? "";
    expect(sessionId).toBeTruthy();

    const res = await app.fetch(new Request("http://x/api/v1/auth/logout", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    }));
    expect(res.status).toBe(204);
    expect(res.headers.get("Set-Cookie") ?? "").toMatch(/artisan_user_session=;.*Max-Age=0|artisan_user_session=;.*expires=/i);

    const remain = await db.select().from(userSessions).where(eq(userSessions.id, sessionId));
    expect(remain).toHaveLength(0);
    await cleanupByEmail(email);
  });

  test("returns 204 even without cookie (idempotent)", async () => {
    const res = await app.fetch(new Request("http://x/api/v1/auth/logout", { method: "POST" }));
    expect(res.status).toBe(204);
  });
});

describe("GET /api/v1/auth/me", () => {
  test("returns the user when cookie is valid", async () => {
    const email = `me_${Date.now()}@example.com`;
    await app.fetch(new Request("http://x/api/v1/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "longenoughpw", name: "Me" }),
    }));
    const loginRes = await app.fetch(new Request("http://x/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "longenoughpw" }),
    }));
    const sessionId = /artisan_user_session=([^;]+)/.exec(loginRes.headers.get("Set-Cookie") ?? "")?.[1] ?? "";

    const res = await app.fetch(new Request("http://x/api/v1/auth/me", {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).user.email).toBe(email);
    await cleanupByEmail(email);
  });

  test("returns 401 without cookie", async () => {
    const res = await app.fetch(new Request("http://x/api/v1/auth/me"));
    expect(res.status).toBe(401);
  });

  test("returns 401 with bogus cookie", async () => {
    const res = await app.fetch(new Request("http://x/api/v1/auth/me", {
      headers: { Cookie: "artisan_user_session=does-not-exist" },
    }));
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/v1/auth/me — editor_language sync", () => {
  async function seedAuthedUser(): Promise<{ sessionId: string; userId: string; email: string }> {
    const email = `patch_me_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
    const signupRes = await app.fetch(new Request("http://x/api/v1/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "longenoughpw", name: "PatchMe" }),
    }));
    const signupBody = await signupRes.json() as { user: { id: string } };
    const userId = signupBody.user.id;
    const loginRes = await app.fetch(new Request("http://x/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "longenoughpw" }),
    }));
    const sessionId = /artisan_user_session=([^;]+)/.exec(loginRes.headers.get("Set-Cookie") ?? "")?.[1] ?? "";
    return { sessionId, userId, email };
  }

  test("updates the user's editor_language", async () => {
    const { sessionId, userId, email } = await seedAuthedUser();

    const res = await app.fetch(new Request("http://x/api/v1/auth/me", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Cookie": `artisan_user_session=${sessionId}`,
      },
      body: JSON.stringify({ editor_language: "fr" }),
    }));

    expect(res.status).toBe(200);
    const body = await res.json() as { user: { editorLanguage: string | null } };
    expect(body.user.editorLanguage).toBe("fr");

    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row.editorLanguage).toBe("fr");

    await cleanupByEmail(email);
  });

  test("returns 401 without a session cookie", async () => {
    const res = await app.fetch(new Request("http://x/api/v1/auth/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ editor_language: "fr" }),
    }));
    expect(res.status).toBe(401);
  });

  test("accepts null to clear the preference", async () => {
    const { sessionId, email } = await seedAuthedUser();

    // First set a language
    await app.fetch(new Request("http://x/api/v1/auth/me", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Cookie": `artisan_user_session=${sessionId}`,
      },
      body: JSON.stringify({ editor_language: "en" }),
    }));

    // Then clear it
    const res = await app.fetch(new Request("http://x/api/v1/auth/me", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Cookie": `artisan_user_session=${sessionId}`,
      },
      body: JSON.stringify({ editor_language: null }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { user: { editorLanguage: string | null } };
    expect(body.user.editorLanguage).toBe(null);

    await cleanupByEmail(email);
  });

  test("PATCH /me with theme: 'light' persists and returns theme", async () => {
    const { sessionId, email } = await seedAuthedUser();
    const res = await app.fetch(new Request("http://x/api/v1/auth/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Cookie": `artisan_user_session=${sessionId}` },
      body: JSON.stringify({ theme: "light" }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { user: { theme: string | null } };
    expect(body.user.theme).toBe("light");
    await cleanupByEmail(email);
  });

  test("PATCH /me with theme: 'dark' persists and returns theme", async () => {
    const { sessionId, email } = await seedAuthedUser();
    const res = await app.fetch(new Request("http://x/api/v1/auth/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Cookie": `artisan_user_session=${sessionId}` },
      body: JSON.stringify({ theme: "dark" }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { user: { theme: string | null } };
    expect(body.user.theme).toBe("dark");
    await cleanupByEmail(email);
  });

  test("PATCH /me with theme: null clears theme", async () => {
    const { sessionId, email } = await seedAuthedUser();
    const res = await app.fetch(new Request("http://x/api/v1/auth/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Cookie": `artisan_user_session=${sessionId}` },
      body: JSON.stringify({ theme: null }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { user: { theme: string | null } };
    expect(body.user.theme).toBeNull();
    await cleanupByEmail(email);
  });

  test("PATCH /me with theme: 'invalid' returns 422", async () => {
    const { sessionId, email } = await seedAuthedUser();
    const res = await app.fetch(new Request("http://x/api/v1/auth/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Cookie": `artisan_user_session=${sessionId}` },
      body: JSON.stringify({ theme: "invalid" }),
    }));
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("invalid_theme");
    await cleanupByEmail(email);
  });

  test("GET /me includes theme field", async () => {
    const { sessionId, email } = await seedAuthedUser();
    const res = await app.fetch(new Request("http://x/api/v1/auth/me", {
      headers: { "Cookie": `artisan_user_session=${sessionId}` },
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { user: Record<string, unknown> };
    expect("theme" in body.user).toBe(true);
    await cleanupByEmail(email);
  });
});
