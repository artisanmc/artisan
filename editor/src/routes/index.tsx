import { LandingPage } from "@/features/marketing/LandingPage";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomeRoute,
});

export function HomeRoute() {
  return <LandingPage />;
}
