import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getNetwork, deleteServerKey } from "@/lib/api/networks";

export const Route = createFileRoute("/networks/$networkId")({ component: NetworkDetailPage });

type NetworkDetail = Awaited<ReturnType<typeof getNetwork>>;

export function NetworkDetailPage() {
  const { networkId } = useParams({ strict: false }) as { networkId: string };
  const [detail, setDetail] = useState<NetworkDetail | null>(null);

  useEffect(() => {
    if (!networkId) return;
    getNetwork(networkId).then(setDetail).catch(console.error);
  }, [networkId]);

  if (!detail) return <div className="p-8">Chargement…</div>;

  const handleDeleteKey = async (keyId: string) => {
    if (!window.confirm("Supprimer cette server_key ? Le serveur perdra l'accès.")) return;
    await deleteServerKey(networkId, keyId);
    setDetail({
      ...detail,
      serverKeys: detail.serverKeys.filter((k) => k.id !== keyId),
    });
  };

  return (
    <div className="min-h-screen p-8 max-w-3xl mx-auto flex flex-col gap-8">
      <header className="flex justify-between items-baseline">
        <h1 className="text-2xl font-semibold">{detail.network.name}</h1>
        <Link
          to="/networks/$networkId/settings"
          params={{ networkId }}
          className="text-sm text-zinc-400 hover:text-zinc-200"
        >
          Settings →
        </Link>
      </header>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground mb-3">Packs</h2>
        {detail.packs.length === 0 ? (
          <p className="text-muted-foreground">Aucun pack.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.packs.map((p) => (
              <li key={p.id}>
                <Link
                  to="/pack/$packId"
                  params={{ packId: p.id }}
                  className="block p-3 border border-zinc-700 rounded hover:border-zinc-500 transition"
                >
                  {p.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground mb-3">Server Keys</h2>
        {detail.serverKeys.length === 0 ? (
          <p className="text-muted-foreground">Aucune server_key.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.serverKeys.map((sk) => (
              <li
                key={sk.id}
                className="flex justify-between items-center p-3 border border-zinc-700 rounded"
              >
                <div>
                  <div className="font-mono text-sm">{sk.label ?? sk.id}</div>
                  {sk.label && (
                    <div className="text-xs text-muted-foreground font-mono">{sk.id}</div>
                  )}
                </div>
                <button
                  onClick={() => handleDeleteKey(sk.id)}
                  className="text-sm text-red-400 hover:text-red-300 transition"
                >
                  Supprimer
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground mb-3">Members</h2>
        {/* TODO: membres via un endpoint dédié (Phase 2) */}
        <p className="text-xs text-muted-foreground">Invitations à venir.</p>
      </section>
    </div>
  );
}

export default NetworkDetailPage;
