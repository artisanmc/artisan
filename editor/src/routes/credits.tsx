import { CreditsPage } from "@/features/billing/CreditsPage";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/credits")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { checkout?: "success" | "cancel"; networkId?: string; plan?: string } => ({
    checkout:
      search.checkout === "success" || search.checkout === "cancel" ? search.checkout : undefined,
    networkId: typeof search.networkId === "string" ? search.networkId : undefined,
    plan: typeof search.plan === "string" ? search.plan : undefined,
  }),
  component: CreditsPage,
});
