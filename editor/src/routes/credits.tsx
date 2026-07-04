import { createFileRoute } from "@tanstack/react-router";
import { CreditsPage } from "@/features/billing/CreditsPage";

export const Route = createFileRoute("/credits")({ component: CreditsPage });
