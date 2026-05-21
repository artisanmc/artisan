import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useNetworksStore } from "@/state/networksStore";
import { listNetworks } from "@/lib/api/networks";

export const Route = createFileRoute("/networks")({ component: NetworksPage });

export function NetworksPage() {
  const networks = useNetworksStore((s) => s.networks);
  const setNetworks = useNetworksStore((s) => s.setNetworks);

  useEffect(() => {
    listNetworks().then(setNetworks).catch(console.error);
  }, [setNetworks]);

  return (
    <div className="min-h-screen p-8">
      <h1 className="text-xl font-semibold mb-4">Your Networks</h1>
      {networks.length === 0 ? (
        <div className="text-muted-foreground">
          No networks yet. <Link to="/setup" className="underline">Create your first network</Link>.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {networks.map((n) => (
            <li key={n.id}>
              <Link to="/networks/$networkId" params={{ networkId: n.id }} className="block p-3 border rounded hover:bg-muted">
                <div className="font-medium">{n.name}</div>
                <div className="text-xs text-muted-foreground">Tier: {n.tier}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link to="/setup" className="mt-4 inline-block underline">+ New network / server</Link>
    </div>
  );
}
