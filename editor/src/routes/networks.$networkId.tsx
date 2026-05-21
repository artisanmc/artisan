import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getNetwork } from "@/lib/api/networks";

export const Route = createFileRoute("/networks/$networkId")({ component: NetworkDetailPage });

export function NetworkDetailPage() {
  const { networkId } = useParams({ strict: false }) as { networkId: string };
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getNetwork>> | null>(null);

  useEffect(() => {
    if (!networkId) return;
    getNetwork(networkId).then(setDetail).catch(console.error);
  }, [networkId]);

  if (!detail) return <div className="p-8">Loading…</div>;

  return (
    <div className="min-h-screen p-8 flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{detail.network.name}</h1>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground mb-2">Packs</h2>
        {detail.packs.length === 0 ? (
          <div className="text-muted-foreground">No packs yet.</div>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.packs.map((p) => (
              <li key={p.id}>
                <Link to="/pack/$packId" params={{ packId: p.id }} className="block p-2 border rounded hover:bg-muted">
                  {p.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground mb-2">Server keys</h2>
        {detail.serverKeys.length === 0 ? (
          <div className="text-muted-foreground">No server keys yet.</div>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.serverKeys.map((sk) => (
              <li key={sk.id} className="p-2 border rounded">
                <div className="font-mono text-xs">{sk.id}</div>
                <div className="text-xs text-muted-foreground">{sk.label ?? "(no label)"}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
