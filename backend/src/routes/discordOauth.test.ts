import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { app } from "../app";
import { createDiscordOauthRouter } from "./discordOauth";
import { db } from "../db/index";
import { users as usersTable, oauthAccounts as discordTable, userSessions } from "../db/schema";

const savedEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  savedEnv.CID = process.env.DISCORD_CLIENT_ID;
  savedEnv.CSECRET = process.env.DISCORD_CLIENT_SECRET;
  savedEnv.REDIR = process.env.DISCORD_REDIRECT_URI;
  process.env.DISCORD_CLIENT_ID = "test_cid";
  process.env.DISCORD_CLIENT_SECRET = "test_csec";
  process.env.DISCORD_REDIRECT_URI = "http://x/api/v1/auth/discord/callback";
});
afterAll(() => {
  process.env.DISCORD_CLIENT_ID = savedEnv.CID;
  process.env.DISCORD_CLIENT_SECRET = savedEnv.CSECRET;
  process.env.DISCORD_REDIRECT_URI = savedEnv.REDIR;
});

describe("GET /api/v1/auth/discord/start", () => {
  test("redirects to Discord with state cookie set", async () => {
    const res = await app.fetch(new Request("http://x/api/v1/auth/discord/start"), { redirect: "manual" } as RequestInit);
    expect(res.status).toBe(302);
    const location = res.headers.get("Location") ?? "";
    expect(location).toContain("https://discord.com/api/oauth2/authorize");
    expect(location).toContain("client_id=test_cid");
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("artisan_oauth_state=");
    expect(setCookie).toContain("HttpOnly");
  });

  test("returns 500 when DISCORD_CLIENT_ID is not configured", async () => {
    delete process.env.DISCORD_CLIENT_ID;
    try {
      const res = await app.fetch(new Request("http://x/api/v1/auth/discord/start"));
      expect(res.status).toBe(500);
    } finally {
      process.env.DISCORD_CLIENT_ID = "test_cid";
    }
  });
});

