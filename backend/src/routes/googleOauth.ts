import { Hono } from "hono";
import { deleteCookie, getSignedCookie, setCookie, setSignedCookie } from "hono/cookie";
import { createGoogleIdentityReader } from "../lib/googleOauth";
import { OauthAccountError, resolveOauthAccount } from "../lib/oauthAccounts";
import { createSession } from "../lib/sessionManager";
import { sendSafely } from "../lib/mail/mailer";
import { welcomeEmail } from "../lib/mail/templates";

const cookieName = "artisan_google_oauth";
const randomToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

function config() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim();
  return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null;
}

export function createGoogleOauthRouter(fetchImpl: typeof fetch = fetch) {
  const router = new Hono();
  const readIdentity = createGoogleIdentityReader(fetchImpl);
  const errorUrl = (error: string) => `${process.env.EDITOR_URL ?? "http://localhost:5173"}/login?oauth_error=${error}`;
  router.get("/configured", (c) => c.json({ configured: config() !== null }));
  router.get("/start", async (c) => {
    const settings = config();
    if (!settings) return c.redirect(errorUrl("google_not_configured"));
    const flow = { state: randomToken(), nonce: randomToken(), verifier: randomToken(), createdAt: Date.now() };
    await setSignedCookie(c, cookieName, JSON.stringify(flow), settings.clientSecret, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "Lax", path: "/", maxAge: 600,
    });
    const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(flow.verifier))).toString("base64url");
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: settings.clientId, redirect_uri: settings.redirectUri, response_type: "code",
      scope: "openid email profile", state: flow.state, nonce: flow.nonce,
      code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account",
    }).toString();
    return c.redirect(url.toString());
  });
  router.get("/callback", async (c) => {
    const settings = config();
    deleteCookie(c, cookieName, { path: "/" });
    if (!settings) return c.redirect(errorUrl("google_not_configured"));
    let flow: { state: string; nonce: string; verifier: string; createdAt: number };
    try {
      const raw = await getSignedCookie(c, settings.clientSecret, cookieName);
      if (!raw) throw new Error("Missing flow");
      flow = JSON.parse(raw);
      if (!flow.state || flow.state !== c.req.query("state") || !flow.nonce || !flow.verifier ||
          !Number.isFinite(flow.createdAt) || Date.now() - flow.createdAt > 600_000 || flow.createdAt > Date.now()) {
        throw new Error("Invalid flow");
      }
    } catch {
      return c.redirect(errorUrl("oauth_invalid_state"));
    }
    if (c.req.query("error")) return c.redirect(errorUrl("oauth_cancelled"));
    const code = c.req.query("code");
    if (!code) return c.redirect(errorUrl("oauth_invalid_state"));
    try {
      const identity = await readIdentity({ ...settings, code, nonce: flow.nonce, verifier: flow.verifier });
      const account = await resolveOauthAccount(identity);
      const session = await createSession(account.userId);
      setCookie(c, "artisan_user_session", session.id, {
        httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "Lax", path: "/", expires: session.expiresAt,
      });
      if (account.created && identity.email) sendSafely(welcomeEmail({ to: identity.email, displayName: identity.name }));
      return c.redirect(`${process.env.EDITOR_URL ?? "http://localhost:5173"}/account`);
    } catch (error) {
      return c.redirect(errorUrl(error instanceof OauthAccountError ? error.message : "google_login_failed"));
    }
  });
  return router;
}

export const googleOauthRouter = createGoogleOauthRouter();
