import { afterAll, beforeAll, expect, test } from "bun:test";
import { Hono } from "hono";
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { authRouter } from "./auth";
import { createGoogleOauthRouter } from "./googleOauth";
import { app as productionApp } from "../app";

const envKeys = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "EDITOR_URL"];
const saved = envKeys.map((key) => process.env[key]);
beforeAll(() => {
  process.env.GOOGLE_CLIENT_ID = "test-google-client";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  process.env.GOOGLE_REDIRECT_URI = "http://x/api/v1/auth/google/callback";
  process.env.EDITOR_URL = "http://editor";
});
afterAll(() => envKeys.forEach((key, i) => {
  if (saved[i] === undefined) delete process.env[key];
  else process.env[key] = saved[i];
}));

const keys = await generateKeyPair("RS256");
const untrustedKeys = await generateKeyPair("RS256");
const jwk = { ...await exportJWK(keys.publicKey), kid: "test-key", alg: "RS256" };

function setup(initial: JWTPayload = {}, signingKey = keys.privateKey) {
  let claims = initial;
  let nonce = "";
  let exchanges = 0;
  const fetchImpl = (async (input: Request | URL | string) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys: [jwk] });
    if (url !== "https://oauth2.googleapis.com/token") throw new Error(`Unexpected URL: ${url}`);
    exchanges++;
    const token = await new SignJWT({ email_verified: true, name: "Google Name", nonce, ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(typeof claims.iss === "string" ? claims.iss : "https://accounts.google.com")
      .setAudience(typeof claims.aud === "string" ? claims.aud : "test-google-client")
      .setIssuedAt().setExpirationTime(claims.exp ?? "5m").sign(signingKey);
    return Response.json({ id_token: token, access_token: "unused" });
  }) as typeof fetch;
  const app = new Hono();
  app.route("/api/v1/auth", authRouter);
  app.route("/api/v1/auth/google", createGoogleOauthRouter(fetchImpl));
  return {
    app,
    update: (next: JWTPayload) => { claims = next; },
    exchanges: () => exchanges,
    async start(next?: string) {
      const response = await app.request(`http://x/api/v1/auth/google/start${next ? `?${new URLSearchParams({ next })}` : ""}`);
      expect(response.status).toBe(302);
      const location = new URL(response.headers.get("location")!);
      nonce = location.searchParams.get("nonce")!;
      const cookie = response.headers.getSetCookie().map((v) => v.split(";")[0]).join("; ");
      return { location, cookie };
    },
    async login(next?: string) {
      const { location, cookie } = await this.start(next);
      return app.request(`http://x/api/v1/auth/google/callback?code=test&state=${location.searchParams.get("state")}`, {
        headers: { Cookie: cookie },
      });
    },
  };
}

async function sessionUser(app: Hono, response: Response) {
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith("artisan_user_session="))?.split(";")[0];
  expect(cookie).toBeDefined();
  const me = await app.request("http://x/api/v1/auth/me", { headers: { Cookie: cookie! } });
  expect(me.status).toBe(200);
  return (await me.json()).user;
}

test("Google returns to the requested project after authentication", async () => {
  const flow = setup({ sub: crypto.randomUUID(), email: `${crypto.randomUUID()}@gmail.com` });
  const next = "/networks/network/servers/server/projects/project?tab=menus#details";
  const response = await flow.login(next);
  expect(response.headers.get("location")).toBe(`http://editor${next}`);
  expect(await sessionUser(flow.app, response)).toBeDefined();
});

test.each(["https://attacker.invalid", "//attacker.invalid", "/\\attacker.invalid", "/\n/attacker.invalid", "javascript:alert(1)"])("rejects unsafe Google return destination %s", async (next) => {
  const flow = setup({ sub: crypto.randomUUID(), email: `${crypto.randomUUID()}@gmail.com` });
  expect((await flow.login(next)).headers.get("location")).toBe("http://editor/account");
});

test("cancelled Google consent preserves the destination for retry", async () => {
  const flow = setup();
  const next = "/networks/network?tab=projects";
  const { cookie, location } = await flow.start(next);
  const response = await flow.app.request(`http://x/api/v1/auth/google/callback?error=access_denied&state=${location.searchParams.get("state")}`, { headers: { Cookie: cookie } });
  const redirect = new URL(response.headers.get("location")!);
  expect(redirect.searchParams.get("oauth_error")).toBe("oauth_cancelled");
  expect(redirect.searchParams.get("next")).toBe(next);
});

test("callback parameters cannot replace the signed return destination", async () => {
  const flow = setup({ sub: crypto.randomUUID(), email: `${crypto.randomUUID()}@gmail.com` });
  const next = "/networks/network";
  const { cookie, location } = await flow.start(next);
  const params = new URLSearchParams({ code: "test", state: location.searchParams.get("state")!, next: "https://attacker.invalid" });
  const response = await flow.app.request(`http://x/api/v1/auth/google/callback?${params}`, { headers: { Cookie: cookie } });
  expect(response.headers.get("location")).toBe(`http://editor${next}`);
});

test("Google reuses an existing Gmail account and preserves password login", async () => {
  const email = `google-${crypto.randomUUID()}@gmail.com`;
  const flow = setup({ sub: crypto.randomUUID(), email: email.toUpperCase() });
  const signup = await flow.app.request("http://x/api/v1/auth/signup", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "longenoughpassword", name: "Original name" }),
  });
  const original = (await signup.json()).user;
  const result = await flow.login();
  expect(result.status).toBe(302);
  expect(result.headers.get("location")).toBe("http://editor/account");
  expect(await sessionUser(flow.app, result)).toMatchObject({ id: original.id, name: "Original name", email });
  const passwordLogin = await flow.app.request("http://x/api/v1/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "longenoughpassword" }),
  });
  expect((await passwordLogin.json()).user.id).toBe(original.id);
});

