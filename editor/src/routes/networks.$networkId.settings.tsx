import { createFileRoute, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { initNetworkTransfer } from "@/lib/api/networks";

export const Route = createFileRoute("/networks/$networkId/settings")({ component: SettingsRoute });

function SettingsRoute() {
  const { networkId } = useParams({ from: "/networks/$networkId/settings" });
  const [transferUrl, setTransferUrl] = useState<string | null>(null);
  const [transferExpires, setTransferExpires] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    setError(null);
    setGenerating(true);
    try {
      const r = await initNetworkTransfer(networkId);
      setTransferUrl(r.url);
      setTransferExpires(r.expiresAt);
    } catch {
      setError("Erreur lors de la génération du lien.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="p-8 max-w-2xl mx-auto grid gap-8">
      <h1 className="text-2xl">Settings</h1>

      <section className="grid gap-3">
        <h2 className="text-lg">Transférer la propriété</h2>
        <p className="text-sm text-zinc-400">
          Génère un lien à partager avec le nouvel owner. TTL 24h. Une fois accepté, tu perdras
          tous tes droits sur ce Network.
        </p>
        <div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded disabled:opacity-50"
          >
            {generating ? "Génération…" : "Générer un lien"}
          </button>
        </div>
        {transferUrl && (
          <div className="grid gap-1">
            <label className="text-xs text-zinc-500">Partage ce lien :</label>
            <input
              readOnly
              value={transferUrl}
              onClick={(e) => (e.target as HTMLInputElement).select()}
              className="w-full font-mono text-xs px-2 py-1.5 bg-zinc-900 border border-zinc-700 rounded"
            />
            {transferExpires && (
              <p className="text-xs text-zinc-500">
                Expire le {new Date(transferExpires).toLocaleString()}.
              </p>
            )}
          </div>
        )}
        {error && <p className="text-red-400 text-sm">{error}</p>}
      </section>
    </div>
  );
}

export default SettingsRoute;
