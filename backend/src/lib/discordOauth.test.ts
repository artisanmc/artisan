import { describe, expect, test } from "bun:test";
import { buildAuthorizeUrl, exchangeCode, fetchDiscordUser } from "./discordOauth";

function mockFetch(handlers: Record<string, (req: Request) => Response | Promise<Response>>): typeof fetch {
  return (async (input: Request | string | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input.toString(), init);
    const url = new URL(req.url);
    const key = url.origin + url.pathname;
    const h = handlers[key];
    if (!h) throw new Error(`Unexpected fetch: ${key}`);
    return h(req);
  }) as typeof fetch;
}

describe("buildAuthorizeUrl", () => {
  test("includes client_id, redirect_uri, scope=identify+email, state", () => {
    const url = buildAuthorizeUrl({
      clientId: "abc123",
      redirectUri: "http://localhost:3001/api/auth/discord/callback",
      state: "csrf-token-xyz",
    });
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://discord.com");
    expect(parsed.pathname).toBe("/api/oauth2/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("abc123");
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://localhost:3001/api/auth/discord/callback");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("scope")).toBe("identify email");
    expect(parsed.searchParams.get("state")).toBe("csrf-token-xyz");
    expect(parsed.searchParams.get("prompt")).toBe("none");
  });
});

describe("exchangeCode", () => {
  test("returns access_token from Discord", async () => {
    const result = await exchangeCode({
      code: "the-code",
      clientId: "cid",
      clientSecret: "csec",
      redirectUri: "http://x/cb",
    }, mockFetch({
      "https://discord.com/api/oauth2/token": async (req) => {
        const body = await req.text();
        expect(body).toContain("code=the-code");
        expect(body).toContain("grant_type=authorization_code");
        expect(body).toContain("client_id=cid");
        return new Response(
          JSON.stringify({ access_token: "AT", refresh_token: "RT", expires_in: 604800, scope: "identify email" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    }));
    expect(result.accessToken).toBe("AT");
    expect(result.refreshToken).toBe("RT");
    expect(result.expiresIn).toBe(604800);
  });

  test("throws on Discord error response", async () => {
    expect(exchangeCode({
      code: "bad", clientId: "cid", clientSecret: "csec", redirectUri: "http://x/cb",
    }, mockFetch({
      "https://discord.com/api/oauth2/token": () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    }))).rejects.toThrow(/invalid_grant/);
  });
});

describe("fetchDiscordUser", () => {
  test("returns id, username, email from Discord", async () => {
    const user = await fetchDiscordUser("AT", mockFetch({
      "https://discord.com/api/users/@me": (req) => {
        expect(req.headers.get("Authorization")).toBe("Bearer AT");
        return new Response(
          JSON.stringify({ id: "123456789", username: "alice", email: "alice@example.com", avatar: "av_hash" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    }));
    expect(user.discordUserId).toBe("123456789");
    expect(user.username).toBe("alice");
    expect(user.email).toBe("alice@example.com");
    expect(user.avatarUrl).toContain("av_hash");
  });
});
