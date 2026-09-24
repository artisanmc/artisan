import { PricingPage } from "@/features/marketing/PricingPage";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/pricing")({
  validateSearch: (search: Record<string, unknown>): { plan?: string } => ({
    plan: typeof search.plan === "string" ? search.plan : undefined,
  }),
  component: PricingPage,
});
