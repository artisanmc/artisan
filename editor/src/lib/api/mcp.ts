import { apiFetch } from "./client";

/** The OAuth consent of the MCP endpoint (ADR `mcp-server`): who asks, and for whom. */
export interface ConsentRequest {
  client: { name: string; redirectHost: string };
  player: string;
  canEdit: boolean;
}

/** What the client sent to `/oauth/authorize`, carried by the consent page's URL. */
export interface ConsentParams {
  client_id: string;
  redirect_uri: string;
  state?: string;
  code_challenge: string;
}

/** A client the player allowed, as the settings list shows it. */
export interface McpGrant {
  id: string;
  client: string;
  createdAt: string;
  lastUsedAt: string;
}

const CONSENT = "/api/v1/oauth/consent";
const GRANTS = "/api/v1/user/mcp/grants";

export function getConsent(params: ConsentParams): Promise<ConsentRequest> {
  const query = new URLSearchParams({
    client_id: params.client_id,
    redirect_uri: params.redirect_uri,
  });
  return apiFetch(`${CONSENT}?${query}`);
}

/** The address to send the browser back to: the client's, with a code or `access_denied`. */
export async function answerConsent(params: ConsentParams, approve: boolean): Promise<string> {
  const { redirect } = await apiFetch<{ redirect: string }>(CONSENT, {
    method: "POST",
    json: { ...params, approve },
  });
  return redirect;
}

/** Rejects with `not_found` when the hub runs without `web.mcp`. */
export async function listMcpGrants(): Promise<McpGrant[]> {
  const { grants } = await apiFetch<{ grants: McpGrant[] }>(GRANTS);
  return grants;
}

export async function revokeMcpGrant(id: string): Promise<void> {
  await apiFetch(`${GRANTS}/${encodeURIComponent(id)}`, { method: "DELETE" });
}
