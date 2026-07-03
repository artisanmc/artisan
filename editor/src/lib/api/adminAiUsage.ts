import type { Result } from "./adminModels";

const apiUrl = (): string =>
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001";

export interface SumRow { inputTokens: number; outputTokens: number; creditsCharged: number; realCostMicroUsd: number; turns: number }
export interface UsageSummary {
  totals: { inputTokens: number; outputTokens: number; cachedInputTokens: number; creditsCharged: number; realCostMicroUsd: number; marginMicroUsd: number; turns: number; errors: number };
  byModel: (SumRow & { modelId: string | null; modelName: string; provider: string })[];
  byProvider: (SumRow & { provider: string })[];
  daily: (SumRow & { date: string })[];
}
export interface UsageLogDto {
  id: string; createdAt: string; networkId: string; userId: string | null; serverKeyId: string | null;
  modelId: string | null; modelName: string; provider: string; providerModelId: string; actionType: string;
  status: "success" | "error"; inputTokens: number; outputTokens: number; cachedInputTokens: number;
  creditsCharged: number; realCostMicroUsd: number; durationMs: number | null; errorMessage: string | null; promptPreview: string;
}
export interface UsageFilters {
  userId?: string; modelId?: string; provider?: string; actionType?: string;
  status?: string; from?: string; to?: string;
}
export interface LedgerGrant { id: string; delta: number; reason: string; note: string | null; createdBy: string | null; createdAt: string }
export interface UserFocusDto {
  totals: { inputTokens: number; outputTokens: number; creditsCharged: number; realCostMicroUsd: number; turns: number; errors: number };
  byModel: (SumRow & { modelId: string | null; modelName: string; provider: string })[];
  networks: { id: string; name: string; balance: number; grants: LedgerGrant[] }[];
}

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export async function getUsageSummary(from?: string, to?: string): Promise<UsageSummary | null> {
  const res = await fetch(`${apiUrl()}/api/v1/admin/ai/usage/summary${qs({ from, to })}`, { credentials: "include" });
  if (!res.ok) return null;
  return (await res.json()) as UsageSummary;
}

export async function getUsageLogs(
  filters: UsageFilters, cursor?: string, limit?: number,
): Promise<{ logs: UsageLogDto[]; nextCursor: string | null } | null> {
  const res = await fetch(
    `${apiUrl()}/api/v1/admin/ai/usage/logs${qs({ ...filters, cursor, limit: limit?.toString() })}`,
    { credentials: "include" },
  );
  if (!res.ok) return null;
  return (await res.json()) as { logs: UsageLogDto[]; nextCursor: string | null };
}

export function usageLogsCsvUrl(filters: UsageFilters): string {
  return `${apiUrl()}/api/v1/admin/ai/usage/logs${qs({ ...filters, format: "csv" })}`;
}

export async function getUserFocus(userId: string, from?: string, to?: string): Promise<UserFocusDto | null> {
  const res = await fetch(`${apiUrl()}/api/v1/admin/ai/users/${userId}${qs({ from, to })}`, { credentials: "include" });
  if (!res.ok) return null;
  return (await res.json()) as UserFocusDto;
}

export async function grantCredits(networkId: string, amount: number, note?: string): Promise<Result<{ ok: true; balance: number }>> {
  const res = await fetch(`${apiUrl()}/api/v1/admin/ai/credits/grant`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ networkId, amount, ...(note ? { note } : {}) }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, status: res.status, error: err.error };
  }
  return { ok: true, data: (await res.json()) as { ok: true; balance: number } };
}
