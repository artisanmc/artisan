import { getNetwork } from "@/lib/api/networks";
import { Navigate, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/servers/")({ component: ServersPage });

/** The hub serves a single network: open its own server, listed first. */
export function ServersPage() {
  const [serverId, setServerId] = useState<string | null>(null);
  useEffect(() => {
    getNetwork()
      .then((d) => setServerId(d.serverKeys[0]?.id ?? null))
      .catch(console.error);
  }, []);
  if (!serverId) return null;
  return <Navigate to="/servers/$serverId" params={{ serverId }} replace />;
}
