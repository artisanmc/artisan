import { STANDARD_CATALOG } from "./catalog";

export const planLimits = {
  free: STANDARD_CATALOG[0].limits,
  pro: STANDARD_CATALOG[1].limits,
} as const;

export const proPricing = {
  currency: "eur",
  monthlyPriceCents: STANDARD_CATALOG[1].priceCents,
  yearlyPriceCents: STANDARD_CATALOG[2].priceCents,
  creditsPerMonth: STANDARD_CATALOG[1].creditsPerPeriod,
} as const;

export function withinPlanLimit(current: number, limit: number | null): boolean {
  return limit === null || current < limit;
}

export function collaboratorCount(roles: readonly string[]): number {
  return roles.length - (roles.includes("owner") ? 1 : 0);
}

export class PlanLimitError extends Error {
  constructor(public readonly code: "server_limit_reached" | "collaborator_limit_reached") {
    super(code);
  }
}
