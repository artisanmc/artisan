import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { buildAuthorizeUrl } from "../lib/discordOauth";

const router = new Hono();

function newOauthState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function envOrNull(name: string): string | null {
  const v = process.env[name];
  return v && v.length > 0 ? v : null;
}

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
    maxAge: 600, // 10 min
  });
  const url = buildAuthorizeUrl({ clientId, redirectUri, state });
  return c.redirect(url);
});

export { router as discordOauthRouter };
