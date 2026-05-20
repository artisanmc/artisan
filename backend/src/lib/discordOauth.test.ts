import { describe, expect, test } from "bun:test";
import { buildAuthorizeUrl } from "./discordOauth";

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
