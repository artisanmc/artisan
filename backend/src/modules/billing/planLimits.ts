export const planLimits = {
  free: { resourcesPerServer: 10, servers: 2, collaborators: 2 },
  pro: { resourcesPerServer: 250, servers: 10, collaborators: null },
} as const;

export const proPricing = {
  currency: "eur",
  monthlyPriceCents: 900,
  yearlyPriceCents: 7000,
  creditsPerMonth: 500,
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
