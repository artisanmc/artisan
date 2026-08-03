import { afterEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../app";
import { db } from "../db/index";
import { passwordResetTokens, users, userSessions } from "../db/schema";
import { __setMailerForTests, type Mailer, type MailMessage } from "../lib/mail/mailer";
import { createResetToken } from "../lib/passwordResetStorage";

function fakeMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    enabled: true,
    sent,
    async send(msg: MailMessage) {
      sent.push(msg);
    },
  };
}

async function cleanupByEmail(email: string) {
  await db.delete(users).where(eq(users.email, email));
}

async function signup(email: string, password = "longenoughpw"): Promise<string> {
  const res = await app.fetch(new Request("http://x/api/v1/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: "T" }),
  }));
  const body = await res.json() as { user: { id: string } };
  return body.user.id;
}

function post(path: string, body: unknown): Promise<Response> {
  return app.fetch(new Request(`http://x${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

async function login(email: string, password: string): Promise<number> {
  const res = await post("/api/v1/auth/login", { email, password });
  return res.status;
}

afterEach(() => {
  __setMailerForTests(null);
});

describe("POST /api/v1/auth/forgot-password", () => {
  test("returns 204 and emails a reset link for a known account", async () => {
    const email = `forgot_${Date.now()}@example.com`;
    const userId = await signup(email);
    // Installed after signup so the welcome email isn't counted here.
    const mailer = fakeMailer();
    __setMailerForTests(mailer);

    const res = await post("/api/v1/auth/forgot-password", { email });
    expect(res.status).toBe(204);
    await new Promise((r) => setTimeout(r, 0));

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe(email);
    const match = mailer.sent[0].text.match(/reset-password\?token=([A-Za-z0-9]+)/);
    expect(match).not.toBeNull();

    const rows = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, userId));
    expect(rows).toHaveLength(1);
    // Only the hash is persisted — the plaintext token lives in the email only.
    expect(rows[0].tokenHash).not.toBe(match![1]);

    await cleanupByEmail(email);
  });

  test("returns 204 and sends nothing for an unknown email (no enumeration)", async () => {
    const mailer = fakeMailer();
    __setMailerForTests(mailer);
    const res = await post("/api/v1/auth/forgot-password", {
      email: `ghost_${Date.now()}@example.com`,
    });
    expect(res.status).toBe(204);
    await new Promise((r) => setTimeout(r, 0));
    expect(mailer.sent).toHaveLength(0);
  });

  test("normalizes the email before lookup", async () => {
    const email = `case_${Date.now()}@example.com`;
    await signup(email);
    const mailer = fakeMailer();
    __setMailerForTests(mailer);

    const res = await post("/api/v1/auth/forgot-password", { email: `  ${email.toUpperCase()} ` });
    expect(res.status).toBe(204);
    await new Promise((r) => setTimeout(r, 0));
    expect(mailer.sent).toHaveLength(1);

    await cleanupByEmail(email);
  });

  test("returns 400 on missing email", async () => {
    const res = await post("/api/v1/auth/forgot-password", {});
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/auth/reset-password", () => {
  test("sets the new password, kills sessions, and burns the token", async () => {
    const email = `reset_${Date.now()}@example.com`;
    const userId = await signup(email);
    // signup opened a session — a reset must invalidate it.
    expect(await db.select().from(userSessions).where(eq(userSessions.userId, userId)))
      .not.toHaveLength(0);

    const token = await createResetToken(userId);
    const res = await post("/api/v1/auth/reset-password", { token, password: "brandnewpw123" });
    expect(res.status).toBe(204);

    expect(await login(email, "brandnewpw123")).toBe(200);
    expect(await login(email, "longenoughpw")).toBe(401);

    const rows = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, userId));
    expect(rows[0].usedAt).not.toBeNull();

    await cleanupByEmail(email);
  });

  test("refuses a replayed token", async () => {
    const email = `replay_${Date.now()}@example.com`;
    const userId = await signup(email);
    const token = await createResetToken(userId);

    expect((await post("/api/v1/auth/reset-password", { token, password: "firstnewpw123" })).status)
      .toBe(204);
    const second = await post("/api/v1/auth/reset-password", { token, password: "secondnewpw123" });
    expect(second.status).toBe(400);
    expect((await second.json()).error).toBe("invalid_token");
    expect(await login(email, "firstnewpw123")).toBe(200);

    await cleanupByEmail(email);
  });

  test("refuses an expired token", async () => {
    const email = `expired_${Date.now()}@example.com`;
    const userId = await signup(email);
    const token = await createResetToken(userId);
    await db
      .update(passwordResetTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(passwordResetTokens.userId, userId));

    const res = await post("/api/v1/auth/reset-password", { token, password: "brandnewpw123" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_token");

    await cleanupByEmail(email);
  });

  test("refuses an unknown token", async () => {
    const res = await post("/api/v1/auth/reset-password", {
      token: "totallyunknowntoken",
      password: "brandnewpw123",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_token");
  });

  test("returns 422 on weak password without burning the token", async () => {
    const email = `weak_${Date.now()}@example.com`;
    const userId = await signup(email);
    const token = await createResetToken(userId);

    const res = await post("/api/v1/auth/reset-password", { token, password: "short" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("weak_password");

    // The token survives a rejected attempt — the user can retry from the same link.
    expect((await post("/api/v1/auth/reset-password", { token, password: "brandnewpw123" })).status)
      .toBe(204);

    await cleanupByEmail(email);
  });

  test("sets a password on a Discord-only account", async () => {
    const email = `donly_${Date.now()}@example.com`;
    const id = "user_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const now = new Date();
    await db.insert(users).values({
      id, email, name: "DOnly", passwordHash: null,
      avatarUrl: null, createdAt: now, updatedAt: now,
    });

    const token = await createResetToken(id);
    expect((await post("/api/v1/auth/reset-password", { token, password: "brandnewpw123" })).status)
      .toBe(204);
    expect(await login(email, "brandnewpw123")).toBe(200);

    await cleanupByEmail(email);
  });

  test("returns 400 on missing fields", async () => {
    expect((await post("/api/v1/auth/reset-password", { token: "x" })).status).toBe(400);
  });
});
