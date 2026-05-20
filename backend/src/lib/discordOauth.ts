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