test("the application exposes Google only with complete configuration", async () => {
  expect(await (await productionApp.request("http://x/api/v1/auth/google/configured")).json()).toEqual({ configured: true });
  delete process.env.GOOGLE_CLIENT_SECRET;
  try {
    expect(await (await productionApp.request("http://x/api/v1/auth/google/configured")).json()).toEqual({ configured: false });
  } finally { process.env.GOOGLE_CLIENT_SECRET = "test-secret"; }
});

test("first Google login creates an account and subsequent login follows the stable subject after email changes", async () => {
  const sub = crypto.randomUUID();
  const email = `${sub}@gmail.com`;
  const flow = setup({ sub, email });
  const first = await sessionUser(flow.app, await flow.login());
  flow.update({ sub, email: `${crypto.randomUUID()}@gmail.com` });
  expect(await sessionUser(flow.app, await flow.login())).toMatchObject({ id: first.id, email });
});

test("simultaneous first callbacks create one account", async () => {
  const claims = { sub: crypto.randomUUID(), email: `${crypto.randomUUID()}@gmail.com` };
  const flows = [setup(claims), setup(claims)];
  const sessions = await Promise.all(flows.map(async (flow) => sessionUser(flow.app, await flow.login())));
  expect(sessions[0].id).toBe(sessions[1].id);
});

test.each([
  ["unverified email", { email_verified: false }, "oauth_email_unverified"],
  ["missing email", { email: null }, "oauth_email_unverified"],
  ["wrong audience", { aud: "another-client" }, "google_login_failed"],
  ["wrong issuer", { iss: "https://attacker.invalid" }, "google_login_failed"],
  ["wrong nonce", { nonce: "another-login" }, "google_login_failed"],
  ["expired token", { exp: 1 }, "google_login_failed"],
  ["wrong authorized party", { azp: "another-client" }, "google_login_failed"],
  ["empty subject", { sub: "" }, "google_login_failed"],
])("rejects %s without creating a session", async (_, overrides, error) => {
  const flow = setup({ sub: crypto.randomUUID(), email: `${crypto.randomUUID()}@gmail.com`, ...overrides });
  const result = await flow.login();
  expect(result.headers.get("location")).toBe(`http://editor/login?oauth_error=${error}`);
  expect(result.headers.get("set-cookie")).not.toContain("artisan_user_session=");
});

test("rejects mismatched state and cancelled consent before exchanging a code", async () => {
  const flow = setup();
  const { cookie, location } = await flow.start();
  expect(location.searchParams.get("scope")).toBe("openid email profile");
  expect(location.searchParams.get("code_challenge_method")).toBe("S256");
  expect(location.searchParams.get("code_challenge")).toHaveLength(43);
  const invalid = await flow.app.request("http://x/api/v1/auth/google/callback?code=c&state=wrong", { headers: { Cookie: cookie } });
  expect(invalid.headers.get("location")).toContain("oauth_invalid_state");
  const cancelled = await flow.app.request(`http://x/api/v1/auth/google/callback?error=access_denied&state=${location.searchParams.get("state")}`, { headers: { Cookie: cookie } });
  expect(cancelled.headers.get("location")).toContain("oauth_cancelled");
  expect(flow.exchanges()).toBe(0);
});

test("does not silently replace a Google identity already linked to the same email", async () => {
  const email = `${crypto.randomUUID()}@gmail.com`;
  const flow = setup({ sub: crypto.randomUUID(), email });
  const original = await sessionUser(flow.app, await flow.login());
  flow.update({ sub: crypto.randomUUID(), email });
  expect((await flow.login()).headers.get("location")).toContain("oauth_account_already_linked");
  expect(original.id).toBeTruthy();
});

test("a token signed by an untrusted key cannot create a session", async () => {
  const flow = setup({ sub: crypto.randomUUID(), email: `${crypto.randomUUID()}@gmail.com` }, untrustedKeys.privateKey);
  const response = await flow.login();
  expect(response.headers.get("location")).toContain("google_login_failed");
  expect(response.headers.get("set-cookie")).not.toContain("artisan_user_session=");
});

test("a tampered flow cookie cannot exchange a code", async () => {
  const flow = setup();
  const { cookie, location } = await flow.start();
  const response = await flow.app.request(`http://x/api/v1/auth/google/callback?code=c&state=${location.searchParams.get("state")}`, {
    headers: { Cookie: `${cookie}tampered` },
  });
  expect(response.headers.get("location")).toContain("oauth_invalid_state");
  expect(flow.exchanges()).toBe(0);
});

test("external Google email cannot claim an existing password account, while Workspace can", async () => {
  const email = `${crypto.randomUUID()}@example.com`;
  const flow = setup({ sub: crypto.randomUUID(), email });
  const signup = await flow.app.request("http://x/api/v1/auth/signup", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "longenoughpassword", name: "Original" }),
  });
  const original = (await signup.json()).user;
  expect((await flow.login()).headers.get("location")).toContain("oauth_email_not_authoritative");
  flow.update({ sub: crypto.randomUUID(), email, hd: "example.com" });
  expect((await sessionUser(flow.app, await flow.login())).id).toBe(original.id);
});
