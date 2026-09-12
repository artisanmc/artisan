import { afterEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../app";
import { db } from "../db";
import {
  accountDeletionTokens,
  appSettings,
  assistantConversations,
  memberships,
  networkBilling,
  networkInvites,
  networks,
  networkTransfers,
  serverKeys,
  users,
} from "../db/schema";
import { createSession } from "../lib/sessionManager";
import { __setMailerForTests, type MailMessage } from "../lib/mail/mailer";

const ids: string[] = [];
afterEach(async () => {
  __setMailerForTests(null);
  for (const id of ids.splice(0)) await db.delete(users).where(eq(users.id, id));
});

async function seed() {
  const id = crypto.randomUUID();
  ids.push(id);
  await db
    .insert(users)
    .values({
      id,
      email: `${id}@example.com`,
      name: "Alice",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  const session = await createSession(id);
  return { id, cookie: `artisan_user_session=${session.id}` };
}

function request(path: string, cookie = "", body?: unknown, method = "POST") {
  return app.fetch(
    new Request(`http://x/api/v1/auth/${path}`, {
      method,
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

test("email confirmation deletes only after an explicit POST and revokes every session", async () => {
  const user = await seed();
  const second = await createSession(user.id);
  const sent: MailMessage[] = [];
  __setMailerForTests({
    enabled: true,
    async send(message) {
      sent.push(message);
    },
  });
  expect((await request("delete-account/request", user.cookie)).status).toBe(204);
  expect(sent).toHaveLength(1);
  expect(sent[0].to).toBe(`${user.id}@example.com`);
  const url = new URL(sent[0].text.match(/https?:\/\/\S+/)![0]);
  const token = new URLSearchParams(url.hash.slice(1)).get("token");
  expect(token).toBeTruthy();
  expect((await request("delete-account", "", undefined, "GET")).status).toBe(404);
  expect((await request("me", user.cookie, undefined, "GET")).status).toBe(200);
  expect((await request("delete-account", "", { token })).status).toBe(204);
  for (const cookie of [user.cookie, `artisan_user_session=${second.id}`]) {
    expect((await request("me", cookie, undefined, "GET")).status).toBe(401);
  }
  expect((await request("delete-account", "", { token })).status).toBe(400);
});

test("removes account records and unmanaged networks without sending any Minecraft deletion", async () => {
  const user = await seed();
  const other = await seed();
  const now = new Date();
  const own = crypto.randomUUID();
  const shared = crypto.randomUUID();
  await db
    .insert(networks)
    .values([own, shared].map((id) => ({ id, name: id, createdAt: now, updatedAt: now })));
  try {
    await db.insert(memberships).values([
      { id: crypto.randomUUID(), userId: user.id, networkId: own, role: "owner", createdAt: now },
      {
        id: crypto.randomUUID(),
        userId: user.id,
        networkId: shared,
        role: "member",
        createdAt: now,
      },
      {
        id: crypto.randomUUID(),
        userId: other.id,
        networkId: shared,
        role: "owner",
        createdAt: now,
      },
    ]);
    const key = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: key, networkId: own, createdAt: now });
    const { registerConn, connToServerId } = await import("../ws/hub");
    const messages: string[] = [];
    registerConn(key, (msg) => messages.push(msg));
    connToServerId.set(key, key);
    await db
      .insert(networkInvites)
      .values({
        id: crypto.randomUUID(),
        networkId: shared,
        code: crypto.randomUUID(),
        createdBy: user.id,
        createdAt: now,
        expiresAt: new Date(Date.now() + 60_000),
      });
    await db
      .insert(networkTransfers)
      .values({
        token: crypto.randomUUID(),
        networkId: shared,
        initiatedByUserId: user.id,
        createdAt: now,
        expiresAt: new Date(Date.now() + 60_000),
      });
    await db
      .insert(appSettings)
      .values({ key: user.id, value: "{}", updatedAt: now, updatedBy: user.id });
    await db
      .insert(assistantConversations)
      .values({
        id: user.id,
        ownerKey: `user:${user.id}`,
        projectId: "test",
        messages: [],
        createdAt: now,
        updatedAt: now,
      });
    const sent: MailMessage[] = [];
    __setMailerForTests({
      enabled: true,
      async send(m) {
        sent.push(m);
      },
    });
    await request("delete-account/request", user.cookie);
    const token = new URLSearchParams(
      new URL(sent[0].text.match(/https?:\/\/\S+/)![0]).hash.slice(1),
    ).get("token");
    expect((await request("delete-account", "", { token })).status).toBe(204);
    expect(await db.select().from(networks).where(eq(networks.id, own))).toHaveLength(0);
    expect(await db.select().from(networks).where(eq(networks.id, shared))).toHaveLength(1);
    expect(
      await db.select().from(assistantConversations).where(eq(assistantConversations.id, user.id)),
    ).toHaveLength(0);
    expect(messages).toEqual([]);
    expect(connToServerId.has(key)).toBe(false);
    expect((await request("me", other.cookie, undefined, "GET")).status).toBe(200);
  } finally {
    await db.delete(networks).where(eq(networks.id, own));
    await db.delete(networks).where(eq(networks.id, shared));
    await db.delete(appSettings).where(eq(appSettings.key, user.id));
    await db.delete(assistantConversations).where(eq(assistantConversations.id, user.id));
  }
});

test("active subscriptions roll back deletion and leave the confirmation usable", async () => {
  const user = await seed();
  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(networks).values({ id, name: "Paid", createdAt: now, updatedAt: now });
  try {
    await db
      .insert(memberships)
      .values({ id, networkId: id, userId: user.id, role: "owner", createdAt: now });
    await db
      .insert(networkBilling)
      .values({
        networkId: id,
        stripeSubscriptionId: "sub_test",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    const { requestAccountDeletion } = await import("../lib/accountDeletion");
    const token = await requestAccountDeletion(user.id, `${user.id}@example.com`);
    expect((await request("delete-account", "", { token })).status).toBe(409);
    expect((await request("me", user.cookie, undefined, "GET")).status).toBe(200);
    await db
      .update(networkBilling)
      .set({ status: "canceled" })
      .where(eq(networkBilling.networkId, id));
    expect((await request("delete-account", "", { token })).status).toBe(204);
  } finally {
    await db.delete(networks).where(eq(networks.id, id));
  }
});

test("rejects expired, malformed, password-reset and email-changed tokens", async () => {
  const user = await seed();
  const { requestAccountDeletion } = await import("../lib/accountDeletion");
  const token = await requestAccountDeletion(user.id, `${user.id}@example.com`);
  await db
    .update(accountDeletionTokens)
    .set({ expiresAt: new Date(0), createdAt: new Date(0) })
    .where(eq(accountDeletionTokens.userId, user.id));
  const { createResetToken } = await import("../lib/passwordResetStorage");
  for (const value of [token, null, 123, {}, await createResetToken(user.id)]) {
    expect((await request("delete-account", "", { token: value })).status).toBe(400);
  }
  const fresh = await requestAccountDeletion(user.id, `${user.id}@example.com`);
  await db
    .update(users)
    .set({ email: `changed-${user.id}@example.com` })
    .where(eq(users.id, user.id));
  expect((await request("delete-account", "", { token: fresh })).status).toBe(400);
  expect((await request("me", user.cookie, undefined, "GET")).status).toBe(200);
});

test("requires authentication and reports unavailable or failing mail delivery", async () => {
  expect((await request("delete-account/request")).status).toBe(401);
  const user = await seed();
  __setMailerForTests({ enabled: false, async send() {} });
  expect((await request("delete-account/request", user.cookie)).status).toBe(503);
  __setMailerForTests({
    enabled: true,
    async send() {
      throw new Error("SMTP down");
    },
  });
  expect((await request("delete-account/request", user.cookie)).status).toBe(503);
  expect(
    await db.select().from(accountDeletionTokens).where(eq(accountDeletionTokens.userId, user.id)),
  ).toHaveLength(0);
});

test("throttles requests and only the newest link remains valid", async () => {
  const user = await seed();
  const sent: MailMessage[] = [];
  __setMailerForTests({
    enabled: true,
    async send(m) {
      sent.push(m);
    },
  });
  expect((await request("delete-account/request", user.cookie)).status).toBe(204);
  expect((await request("delete-account/request", user.cookie)).status).toBe(429);
  const first = new URLSearchParams(
    new URL(sent[0].text.match(/https?:\/\/\S+/)![0]).hash.slice(1),
  ).get("token");
  await db
    .update(accountDeletionTokens)
    .set({ createdAt: new Date(0) })
    .where(eq(accountDeletionTokens.userId, user.id));
  expect((await request("delete-account/request", user.cookie)).status).toBe(204);
  expect((await request("delete-account", "", { token: first })).status).toBe(400);
});

test("concurrent confirmation succeeds once and closes only that user's live connections", async () => {
  const user = await seed();
  const { requestAccountDeletion } = await import("../lib/accountDeletion");
  const { registerEditorConn, cleanupEditorConn } = await import("../ws/hub");
  const { issueTicket, redeemTicket } = await import("../lib/wsTickets");
  const ticket = issueTicket(user.id);
  const otherTicket = issueTicket("other");
  let closed = 0;
  registerEditorConn(user.id, new Set(), () => {}, {
    userId: user.id,
    close() {
      closed++;
    },
  });
  registerEditorConn("other", new Set(), () => {}, {
    userId: "other",
    close() {
      closed += 10;
    },
  });
  const token = await requestAccountDeletion(user.id, `${user.id}@example.com`);
  const results = await Promise.all([
    request("delete-account", "", { token }),
    request("delete-account", "", { token }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([204, 400]);
  expect(closed).toBe(1);
  expect(redeemTicket(ticket)).toBeNull();
  expect(redeemTicket(otherTicket)).toEqual({ userId: "other" });
  cleanupEditorConn("other");
});
