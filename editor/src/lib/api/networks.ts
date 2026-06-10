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
  updatedAt?: string;
  networkId: string;
  serverKeyId: string;
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
  packs: PackSummary[];
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
  return res.json();
}

export async function createServerKey(
  networkId: string,
  label?: string,
): Promise<{ id: string; key: string; label: string | null }> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/server-keys`, {
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
  serverKeyId: string,
  name: string,
  description?: string,
): Promise<PackSummary> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/packs`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      serverKeyId,
      ...(description !== undefined && { description }),
    }),
  });
  if (!res.ok) throw new Error(`createPack failed: ${res.status}`);
  return ((await res.json()) as { pack: PackSummary }).pack;
}

export async function bindPackToServerKey(
  networkId: string,
  packId: string,
  serverKeyId: string,
  branchName = "main",
): Promise<void> {
  const res = await fetch(
    `${API_URL}/api/v1/networks/${networkId}/packs/${packId}/bindings/${serverKeyId}`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch_name: branchName }),
    },
  );
  if (!res.ok) throw new Error(`bind failed: ${res.status}`);
}

export async function unbindPack(
  networkId: string,
  packId: string,
  serverKeyId: string,
): Promise<void> {
  const res = await fetch(
    `${API_URL}/api/v1/networks/${networkId}/packs/${packId}/bindings/${serverKeyId}`,
    { method: "DELETE", credentials: "include" },
  );
  if (!res.ok) throw new Error(`unbind failed: ${res.status}`);
}

export interface PackBinding {
  bindingId: string;
  serverKeyId: string;
  serverKeyLabel: string | null;
  branchName: string;
  createdAt: string;
  lastMcVersion: string | null;
  /** True iff a plugin is currently authenticated against this server_key. */
  online: boolean;
}

export async function listPackBindings(networkId: string, packId: string): Promise<PackBinding[]> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/packs/${packId}/bindings`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`listPackBindings failed: ${res.status}`);
  const data = (await res.json()) as {
    bindings: Array<{
      binding_id: string;
      server_key_id: string;
      server_key_label: string | null;
      branch_name: string;
      created_at: string;
      last_mc_version: string | null;
      online: boolean;
    }>;
  };
  return data.bindings.map((b) => ({
    bindingId: b.binding_id,
    serverKeyId: b.server_key_id,
    serverKeyLabel: b.server_key_label,
    branchName: b.branch_name,
    createdAt: b.created_at,
    lastMcVersion: b.last_mc_version,
    online: b.online,
  }));
}

export async function updatePackBindingBranch(
  networkId: string,
  packId: string,
  serverKeyId: string,
  branchName: string,
): Promise<void> {
  const res = await fetch(
    `${API_URL}/api/v1/networks/${networkId}/packs/${packId}/bindings/${serverKeyId}`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch_name: branchName }),
    },
  );
  if (!res.ok) throw new Error(`updatePackBindingBranch failed: ${res.status}`);
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

export async function rotateServerKey(
  networkId: string,
  keyId: string,
): Promise<{ id: string; key: string; label: string | null }> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/server-keys/${keyId}/rotate`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Server key rotate failed (${res.status})`);
  return res.json();
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

export interface ClaimLinkInput {
  /** Existing network to attach the server_key to. XOR with `networkName`. */
  networkId?: string;
  /** When provided, a new network with this name is created + claimed. */
  networkName?: string;
  /** Existing pack to bind to the new server_key. XOR with `packName`. */
  packId?: string;
  /** When provided, a new pack with this name is created in the target network + bound. */
  packName?: string;
  /** Optional label for the generated server_key (e.g. "Survival-Main"). */
  serverKeyLabel?: string;
}

export async function claimLinkCode(
  code: string,
  input: ClaimLinkInput = {},
): Promise<{ server_key_id: string; network_id: string; pack_id: string | null }> {
  const body: Record<string, string> = {};
  if (input.networkId) body.network_id = input.networkId;
  if (input.networkName) body.network_name = input.networkName;
  if (input.packId) body.pack_id = input.packId;
  if (input.packName) body.pack_name = input.packName;
  if (input.serverKeyLabel) body.server_key_label = input.serverKeyLabel;

  const res = await fetch(`${API_URL}/api/v1/link/${code}/claim`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return res.json();
  const errorBody = (await res.json().catch(() => ({}))) as { error?: string };
  const errorCode = errorBody.error;
  if (res.status === 400 && errorCode === "must_choose_network")
    throw new ClaimError("must_choose_network");
  if (res.status === 400 && errorCode === "ambiguous_network")
    throw new ClaimError("ambiguous_network");
  if (res.status === 400 && errorCode === "ambiguous_pack") throw new ClaimError("ambiguous_pack");
  if (res.status === 404 && errorCode === "pack_not_in_network")
    throw new ClaimError("pack_not_in_network");
  if (res.status === 422 && errorCode === "invalid_network_name")
    throw new ClaimError("invalid_network_name");
  if (res.status === 422 && errorCode === "invalid_pack_name")
    throw new ClaimError("invalid_pack_name");
  if (res.status === 401) throw new ClaimError("unauthorized");
  if (res.status === 403) throw new ClaimError("forbidden");
  if (res.status === 409) throw new ClaimError("already_claimed");
  if (res.status === 410) throw new ClaimError("expired");
  throw new ClaimError("unknown");
}
