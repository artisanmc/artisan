import { LandingPage } from "@/features/marketing/LandingPage";
import { LOCAL_ID, SELF_HOSTED } from "@/lib/selfHosted";
import { Navigate, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomeRoute,
});

export function HomeRoute() {
  if (SELF_HOSTED) {
    return (
      <Navigate
        to="/networks/$networkId/servers/$serverId"
        params={{ networkId: LOCAL_ID, serverId: LOCAL_ID }}
        replace
      />
    );
  }
  return <LandingPage />;
}
