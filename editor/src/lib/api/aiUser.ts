import type { BalanceBreakdown } from "./billing";

const apiUrl = (): string =>
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001";

const JSON_HEADERS: HeadersInit = { "Content-Type": "application/json" };

export interface PublicAiModelDto {
  id: string; displayName: string; description: string;
  badge: "cheap" | "balanced" | "premium";
  creditsPerMInput: number; creditsPerMOutput: number;
  estimates: { chatMessage: number; menuMigration: number };
}
export interface ModelsResponse {
  models: PublicAiModelDto[]; defaultModelId: string | null; preferredModelId: string | null;
}

export async function getModels(): Promise<ModelsResponse | null> {
  const res = await fetch(`${apiUrl()}/api/v1/ai/models`, { credentials: "include" });
  if (!res.ok) return null;
  return (await res.json()) as ModelsResponse;
}

export async function getBalance(projectId: string): Promise<BalanceBreakdown | null> {
  const res = await fetch(`${apiUrl()}/api/v1/ai/balance?projectId=${encodeURIComponent(projectId)}`, {
    credentials: "include",
  });
  if (!res.ok) return null;
  return (await res.json()) as BalanceBreakdown;
}

export async function setPreferredModel(modelId: string): Promise<boolean> {
  const res = await fetch(`${apiUrl()}/api/v1/ai/preferred-model`, {
    method: "PUT", credentials: "include", headers: JSON_HEADERS,
    body: JSON.stringify({ modelId }),
  });
  return res.ok;
}
