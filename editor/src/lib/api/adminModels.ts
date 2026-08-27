const apiUrl = (): string =>
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001";

export type AiModelBadge = "cheap" | "balanced" | "premium";

export interface AiModelDto {
  id: string; displayName: string; description: string; badge: AiModelBadge;
  provider: string; providerModelId: string;
  creditsPerMInput: number; creditsPerMOutput: number;
  realUsdPerMInput: number; realUsdPerMOutput: number;
  isActive: boolean; isDefault: boolean; createdAt: string; updatedAt: string;
}
export type AiModelInput = Omit<AiModelDto, "id" | "isDefault" | "createdAt" | "updatedAt">;
export interface ProviderDto { label: string; baseUrl: string; keySet: boolean; preset: boolean }
export interface AiSettingsDto {
  creditUsdMicroRate: number;
  maxCreditsPerTurn: number | null;
  pricingMarginPct: number;
}
export interface ModelTestResult {
  ok: boolean; latencyMs?: number; inputTokens?: number; outputTokens?: number;
  creditsCost?: number; realCostMicroUsd?: number; error?: string;
}
export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error?: string };

async function mutate<T>(path: string, method: string, body?: unknown): Promise<Result<T>> {
  const res = await fetch(`${apiUrl()}${path}`, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, status: res.status, error: err.error };
  }
  return { ok: true, data: (await res.json()) as T };
}

export async function listModels(): Promise<AiModelDto[] | null> {
  const res = await fetch(`${apiUrl()}/api/v1/admin/ai/models`, { credentials: "include" });
  if (!res.ok) return null;
  return ((await res.json()) as { models: AiModelDto[] }).models;
}
export const createModel = (input: AiModelInput) => mutate<AiModelDto>("/api/v1/admin/ai/models", "POST", input);
export const updateModel = (id: string, patch: Partial<AiModelInput>) =>
  mutate<AiModelDto>(`/api/v1/admin/ai/models/${id}`, "PUT", patch);
export const setDefaultModel = (id: string) =>
  mutate<{ ok: true }>(`/api/v1/admin/ai/models/${id}/default`, "PUT");

export async function testModel(id: string): Promise<ModelTestResult> {
  const res = await fetch(`${apiUrl()}/api/v1/admin/ai/models/${id}/test`, {
    method: "POST", credentials: "include",
  });
  if (res.status === 404) return { ok: false, error: "not_found" };
  return (await res.json()) as ModelTestResult;
}

export async function listProviders(): Promise<Record<string, ProviderDto> | null> {
  const res = await fetch(`${apiUrl()}/api/v1/admin/ai/providers`, { credentials: "include" });
  if (!res.ok) return null;
  return ((await res.json()) as { providers: Record<string, ProviderDto> }).providers;
}
export const putProvider = (slug: string, body: { label?: string; baseUrl?: string; apiKey?: string }) =>
  mutate<{ ok: true }>(`/api/v1/admin/ai/providers/${slug}`, "PUT", body);

export async function getAiSettings(): Promise<AiSettingsDto | null> {
  const res = await fetch(`${apiUrl()}/api/v1/admin/ai/settings`, { credentials: "include" });
  if (!res.ok) return null;
  return (await res.json()) as AiSettingsDto;
}
export const putAiSettings = (patch: Partial<AiSettingsDto>) =>
  mutate<AiSettingsDto>("/api/v1/admin/ai/settings", "PUT", patch);
