import type { PlanLimits } from "./billing";
const apiUrl = (): string =>
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001";

export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error?: string };

export interface AdminPack {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  credits: number;
  bonusPct: number;
  isActive: boolean;
  sortOrder: number;
  stripeProductId: string | null;
  stripePriceId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface AdminPlan {
  key: string;
  version: number;
  managedBy: "code" | "admin";
  audience: "public" | "private";
  targetNetworkId: string | null;
  publicationStatus: "draft" | "published";
  creditInterval: "month" | "year" | "none";
  limits: PlanLimits;
  capabilities: { editorPro: boolean };
  stripeProvisioningStatus: "ready" | "pending" | "unavailable";
  id: string;
  name: string;
  interval: "month" | "year";
  priceCents: number;
  currency: string;
  creditsPerPeriod: number;
  rolloverCap: number;
  features: string;
  isActive: boolean;
  sortOrder: number;
  description: string;
  highlighted: boolean;
  editorPro: boolean;
  stripeProductId: string | null;
  stripePriceId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface PackInput {
  name: string;
  priceCents: number;
  currency?: string;
  credits: number;
  bonusPct?: number;
  isActive?: boolean;
  sortOrder?: number;
}
export interface PlanInput {
  sourcePlanId?: string;
  targetNetworkId?: string | null;
  creditInterval?: "month" | "year" | "none";
  limits?: PlanLimits;
  capabilities?: { editorPro: boolean };
  name: string;
  interval: "month" | "year";
  priceCents: number;
  currency?: string;
  creditsPerPeriod: number;
  rolloverCap?: number;
  features?: string;
  isActive?: boolean;
  sortOrder?: number;
  description?: string;
  highlighted?: boolean;
  editorPro?: boolean;
}

export interface SalesSummary {
  from: string;
  to: string;
  topups: { count: number; byCurrency: Record<string, number> };
  subscriptions: {
    activeCount: number;
    mrrByCurrency: Record<string, number>;
    perPlan: Array<{
      planId: string;
      planName: string;
      currency: string;
      priceCents: number;
      activeCount: number;
    }>;
  };
  daily: Array<{ date: string; topupCents: number; topupCount: number }>;
}

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

function qs(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined);
  if (entries.length === 0) return "";
  return `?${new URLSearchParams(entries).toString()}`;
}

export async function listPacks(): Promise<AdminPack[] | null> {
  const res = await fetch(`${apiUrl()}/api/v1/admin/billing/packs`, { credentials: "include" });
  if (!res.ok) return null;
  return ((await res.json()) as { packs: AdminPack[] }).packs;
}
export const createPack = (input: PackInput) =>
  mutate<AdminPack>("/api/v1/admin/billing/packs", "POST", input);
export const updatePack = (id: string, patch: Partial<PackInput>) =>
  mutate<AdminPack>(`/api/v1/admin/billing/packs/${id}`, "PUT", patch);
// NOTE: the backend deactivate route returns only `{ ok: true }`, not the full
// object — check `.ok` and reload the list; do NOT read `.data` fields here.
export const deactivatePack = (id: string) =>
  mutate<AdminPack>(`/api/v1/admin/billing/packs/${id}/deactivate`, "POST");

export async function listPlans(): Promise<AdminPlan[] | null> {
  const res = await fetch(`${apiUrl()}/api/v1/admin/billing/plans`, { credentials: "include" });
  if (!res.ok) return null;
  return ((await res.json()) as { plans: AdminPlan[] }).plans;
}
export const createPlan = (input: PlanInput) =>
  mutate<AdminPlan>("/api/v1/admin/billing/plans", "POST", input);
export const updatePlan = (id: string, patch: Partial<PlanInput>) =>
  mutate<AdminPlan>(`/api/v1/admin/billing/plans/${id}`, "PUT", patch);
// NOTE: backend returns only `{ ok: true }` — check `.ok` + reload, don't read `.data`.
export const deactivatePlan = (id: string) =>
  mutate<AdminPlan>(`/api/v1/admin/billing/plans/${id}/deactivate`, "POST");

export const publishPlan = (id: string) =>
  mutate<AdminPlan>(`/api/v1/admin/billing/plans/${id}/publish`, "POST");
export const provisionPlans = () =>
  mutate<{
    results: { planId: string; status: "ready" | "unavailable" | "error"; error?: string }[];
  }>("/api/v1/admin/billing/plans/provision", "POST");

export async function getSales(from?: string, to?: string): Promise<SalesSummary | null> {
  const res = await fetch(`${apiUrl()}/api/v1/admin/billing/sales${qs({ from, to })}`, {
    credentials: "include",
  });
  if (!res.ok) return null;
  return (await res.json()) as SalesSummary;
}

export const grantCredits = (networkId: string, amount: number, note?: string) =>
  mutate<{ ok: true; balance: number }>("/api/v1/admin/billing/grant", "POST", {
    networkId,
    amount,
    note,
  });
