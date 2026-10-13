import { Navigate, Outlet, createFileRoute, useChildMatches } from "@tanstack/react-router";

export const Route = createFileRoute("/networks")({ component: NetworksPage });

export function NetworksPage() {
  const childMatches = useChildMatches();
  if (childMatches.length > 0) return <Outlet />;
  return <Navigate to="/" replace />;
}