describe("GET /api/v1/auth/discord/callback (invalid state)", () => {
  test("400 when state cookie missing", async () => {
    const res = await app.fetch(new Request("http://x/api/v1/auth/discord/callback?code=c&state=s"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_state");
  });

  test("400 when state mismatches", async () => {
    const res = await app.fetch(new Request("http://x/api/v1/auth/discord/callback?code=c&state=mismatch", {
      headers: { Cookie: "artisan_oauth_state=actual" },
    }));
    expect(res.status).toBe(400);
  });

  test("400 when code is missing", async () => {
    const res = await app.fetch(new Request("http://x/api/v1/auth/discord/callback?state=s", {
      headers: { Cookie: "artisan_oauth_state=s" },
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("missing_code");
  });
});

function buildAppWith(fetchImpl: typeof fetch) {
  const a = new Hono();
  a.route("/api/v1/auth/discord", createDiscordOauthRouter(fetchImpl));
  return a;
}

describe("GET /api/v1/auth/discord/callback (happy path)", () => {
  test("creates user, links Discord account, sets session cookie", async () => {
    const discordUserId = `discord_${Date.now()}`;
    const email = `oa_${Date.now()}@example.com`;
    const mockFetch: typeof fetch = async (input: Request | string | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.includes("oauth2/token")) {
        return new Response(JSON.stringify({
          access_token: "AT", refresh_token: "RT", expires_in: 604800, scope: "identify email",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("users/@me")) {
        return new Response(JSON.stringify({
          id: discordUserId, username: "alice", email, verified: true, avatar: null,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error("Unexpected fetch in test: " + url);
    };

    const testApp = buildAppWith(mockFetch);
    const res = await testApp.fetch(new Request("http://x/api/v1/auth/discord/callback?code=c&state=s", {
      headers: { Cookie: "artisan_oauth_state=s" },
    }));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location") ?? "").toContain("/account");
    expect(res.headers.get("Set-Cookie") ?? "").toContain("artisan_user_session=");

    const userRow = await db.select().from(usersTable).where(eq(usersTable.email, email));
    expect(userRow).toHaveLength(1);
    expect(userRow[0].passwordHash).toBeNull();
    expect(userRow[0].name).toBe("alice");
    const linkRow = await db.select().from(discordTable).where(eq(discordTable.subject, discordUserId));
    expect(linkRow).toHaveLength(1);

    await db.delete(userSessions).where(eq(userSessions.userId, userRow[0].id));
    await db.delete(discordTable).where(eq(discordTable.subject, discordUserId));
    await db.delete(usersTable).where(eq(usersTable.id, userRow[0].id));
  });

  test("re-logs existing Discord-linked user without creating duplicate", async () => {
    const discordUserId = `repeat_${Date.now()}`;
    const email = `repeat_${Date.now()}@example.com`;
    const mockFetch: typeof fetch = async (input) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.includes("oauth2/token")) return new Response(JSON.stringify({
        access_token: "AT", refresh_token: "RT", expires_in: 604800, scope: "identify email",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ id: discordUserId, username: "bob", email, verified: true, avatar: null }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const testApp = buildAppWith(mockFetch);
    await testApp.fetch(new Request("http://x/api/v1/auth/discord/callback?code=c&state=s", {
      headers: { Cookie: "artisan_oauth_state=s" },
    }));
    await testApp.fetch(new Request("http://x/api/v1/auth/discord/callback?code=c2&state=s", {
      headers: { Cookie: "artisan_oauth_state=s" },
    }));

    const userRows = await db.select().from(usersTable).where(eq(usersTable.email, email));
    expect(userRows).toHaveLength(1);
    const linkRows = await db.select().from(discordTable).where(eq(discordTable.subject, discordUserId));
    expect(linkRows).toHaveLength(1);

    await db.delete(userSessions).where(eq(userSessions.userId, userRows[0].id));
    await db.delete(discordTable).where(eq(discordTable.subject, discordUserId));
    await db.delete(usersTable).where(eq(usersTable.id, userRows[0].id));
  });

  test("links Discord to existing email-only user", async () => {
    const email = `link_${Date.now()}@example.com`;
    await app.fetch(new Request("http://x/api/v1/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "longenoughpw", name: "Carol" }),
    }));
    const discordUserId = `link_${Date.now()}`;
    const mockFetch: typeof fetch = async (input) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.includes("oauth2/token")) return new Response(JSON.stringify({
        access_token: "AT", refresh_token: "RT", expires_in: 604800, scope: "identify email",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ id: discordUserId, username: "carol-discord", email, verified: true, avatar: null }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const tmpApp = buildAppWith(mockFetch);
    await tmpApp.fetch(new Request("http://x/api/v1/auth/discord/callback?code=c&state=s", {
      headers: { Cookie: "artisan_oauth_state=s" },
    }));

    const userRows = await db.select().from(usersTable).where(eq(usersTable.email, email));
    expect(userRows).toHaveLength(1);
    const linkRows = await db.select().from(discordTable).where(eq(discordTable.subject, discordUserId));
    expect(linkRows).toHaveLength(1);
    expect(linkRows[0].userId).toBe(userRows[0].id);

    await db.delete(userSessions).where(eq(userSessions.userId, userRows[0].id));
    await db.delete(discordTable).where(eq(discordTable.subject, discordUserId));
    await db.delete(usersTable).where(eq(usersTable.id, userRows[0].id));
  });
});

test("unverified Discord email cannot attach to an existing account", async () => {
  const email = `${crypto.randomUUID()}@gmail.com`;
  await app.request("http://x/api/v1/auth/signup", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "longenoughpw", name: "Original" }),
  });
  const fakeFetch = (async (input: Request | URL | string) => {
    const url = input instanceof Request ? input.url : input.toString();
    return Response.json(url.includes("oauth2/token") ? { access_token: "AT" } : {
      id: crypto.randomUUID(), username: "unverified", email, verified: false,
    });
  }) as typeof fetch;
  const response = await buildAppWith(fakeFetch).request("http://x/api/v1/auth/discord/callback?code=c&state=s", {
    headers: { Cookie: "artisan_oauth_state=s" },
  });
  expect(response.status).toBe(422);
  expect(response.headers.get("set-cookie")).not.toContain("artisan_user_session=");
});
