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
