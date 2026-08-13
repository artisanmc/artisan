const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface NetworkSummary {
  id: string;
  name: string;
  /** URL slug. Optional for resilience — callers fall back to `id` if absent. */
  slug?: string;
  tier: string;
}

export interface ServerKeySummary {
  id: string;
  label: string | null;
  slug?: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  slug?: string;
  hash: string;
  updatedAt?: string;
  networkId: string;
  serverKeyId: string;
  /** Menus + commands + dialogs count, for the document-count indicator. */
  documentCount?: number;
  /** Owning Add-on module id (`manifest.module`) — groups the project under
   *  "Installed modules" in the sidebar instead of the flat list. */
  ownerModule?: string;
}

export async function listNetworks(): Promise<NetworkSummary[]> {
  const res = await fetch(`${API_URL}/api/v1/networks`, { credentials: "include" });
  if (!res.ok) throw new Error(`listNetworks failed: ${res.status}`);
  return ((await res.json()) as { networks: NetworkSummary[] }).networks;
}

export async function createNetwork(name: string): Promise<NetworkSummary> {
  const res = await fetch(`${API_URL}/api/v1/networks`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`createNetwork failed: ${res.status}`);
  return ((await res.json()) as { network: NetworkSummary }).network;
}

export async function getNetwork(id: string): Promise<{
  network: NetworkSummary;
  projects: ProjectSummary[];
  serverKeys: ServerKeySummary[];
}> {
  const res = await fetch(`${API_URL}/api/v1/networks/${id}`, { credentials: "include" });
  if (!res.ok) {
    // Attach the HTTP status so callers can react (e.g. 403/404 → redirect to
    // the user's own networks list rather than loop a broken page).
    const err = new Error(`getNetwork failed: ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const json = (await res.json()) as {
    network: NetworkSummary;
    projects: ProjectSummary[];
    serverKeys: ServerKeySummary[];
  };
  return { network: json.network, projects: json.projects, serverKeys: json.serverKeys };
}

export interface ServerStatusEntry {
  id: string;
  label: string | null;
  online: boolean;
  lastMcVersion: string | null;
  /** ISO timestamp of the last *accepted* hello; null = never connected. */
  lastSeenAt: string | null;
  lastSeenIp: string | null;
  isCurrent: boolean;
}

export interface NetworkServersStatus {
  servers: ServerStatusEntry[];
  online: number;
  total: number;
}

/** Topbar linked-servers aggregate: live online state + last-seen per server key. */
export async function getNetworkServersStatus(
  networkId: string,
  currentServerKeyId?: string,
): Promise<NetworkServersStatus> {
  const q = currentServerKeyId ? `?current=${encodeURIComponent(currentServerKeyId)}` : "";
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/servers-status${q}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`getNetworkServersStatus failed: ${res.status}`);
  return res.json();
}

/**
 * Create a server in a network. The key is created *unredeemed* (no secret yet);
 * the returned `code` is what the admin runs as `/artisan link <code>` on the
 * Minecraft server to mint + fetch the secret. No plaintext key is returned.
 */
export async function createServerKey(
  networkId: string,
  label?: string,
): Promise<{ id: string; label: string | null; slug?: string; code: string; expires_at: string }> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/server-keys`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(label !== undefined ? { label } : {}),
  });
  if (!res.ok) throw new Error(`createServerKey failed: ${res.status}`);
  return res.json();
}

/**
 * Mint a fresh link code for an existing server (re-link / rotate). Running
 * `/artisan link <code>` with it rotates the server's key in place — same row,
 * same projects, no duplicate.
 */
export async function mintServerLinkCode(
  networkId: string,
  serverKeyId: string,
): Promise<{ code: string; expires_at: string }> {
  const res = await fetch(
    `${API_URL}/api/v1/networks/${networkId}/server-keys/${serverKeyId}/link-code`,
    { method: "POST", credentials: "include" },
  );
  if (!res.ok) throw new Error(`mintServerLinkCode failed: ${res.status}`);
  return res.json();
}

/**
 * PATCH name/slug. Throws the backend error code ("slug_taken",
 * "invalid_slug"…) as the Error message so the UI can map it to a string.
 */
export async function updateNetwork(
  networkId: string,
  updates: { name?: string; slug?: string },
): Promise<NetworkSummary> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `updateNetwork failed: ${res.status}`);
  }
  return ((await res.json()) as { network: NetworkSummary }).network;
}

