const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface LinkCodeResponse {
  code: string;
  url: string;
  expires_at: string;
}

export interface LinkStatusResponse {
  status: "pending" | "claimed" | "expired";
  code: string;
  expires_at?: string;
}

export async function createLinkCode(): Promise<LinkCodeResponse> {
  const res = await fetch(`${API_URL}/api/link`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to create link code: ${res.status}`);
  return res.json() as Promise<LinkCodeResponse>;
}

export async function getLinkStatus(code: string): Promise<LinkStatusResponse> {
  const res = await fetch(`${API_URL}/api/link/${code}`);
  if (!res.ok) throw new Error(`Failed to get link status: ${res.status}`);
  return res.json() as Promise<LinkStatusResponse>;
}

export async function claimLinkCode(code: string): Promise<{ server_key_id: string }> {
  const res = await fetch(`${API_URL}/api/link/${code}/claim`, { method: "POST" });
  if (res.status === 409) throw new Error("Already claimed");
  if (res.status === 410) throw new Error("Code expired");
  if (!res.ok) throw new Error(`Failed to claim: ${res.status}`);
  return res.json() as Promise<{ server_key_id: string }>;
}
