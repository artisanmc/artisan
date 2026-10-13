import { Navigate, Outlet, createFileRoute, useChildMatches } from "@tanstack/react-router";

export const Route = createFileRoute("/networks/$networkId")({ component: NetworkDetailPage });

/** Le plugin ne sert qu'un réseau : la liste de ses serveurs vit dans la barre latérale. */
export function NetworkDetailPage() {
  const childMatches = useChildMatches();
  if (childMatches.length > 0) return <Outlet />;
  return <Navigate to="/" replace />;
}
