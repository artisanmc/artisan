const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface NetworkSummary {
  id: string;
  name: string;
  tier: string;
}

export interface ServerKeySummary {
  id: string;
  label: string | null;
}

export interface PackSummary {
  id: string;
  name: string;
  hash: string;
}

export async function listNetworks(): Promise<NetworkSummary[]> {
  const res = await fetch(`${API_URL}/api/networks`, { credentials: "include" });
  if (!res.ok) throw new Error(`listNetworks failed: ${res.status}`);
  return ((await res.json()) as { networks: NetworkSummary[] }).networks;
}

export async function createNetwork(name: string): Promise<NetworkSummary> {
  const res = await fetch(`${API_URL}/api/networks`, {
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
  packs: PackSummary[];
  serverKeys: ServerKeySummary[];
}> {
  const res = await fetch(`${API_URL}/api/networks/${id}`, { credentials: "include" });
  if (!res.ok) throw new Error(`getNetwork failed: ${res.status}`);
  return res.json();
}

export async function createServerKey(
  networkId: string,
  label?: string,
): Promise<{ id: string; key: string; label: string | null }> {
  const res = await fetch(`${API_URL}/api/networks/${networkId}/server-keys`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(label !== undefined ? { label } : {}),
  });
  if (!res.ok) throw new Error(`createServerKey failed: ${res.status}`);
  return res.json();
}

export async function createPack(
  networkId: string,
  name: string,
  description?: string,
): Promise<PackSummary> {
  const res = await fetch(`${API_URL}/api/networks/${networkId}/packs`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, ...(description !== undefined && { description }) }),
  });
  if (!res.ok) throw new Error(`createPack failed: ${res.status}`);
  return ((await res.json()) as { pack: PackSummary }).pack;
}

export async function bindPackToServerKey(
  networkId: string,
  packId: string,
  serverKeyId: string,
): Promise<void> {
  const res = await fetch(
    `${API_URL}/api/networks/${networkId}/packs/${packId}/bindings/${serverKeyId}`,
    { method: "POST", credentials: "include" },
  );
  if (!res.ok) throw new Error(`bind failed: ${res.status}`);
}

export async function unbindPack(
  networkId: string,
  packId: string,
  serverKeyId: string,
): Promise<void> {
  const res = await fetch(
    `${API_URL}/api/networks/${networkId}/packs/${packId}/bindings/${serverKeyId}`,
    { method: "DELETE", credentials: "include" },
  );
  if (!res.ok) throw new Error(`unbind failed: ${res.status}`);
}

// ─── Network transfer ──────────────────────────────────────────────────────

export interface TransferInitResponse {
  url: string;
  expiresAt: string;
}

export interface TransferInfo {
  networkId: string;
  networkName: string;
  packCount: number;
  serverKeyCount: number;
  expiresAt: string;
}

export type TransferState = TransferInfo | "expired" | "consumed" | "not_found";

export async function initNetworkTransfer(networkId: string): Promise<TransferInitResponse> {
  const res = await fetch(`${API_URL}/api/networks/${networkId}/transfer/init`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Transfer init failed (${res.status})`);
  return res.json();
}

export async function getNetworkTransfer(token: string): Promise<TransferState> {
  const res = await fetch(`${API_URL}/api/networks/transfer/${token}`, { credentials: "include" });
  if (res.status === 404) return "not_found";
  if (res.status === 410) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    return body.error === "consumed" ? "consumed" : "expired";
  }
  if (!res.ok) throw new Error(`Transfer fetch failed (${res.status})`);
  return res.json();
}

export async function acceptNetworkTransfer(token: string): Promise<{ networkId: string }> {
  const res = await fetch(`${API_URL}/api/networks/transfer/${token}/accept`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Transfer accept failed (${res.status})`);
  const body = await res.json() as { ok: boolean; networkId: string };
  return { networkId: body.networkId };
}

export async function deleteServerKey(networkId: string, keyId: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/networks/${networkId}/server-keys/${keyId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Server key delete failed (${res.status})`);
}

// ─── Link claim (called from /link wizard) ─────────────────────────────────

export class ClaimError extends Error {
  constructor(
    public readonly code:
      | "must_choose_network"
      | "unauthorized"
      | "forbidden"
      | "expired"
      | "already_claimed"
      | "unknown",
  ) {
    super(code);
  }
}

export async function claimLinkCode(
  code: string,
  networkId?: string,
): Promise<{ server_key_id: string; network_id: string }> {
  const res = await fetch(`${API_URL}/api/link/${code}/claim`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(networkId ? { network_id: networkId } : {}),
  });
  if (res.ok) return res.json();
  const body = await res.json().catch(() => ({})) as { error?: string };
  const errorCode = body.error;
  if (res.status === 400 && errorCode === "must_choose_network") throw new ClaimError("must_choose_network");
  if (res.status === 401) throw new ClaimError("unauthorized");
  if (res.status === 403) throw new ClaimError("forbidden");
  if (res.status === 409) throw new ClaimError("already_claimed");
  if (res.status === 410) throw new ClaimError("expired");
  throw new ClaimError("unknown");
}
