import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import type { OauthIdentity } from "./oauthAccounts";

export function createGoogleIdentityReader(fetchImpl: typeof fetch = fetch) {
  const jwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), {
    [customFetch]: (url, options) => fetchImpl(url, options),
  });
  return async (params: {
    code: string; clientId: string; clientSecret: string; redirectUri: string;
    nonce: string; verifier: string;
  }): Promise<OauthIdentity> => {
    const response = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code", code: params.code,
        client_id: params.clientId, client_secret: params.clientSecret,
        redirect_uri: params.redirectUri, code_verifier: params.verifier,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Google token exchange failed");
    const data = await response.json() as { id_token?: unknown };
    if (typeof data.id_token !== "string") throw new Error("Missing Google ID token");
    const { payload } = await jwtVerify(data.id_token, jwks, {
      algorithms: ["RS256"], issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: params.clientId, requiredClaims: ["sub", "iat", "exp", "nonce"],
    });
    if (!payload.sub || payload.nonce !== params.nonce || (payload.azp !== undefined && payload.azp !== params.clientId)) {
      throw new Error("Invalid Google identity");
    }
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : null;
    return {
      provider: "google", subject: payload.sub, email,
      emailVerified: payload.email_verified === true,
      canLinkByEmail: Boolean(email?.endsWith("@gmail.com") || (typeof payload.hd === "string" && payload.hd.length > 0)),
      name: typeof payload.name === "string" && payload.name.trim() ? payload.name : email?.split("@")[0] ?? "Google user",
      avatarUrl: typeof payload.picture === "string" ? payload.picture : null,
    };
  };
}
