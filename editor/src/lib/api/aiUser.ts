const apiUrl = (): string =>
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001";

function authHeaders(token: string | null, json = false): HeadersInit {
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (json) h["Content-Type"] = "application/json";
  return h;
}

export interface PublicAiModelDto {
  id: string; displayName: string; description: string;
  badge: "cheap" | "balanced" | "premium";
  creditsPerMInput: number; creditsPerMOutput: number;
  estimates: { chatMessage: number; menuMigration: number };
}
export interface ModelsResponse {
  models: PublicAiModelDto[]; defaultModelId: string | null; preferredModelId: string | null;
}

export async function getModels(token: string | null): Promise<ModelsResponse | null> {
  const res = await fetch(`${apiUrl()}/api/v1/ai/models`, {
    credentials: "include", headers: authHeaders(token),
  });
  if (!res.ok) return null;
  return (await res.json()) as ModelsResponse;
}

export async function getBalance(token: string | null, projectId: string): Promise<number | null> {
  const res = await fetch(`${apiUrl()}/api/v1/ai/balance?projectId=${encodeURIComponent(projectId)}`, {
    credentials: "include", headers: authHeaders(token),
  });
  if (!res.ok) return null;
  return ((await res.json()) as { balance: number }).balance;
}

export async function setPreferredModel(token: string | null, modelId: string): Promise<boolean> {
  const res = await fetch(`${apiUrl()}/api/v1/ai/preferred-model`, {
    method: "PUT", credentials: "include", headers: authHeaders(token, true),
    body: JSON.stringify({ modelId }),
  });
  return res.ok;
}
