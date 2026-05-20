export interface AuthorizeUrlParams {
  clientId: string;
  redirectUri: string;
  state: string;
}

export function buildAuthorizeUrl(p: AuthorizeUrlParams): string {
  const url = new URL("https://discord.com/api/oauth2/authorize");
  url.searchParams.set("client_id", p.clientId);
  url.searchParams.set("redirect_uri", p.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify email");
  url.searchParams.set("state", p.state);
  url.searchParams.set("prompt", "none");
  return url.toString();
}

export interface ExchangeCodeParams {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface ExchangeCodeResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
}

export async function exchangeCode(
  p: ExchangeCodeParams,
  fetchImpl: typeof fetch = fetch,
): Promise<ExchangeCodeResult> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: p.code,
    client_id: p.clientId,
    client_secret: p.clientSecret,
    redirect_uri: p.redirectUri,
  });
  const res = await fetchImpl("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Discord OAuth exchange failed (${res.status}): ${errBody}`);
  }
  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number; scope: string };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    scope: data.scope,
  };
}

export interface DiscordUserInfo {
  discordUserId: string;
  username: string;
  email: string | null;
  avatarUrl: string | null;
}

export async function fetchDiscordUser(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscordUserInfo> {
  const res = await fetchImpl("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Discord /users/@me failed (${res.status})`);
  }
  const data = await res.json() as { id: string; username: string; email?: string; avatar?: string | null };
  const avatarUrl = data.avatar
    ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png`
    : null;
  return {
    discordUserId: data.id,
    username: data.username,
    email: data.email ?? null,
    avatarUrl,
  };
}
