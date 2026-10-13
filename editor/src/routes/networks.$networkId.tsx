import { Navigate, Outlet, createFileRoute, useChildMatches } from "@tanstack/react-router";

export const Route = createFileRoute("/networks/$networkId")({ component: NetworkDetailPage });

/** The plugin serves a single network: its server list lives in the sidebar. */
export function NetworkDetailPage() {
  const childMatches = useChildMatches();
  if (childMatches.length > 0) return <Outlet />;
  return <Navigate to="/" replace />;
}