/** PATCH label/slug of a server key. Error contract mirrors updateNetwork. */
export async function updateServerKey(
  networkId: string,
  keyId: string,
  updates: { label?: string; slug?: string },
): Promise<{ id: string; label: string | null; slug?: string }> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/server-keys/${keyId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `updateServerKey failed: ${res.status}`);
  }
  return res.json();
}

export async function createProject(
  networkId: string,
  serverKeyId: string,
  name: string,
  description?: string,
): Promise<ProjectSummary> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/projects`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      serverKeyId,
      ...(description !== undefined && { description }),
    }),
  });
  if (!res.ok) throw new Error(`createProject failed: ${res.status}`);
  return ((await res.json()) as { project: ProjectSummary }).project;
}

// ─── Network transfer ──────────────────────────────────────────────────────

export interface TransferInitResponse {
  url: string;
  expiresAt: string;
}

export interface TransferInfo {
  networkId: string;
  networkName: string;
  projectCount: number;
  serverKeyCount: number;
  expiresAt: string;
}

export type TransferState = TransferInfo | "expired" | "consumed" | "not_found";

export async function initNetworkTransfer(networkId: string): Promise<TransferInitResponse> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/transfer/init`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Transfer init failed (${res.status})`);
  return res.json();
}

export async function getNetworkTransfer(token: string): Promise<TransferState> {
  const res = await fetch(`${API_URL}/api/v1/networks/transfer/${token}`, {
    credentials: "include",
  });
  if (res.status === 404) return "not_found";
  if (res.status === 410) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return body.error === "consumed" ? "consumed" : "expired";
  }
  if (!res.ok) throw new Error(`Transfer fetch failed (${res.status})`);
  return res.json();
}

export async function acceptNetworkTransfer(token: string): Promise<{ networkId: string }> {
  const res = await fetch(`${API_URL}/api/v1/networks/transfer/${token}/accept`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Transfer accept failed (${res.status})`);
  const body = (await res.json()) as { ok: boolean; networkId: string };
  return { networkId: body.networkId };
}

export async function deleteServerKey(networkId: string, keyId: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/server-keys/${keyId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Server key delete failed (${res.status})`);
}

export async function getServerStatus(
  networkId: string,
  serverId: string,
): Promise<{ online: boolean }> {
  const res = await fetch(
    `${API_URL}/api/v1/networks/${networkId}/server-keys/${serverId}/status`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error(`getServerStatus failed: ${res.status}`);
  return res.json();
}

export interface ServerKeyHello {
  id: string;
  ip: string;
  mcVersion: string | null;
  helloAt: string;
  /** null = accepted; non-null = rejected with this reason (e.g. "ip_not_allowed"). */
  rejectedReason: string | null;
}

export async function listServerKeyHelloes(
  networkId: string,
  keyId: string,
  limit = 30,
): Promise<ServerKeyHello[]> {
  const res = await fetch(
    `${API_URL}/api/v1/networks/${networkId}/server-keys/${keyId}/helloes?limit=${limit}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error(`listServerKeyHelloes failed (${res.status})`);
  const data = (await res.json()) as {
    helloes: Array<{
      id: string;
      ip: string;
      mc_version: string | null;
      hello_at: string;
      rejected_reason: string | null;
    }>;
  };
  return data.helloes.map((h) => ({
    id: h.id,
    ip: h.ip,
    mcVersion: h.mc_version,
    helloAt: h.hello_at,
    rejectedReason: h.rejected_reason,
  }));
}

export async function getServerKeyAllowlist(
  networkId: string,
  keyId: string,
): Promise<string[] | null> {
  const res = await fetch(
    `${API_URL}/api/v1/networks/${networkId}/server-keys/${keyId}/allowlist`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error(`getServerKeyAllowlist failed (${res.status})`);
  return ((await res.json()) as { allowed_ips: string[] | null }).allowed_ips;
}

export async function setServerKeyAllowlist(
  networkId: string,
  keyId: string,
  allowedIps: string[] | null,
): Promise<string[] | null> {
  const res = await fetch(
    `${API_URL}/api/v1/networks/${networkId}/server-keys/${keyId}/allowlist`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowed_ips: allowedIps }),
    },
  );
  if (!res.ok) throw new Error(`setServerKeyAllowlist failed (${res.status})`);
  return ((await res.json()) as { allowed_ips: string[] | null }).allowed_ips;
}
