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
      <h1 className="text-2xl font-semibold mb-4">Mes Networks</h1>
      {networks.length === 0 ? (
        <div className="text-muted-foreground">
          <p className="mb-3">Aucun Network. Lance <code className="bg-zinc-800 px-1 rounded text-sm">/artisan setup</code> sur ton serveur Minecraft pour commencer.</p>
          <Link to="/setup" className="underline">Créer un Network</Link>
        </div>
      ) : (
        <ul className="grid gap-3">
          {networks.map((n) => (
            <li key={n.id}>
              <Link to="/networks/$networkId" params={{ networkId: n.id }} className="block p-4 border border-zinc-700 rounded hover:border-zinc-500 transition">
                <div className="font-medium">{n.name}</div>
                <div className="text-xs text-muted-foreground">Tier: {n.tier}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link to="/setup" className="mt-4 inline-block underline">+ Ajouter un serveur</Link>
    </div>
  );
}
