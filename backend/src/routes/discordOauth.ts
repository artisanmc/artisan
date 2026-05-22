import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { users, discordAccounts } from "../db/schema";
import { buildAuthorizeUrl, exchangeCode, fetchDiscordUser } from "../lib/discordOauth";
import { normalizeEmail } from "../lib/emailNormalizer";
import { createSession } from "../lib/sessionManager";

export function createDiscordOauthRouter(fetchImpl: typeof fetch = fetch) {
  const router = new Hono();

  function newOauthState(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  function newUserId(): string {
    return "user_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  }
  function envOrNull(name: string): string | null {
    const v = process.env[name];
    return v && v.length > 0 ? v : null;
  }

  router.get("/configured", (c) => {
    const clientId = envOrNull("DISCORD_CLIENT_ID");
    const redirectUri = envOrNull("DISCORD_REDIRECT_URI");
    return c.json({ configured: Boolean(clientId && redirectUri) });
  });

  router.get("/start", (c) => {
    const clientId = envOrNull("DISCORD_CLIENT_ID");
    const redirectUri = envOrNull("DISCORD_REDIRECT_URI");
    if (!clientId || !redirectUri) {
      return c.json({ error: "discord_not_configured" }, 500);
    }
    const state = newOauthState();
    setCookie(c, "ifz_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      path: "/",
      maxAge: 600,
    });
    return c.redirect(buildAuthorizeUrl({ clientId, redirectUri, state }));
  });

  router.get("/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const stateCookie = getCookie(c, "ifz_oauth_state");
    if (!stateCookie || !state || stateCookie !== state) {
      return c.json({ error: "invalid_state" }, 400);
    }
    if (!code) {
      return c.json({ error: "missing_code" }, 400);
    }
    deleteCookie(c, "ifz_oauth_state", { path: "/" });

    const clientId = envOrNull("DISCORD_CLIENT_ID");
    const clientSecret = envOrNull("DISCORD_CLIENT_SECRET");
    const redirectUri = envOrNull("DISCORD_REDIRECT_URI");
    if (!clientId || !clientSecret || !redirectUri) {
      return c.json({ error: "discord_not_configured" }, 500);
    }

    let tokens, user;
    try {
      tokens = await exchangeCode({ code, clientId, clientSecret, redirectUri }, fetchImpl);
      user = await fetchDiscordUser(tokens.accessToken, fetchImpl);
    } catch (err) {
      console.error("Discord OAuth callback failure:", err);
      return c.json({ error: "discord_exchange_failed" }, 502);
    }

    if (!user.email) {
      return c.json({ error: "discord_email_missing" }, 422);
    }
    const email = normalizeEmail(user.email);
    const now = new Date();

    const existingLink = await db.select().from(discordAccounts).where(eq(discordAccounts.discordUserId, user.discordUserId));
    let userId: string;

    if (existingLink.length > 0) {
      userId = existingLink[0].userId;
    } else {
      const existingUser = await db.select().from(users).where(eq(users.email, email));
      if (existingUser.length > 0) {
        userId = existingUser[0].id;
      } else {
        userId = newUserId();
        await db.insert(users).values({
          id: userId, email, name: user.username, passwordHash: null,
          avatarUrl: user.avatarUrl, createdAt: now, updatedAt: now,
        });
      }
      await db.insert(discordAccounts).values({
        discordUserId: user.discordUserId,
        userId,
        username: user.username,
        email: user.email,
        linkedAt: now,
      });
    }

    const session = await createSession(userId);
    setCookie(c, "ifz_user_session", session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      expires: session.expiresAt,
      path: "/",
    });

    const editorUrl = process.env.EDITOR_URL ?? "http://localhost:5173";
    return c.redirect(`${editorUrl}/account`);
  });

  return router;
}

export const discordOauthRouter = createDiscordOauthRouter();
