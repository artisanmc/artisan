import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { OauthAccountError, resolveOauthAccount } from "../lib/oauthAccounts";
import { buildAuthorizeUrl, exchangeCode, fetchDiscordUser } from "../lib/discordOauth";
import { createSession } from "../lib/sessionManager";
import { sendSafely } from "../lib/mail/mailer";
import { welcomeEmail } from "../lib/mail/templates";

const returnCookie = "artisan_discord_return";

function safeReturnPath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return undefined;
  return value;
}

export function createDiscordOauthRouter(fetchImpl: typeof fetch = fetch) {
  const router = new Hono();

  function newOauthState(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  function envOrNull(name: string): string | null {
    const v = process.env[name];
    return v && v.length > 0 ? v : null;
  }

  router.get("/configured", (c) => {
    const clientId = envOrNull("DISCORD_CLIENT_ID");
    const redirectUri = envOrNull("DISCORD_REDIRECT_URI");
    return c.json({ configured: Boolean(clientId && redirectUri && envOrNull("DISCORD_CLIENT_SECRET")) });
  });

  router.get("/start", async (c) => {
    const clientId = envOrNull("DISCORD_CLIENT_ID");
    const redirectUri = envOrNull("DISCORD_REDIRECT_URI");
    if (!clientId || !redirectUri || !envOrNull("DISCORD_CLIENT_SECRET")) {
      return c.json({ error: "discord_not_configured" }, 500);
    }
    const state = newOauthState();
    setCookie(c, "artisan_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      path: "/",
      maxAge: 600,
    });
    const next = safeReturnPath(c.req.query("next"));
    if (next) {
      await setSignedCookie(c, returnCookie, JSON.stringify({ state, next, createdAt: Date.now() }), envOrNull("DISCORD_CLIENT_SECRET")!, {
        httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "Lax", path: "/", maxAge: 600,
      });
    } else {
      deleteCookie(c, returnCookie, { path: "/" });
    }
    return c.redirect(buildAuthorizeUrl({ clientId, redirectUri, state }));
  });

  router.get("/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const stateCookie = getCookie(c, "artisan_oauth_state");
    if (!stateCookie || !state || stateCookie !== state) {
      return c.json({ error: "invalid_state" }, 400);
    }
    deleteCookie(c, "artisan_oauth_state", { path: "/" });

    const clientId = envOrNull("DISCORD_CLIENT_ID");
    const clientSecret = envOrNull("DISCORD_CLIENT_SECRET");
    const redirectUri = envOrNull("DISCORD_REDIRECT_URI");
    if (!clientId || !clientSecret || !redirectUri) {
      return c.json({ error: "discord_not_configured" }, 500);
    }
    let next: string | undefined;
    const rawReturn = await getSignedCookie(c, clientSecret, returnCookie);
    deleteCookie(c, returnCookie, { path: "/" });
    if (rawReturn) {
      try {
        const flow = JSON.parse(rawReturn);
        if (flow.state === state && Number.isFinite(flow.createdAt) && flow.createdAt <= Date.now() && Date.now() - flow.createdAt <= 600_000) {
          next = safeReturnPath(flow.next);
        }
      } catch { /* Invalid return context keeps the default account destination. */ }
    }
    if (c.req.query("error")) {
      const params = new URLSearchParams({ oauth_error: "oauth_cancelled" });
      if (next) params.set("next", next);
      return c.redirect(`${process.env.EDITOR_URL ?? "http://localhost:5173"}/login?${params}`);
    }
    if (!code) {
      return c.json({ error: "missing_code" }, 400);
    }

    let tokens, user;
    try {
      tokens = await exchangeCode({ code, clientId, clientSecret, redirectUri }, fetchImpl);
      user = await fetchDiscordUser(tokens.accessToken, fetchImpl);
    } catch (err) {
      console.error("Discord OAuth callback failure:", err);
      return c.json({ error: "discord_exchange_failed" }, 502);
    }

    let userId: string;
    try {
      const account = await resolveOauthAccount({
        provider: "discord", subject: user.discordUserId,
        email: user.email, emailVerified: user.emailVerified, canLinkByEmail: user.emailVerified,
        name: user.username, avatarUrl: user.avatarUrl,
      });
      userId = account.userId;
      if (account.created && user.email) sendSafely(welcomeEmail({ to: user.email, displayName: user.username }));
    } catch (error) {
      if (error instanceof OauthAccountError) return c.json({ error: error.message }, 422);
      throw error;
    }

    const session = await createSession(userId);
    setCookie(c, "artisan_user_session", session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      expires: session.expiresAt,
      path: "/",
    });

    const editorUrl = process.env.EDITOR_URL ?? "http://localhost:5173";
    return c.redirect(`${editorUrl}${next ?? "/account"}`);
  });

  return router;
}

export const discordOauthRouter = createDiscordOauthRouter();
