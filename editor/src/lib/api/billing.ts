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
export interface PlanLimits {
  resourcesPerServer: number | null;
  servers: number | null;
  collaborators: number | null;
}
export interface PlanDto {
  key: string;
  version: number;
  managedBy: "code" | "admin";
  audience: "public" | "private";
  targetNetworkId: string | null;
  publicationStatus: "draft" | "published";
  creditInterval: "month" | "year" | "none";
  limits: PlanLimits;
  capabilities: { editorPro: boolean };
  id: string;
  name: string;
  interval: string;
  priceCents: number;
  currency: string;
  creditsPerPeriod: number;
  rolloverCap: number;
  features: string;
  description?: string;
  highlighted?: boolean;
  sortOrder?: number;
  editorPro?: boolean;
  purchasable?: boolean;
}
export interface SubscriptionDto {
  effectivePlan?: {
    id: string | null;
    key: string;
    name: string;
    limits: PlanLimits;
    capabilities: { editorPro: boolean };
  };
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
  return getJson<BalanceBreakdown>(
    `/api/v1/billing/balance?networkId=${encodeURIComponent(networkId)}`,
  );
}

export async function getProjects(): Promise<PackDto[]> {
  const r = await getJson<{ packs: PackDto[] }>("/api/v1/billing/packs");
  if (!r) throw new Error("catalog_unavailable");
  return r.packs;
}

export async function getPlans(networkId?: string): Promise<PlanDto[]> {
  const r = await getJson<{ plans: PlanDto[] }>(
    `/api/v1/billing/plans${networkId ? `?networkId=${encodeURIComponent(networkId)}` : ""}`,
  );
  if (!r) throw new Error("catalog_unavailable");
  return r.plans;
}

export interface EditorOffer {
  quota: number;
  proQuota: number;
  freeServers: number;
  proServers: number;
  freeCollaborators: number;
  proMonthlyPriceCents: number;
  proYearlyPriceCents: number;
  proCreditsPerMonth: number;
  currency: string;
}

export async function getEditorOffer(): Promise<EditorOffer> {
  const offer = await getJson<EditorOffer>("/api/v1/billing/editor-offer");
  if (!offer) throw new Error("catalog_unavailable");
  return offer;
}

export async function getSubscription(networkId: string): Promise<SubscriptionDto | null> {
  return getJson<SubscriptionDto>(
    `/api/v1/billing/subscription?networkId=${encodeURIComponent(networkId)}`,
  );
}

export async function getPurchases(networkId: string): Promise<PurchaseDto[]> {
  const r = await getJson<{ purchases: PurchaseDto[] }>(
    `/api/v1/billing/purchases?networkId=${encodeURIComponent(networkId)}`,
  );
  return r?.purchases ?? [];
}

export async function startPackCheckout(networkId: string, packId: string): Promise<string | null> {
  return postForUrl("/api/v1/billing/checkout/pack", { networkId, packId });
}

export async function startSubscriptionCheckout(
  networkId: string,
  planId: string,
): Promise<string | null> {
  return postForUrl("/api/v1/billing/checkout/subscription", { networkId, planId });
}

export async function openPortal(networkId: string): Promise<string | null> {
  return postForUrl("/api/v1/billing/portal", { networkId });
}
