import { LOCAL_ID } from "@/lib/localServer";
import { Navigate, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomeRoute,
});

export function HomeRoute() {
  return (
    <Navigate
      to="/networks/$networkId/servers/$serverId"
      params={{ networkId: LOCAL_ID, serverId: LOCAL_ID }}
      replace
    />
  );
}
