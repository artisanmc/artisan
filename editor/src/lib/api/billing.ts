const apiUrl = (): string =>
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001";

async function getJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${apiUrl()}${path}`, { credentials: "include" });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

async function postForUrl(path: string, body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch(`${apiUrl()}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  return ((await res.json()) as { url?: string }).url ?? null;
}

export interface BalanceBreakdown {
  total: number;
  subscription: number;
  rollover: number;
  topup: number;
  subscriptionQuota?: number;
  periodEnd?: string | null;
}
export interface PackDto {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  credits: number;
  bonusPct: number;
  creditsGranted: number;
}
export interface PlanDto {
  id: string;
  name: string;
  interval: string;
  priceCents: number;
  currency: string;
  creditsPerPeriod: number;
  rolloverCap: number;
  features: string;
}
export interface SubscriptionDto {
  status: string | null;
  planId?: string | null;
  planName?: string | null;
  currentPeriodEnd?: string | null;
  graceUntil?: string | null;
}
export interface PurchaseDto {
  id: string;
  amountCents: number;
  currency: string;
  credits: number;
  stripeInvoiceUrl: string | null;
  createdAt: string;
}

export async function getBillingBalance(networkId: string): Promise<BalanceBreakdown | null> {
  return getJson<BalanceBreakdown>(`/api/v1/billing/balance?networkId=${encodeURIComponent(networkId)}`);
}

export async function getProjects(): Promise<PackDto[]> {
  const r = await getJson<{ projects: PackDto[] }>(`/api/v1/billing/projects`);
  return r?.projects ?? [];
}

export async function getPlans(): Promise<PlanDto[]> {
  const r = await getJson<{ plans: PlanDto[] }>(`/api/v1/billing/plans`);
  return r?.plans ?? [];
}

export async function getSubscription(networkId: string): Promise<SubscriptionDto | null> {
  return getJson<SubscriptionDto>(`/api/v1/billing/subscription?networkId=${encodeURIComponent(networkId)}`);
}

export async function getPurchases(networkId: string): Promise<PurchaseDto[]> {
  const r = await getJson<{ purchases: PurchaseDto[] }>(
    `/api/v1/billing/purchases?networkId=${encodeURIComponent(networkId)}`,
  );
  return r?.purchases ?? [];
}

export async function startPackCheckout(networkId: string, projectId: string): Promise<string | null> {
  return postForUrl(`/api/v1/billing/checkout/project`, { networkId, projectId });
}

export async function startSubscriptionCheckout(networkId: string, planId: string): Promise<string | null> {
  return postForUrl(`/api/v1/billing/checkout/subscription`, { networkId, planId });
}

export async function openPortal(networkId: string): Promise<string | null> {
  return postForUrl(`/api/v1/billing/portal`, { networkId });
}
