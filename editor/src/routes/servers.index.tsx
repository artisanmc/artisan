import { listServers } from "@/lib/api/servers";
import { Navigate, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/servers/")({ component: ServersPage });

/** Opens the hub's own server, listed first. */
export function ServersPage() {
  const [serverId, setServerId] = useState<string | null>(null);
  useEffect(() => {
    listServers()
      .then((servers) => setServerId(servers[0]?.id ?? null))
      .catch(console.error);
  }, []);
  if (!serverId) return null;
  return <Navigate to="/servers/$serverId" params={{ serverId }} replace />;
}
