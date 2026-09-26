// backend/src/routes/invites.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { db } from "../db/index";
import { memberships, networkInvites, networks, userSessions, users } from "../db/schema";
import { invitesRouter } from "./invites";
import { userAuth } from "../middleware/userAuth";
import { createSession } from "../lib/sessionManager";
import { createNetwork } from "../lib/networkManager";
import { createInvite, getInviteByCode, revokeInvite } from "../lib/inviteStorage";
import { addMembership } from "../lib/membershipManager";
import { eq } from "drizzle-orm";

async function clearAll() {
  await db.delete(networkInvites);
  await db.delete(memberships);
  await db.delete(networks);
  await db.delete(userSessions);
  await db.delete(users);
}

async function seedUser(id = "u1") {
  await db.insert(users).values({
    id, email: `${id}@a.b`, name: id, passwordHash: null, avatarUrl: null,
    createdAt: new Date(), updatedAt: new Date(),
  });
  const session = await createSession(id);
  return { userId: id, sessionId: session.id };
}

function makeApp() {
  const app = new Hono();
  app.use("/api/v1/invites/*", userAuth());
  app.route("/api/v1/invites", invitesRouter);
  return app;
}

describe("invitesRouter", () => {
  beforeEach(clearAll);

  test("GET /:code — no auth needed — returns status/network_name/role", async () => {
    const net = await createNetwork("Acme");
    const { userId } = await seedUser("owner1");
    const invite = await createInvite({ networkId: net.id, createdBy: userId, role: "member" });
    const app = makeApp();

    const res = await app.request(`/api/v1/invites/${invite.code}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "valid", network_name: "Acme", role: "member" });
  });

  test("GET /:code — 404 for unknown code", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/invites/NOPECODE");
    expect(res.status).toBe(404);
  });

  test("GET /:code — reports revoked status", async () => {
    const net = await createNetwork("Acme");
    const { userId } = await seedUser("owner1");
    const invite = await createInvite({ networkId: net.id, createdBy: userId });
    await revokeInvite(invite.id);
    const app = makeApp();
    const res = await app.request(`/api/v1/invites/${invite.code}`);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("revoked");
  });

  test("POST /:code/accept — 401 without cookie", async () => {
    const net = await createNetwork("Acme");
    const { userId } = await seedUser("owner1");
    const invite = await createInvite({ networkId: net.id, createdBy: userId });
    const app = makeApp();
    const res = await app.request(`/api/v1/invites/${invite.code}/accept`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  test("POST /:code/accept — 200 happy path creates membership", async () => {
    const net = await createNetwork("Acme");
    const { userId: ownerId } = await seedUser("owner1");
    const invite = await createInvite({ networkId: net.id, createdBy: ownerId, role: "member" });
    const { sessionId } = await seedUser("newbie");
    const app = makeApp();

    const res = await app.request(`/api/v1/invites/${invite.code}/accept`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ network_id: net.id, already_member: false });

    const memberRows = await db.select().from(memberships).where(eq(memberships.userId, "newbie"));
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0]!.role).toBe("member");
  });

  test("POST /:code/accept — 409 when the Free collaborator limit is reached without using the invite", async () => {
    const net = await createNetwork("Full team");
    const { userId: ownerId } = await seedUser("owner1");
    await addMembership(ownerId, net.id, "owner");
    for (const id of ["member1", "member2"]) {
      await seedUser(id);
      await addMembership(id, net.id, "member");
    }
    const { sessionId } = await seedUser("third");
    const invite = await createInvite({ networkId: net.id, createdBy: ownerId, maxUses: 1 });
    const res = await makeApp().request(`/api/v1/invites/${invite.code}/accept`, { method: "POST", headers: { Cookie: `artisan_user_session=${sessionId}` } });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("collaborator_limit_reached");
    expect((await getInviteByCode(invite.code))?.usedCount).toBe(0);
  });

  test("POST /:code/accept — already_member true, no error, no duplicate row", async () => {
    const net = await createNetwork("Acme");
    const { userId: ownerId } = await seedUser("owner1");
    const invite = await createInvite({ networkId: net.id, createdBy: ownerId });
    const { sessionId } = await seedUser("newbie");
    const app = makeApp();

    await app.request(`/api/v1/invites/${invite.code}/accept`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    const res2 = await app.request(`/api/v1/invites/${invite.code}/accept`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res2.status).toBe(200);
    expect((await res2.json())).toEqual({ network_id: net.id, already_member: true });

    const memberRows = await db.select().from(memberships).where(eq(memberships.userId, "newbie"));
    expect(memberRows).toHaveLength(1);
  });

  test("POST /:code/accept — 410 for revoked invite", async () => {
    const net = await createNetwork("Acme");
    const { userId: ownerId } = await seedUser("owner1");
    const invite = await createInvite({ networkId: net.id, createdBy: ownerId });
    await revokeInvite(invite.id);
    const { sessionId } = await seedUser("newbie");
    const app = makeApp();

    const res = await app.request(`/api/v1/invites/${invite.code}/accept`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(410);
    expect((await res.json()).error).toBe("revoked");
  });

  test("POST /:code/accept — 404 for unknown code", async () => {
    const { sessionId } = await seedUser("newbie");
    const app = makeApp();
    const res = await app.request("/api/v1/invites/NOPECODE/accept", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(404);
  });

  test("POST /:code/accept — maxUses=1 race: second distinct user gets 410 exhausted, no membership", async () => {
    const net = await createNetwork("Acme");
    const { userId: ownerId } = await seedUser("owner1");
    const invite = await createInvite({ networkId: net.id, createdBy: ownerId, maxUses: 1 });
    const { sessionId: s1 } = await seedUser("first");
    const { sessionId: s2 } = await seedUser("second");
    const app = makeApp();

    const res1 = await app.request(`/api/v1/invites/${invite.code}/accept`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${s1}` },
    });
    expect(res1.status).toBe(200);

    const res2 = await app.request(`/api/v1/invites/${invite.code}/accept`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${s2}` },
    });
    expect(res2.status).toBe(410);
    expect((await res2.json()).error).toBe("exhausted");

    const memberRows = await db.select().from(memberships).where(eq(memberships.userId, "second"));
    expect(memberRows).toHaveLength(0);
  });
});
