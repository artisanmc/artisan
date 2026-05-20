import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { app } from "../app";

const savedEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  savedEnv.CID = process.env.DISCORD_CLIENT_ID;
  savedEnv.CSECRET = process.env.DISCORD_CLIENT_SECRET;
  savedEnv.REDIR = process.env.DISCORD_REDIRECT_URI;
  process.env.DISCORD_CLIENT_ID = "test_cid";
  process.env.DISCORD_CLIENT_SECRET = "test_csec";
  process.env.DISCORD_REDIRECT_URI = "http://x/api/auth/discord/callback";
});
afterAll(() => {
  process.env.DISCORD_CLIENT_ID = savedEnv.CID;
  process.env.DISCORD_CLIENT_SECRET = savedEnv.CSECRET;
  process.env.DISCORD_REDIRECT_URI = savedEnv.REDIR;
});

describe("GET /api/auth/discord/start", () => {
  test("redirects to Discord with state cookie set", async () => {
    const res = await app.fetch(new Request("http://x/api/auth/discord/start"), { redirect: "manual" } as RequestInit);
    expect(res.status).toBe(302);
    const location = res.headers.get("Location") ?? "";
    expect(location).toContain("https://discord.com/api/oauth2/authorize");
    expect(location).toContain("client_id=test_cid");
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("ifz_oauth_state=");
    expect(setCookie).toContain("HttpOnly");
  });

  test("returns 500 when DISCORD_CLIENT_ID is not configured", async () => {
    delete process.env.DISCORD_CLIENT_ID;
    try {
      const res = await app.fetch(new Request("http://x/api/auth/discord/start"));
      expect(res.status).toBe(500);
    } finally {
      process.env.DISCORD_CLIENT_ID = "test_cid";
    }
  });
});

describe("GET /api/auth/discord/callback (invalid state)", () => {
  test("400 when state cookie missing", async () => {
    const res = await app.fetch(new Request("http://x/api/auth/discord/callback?code=c&state=s"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_state");
  });

  test("400 when state mismatches", async () => {
    const res = await app.fetch(new Request("http://x/api/auth/discord/callback?code=c&state=mismatch", {
      headers: { Cookie: "ifz_oauth_state=actual" },
    }));
    expect(res.status).toBe(400);
  });

  test("400 when code is missing", async () => {
    const res = await app.fetch(new Request("http://x/api/auth/discord/callback?state=s", {
      headers: { Cookie: "ifz_oauth_state=s" },
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("missing_code");
  });
});
