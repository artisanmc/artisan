import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuthStore } from "@/state/authStore";
import {
  listNetworks,
  claimLinkCode,
  ClaimError,
  type NetworkSummary,
} from "@/lib/api/networks";

export const Route = createFileRoute("/link")({ component: LinkRoute });

type Status = "loading" | "ready" | "claiming" | "done" | "error";

function LinkRoute() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const isAuthLoading = useAuthStore((s) => s.isLoading);
  const navigate = useNavigate();
  const code = new URLSearchParams(window.location.search).get("code")?.toUpperCase() ?? null;
  const [networks, setNetworks] = useState<NetworkSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthLoading) return;
    if (!currentUser) {
      navigate({ to: "/login", search: { next: `/link?code=${code}` } });
      return;
    }
    if (!code) {
      setStatus("error");
      setErrorMessage("Code manquant dans l'URL.");
      return;
    }
    listNetworks()
      .then(async (nets) => {
        setNetworks(nets);
        if (nets.length === 0) {
          // Auto-create + claim (backend creates "Mon Network" automatically)
          try {
            await claimLinkCode(code);
            setStatus("done");
          } catch (e) {
            setStatus("error");
            setErrorMessage(e instanceof ClaimError ? e.code : "Erreur inconnue");
          }
        } else if (nets.length === 1) {
          setSelectedId(nets[0].id);
          setStatus("ready");
        } else {
          setStatus("ready");
        }
      })
      .catch(() => {
        setStatus("error");
        setErrorMessage("Impossible de charger les networks.");
      });
  }, [currentUser, isAuthLoading, code, navigate]);

  const handleConfirm = async () => {
    if (!selectedId || !code) return;
    setStatus("claiming");
    try {
      await claimLinkCode(code, selectedId);
      setStatus("done");
    } catch (e) {
      setStatus("error");
      setErrorMessage(e instanceof ClaimError ? e.code : "Erreur inconnue");
    }
  };

  if (status === "loading") return <div className="p-8">Chargement…</div>;
  if (status === "claiming") return <div className="p-8">Liaison en cours…</div>;
  if (status === "done")
    return (
      <div className="p-8">
        <h1 className="text-2xl mb-2">Setup terminé !</h1>
        <p>Retourne sur ton serveur Minecraft — il est maintenant lié.</p>
      </div>
    );
  if (status === "error")
    return (
      <div className="p-8">
        <h1 className="text-2xl mb-2">Échec du setup</h1>
        <p>{errorMessage ?? "Erreur inconnue."}</p>
        <p>
          Retape <code>/ifz setup</code> sur ton serveur Minecraft pour obtenir un nouveau lien.
        </p>
      </div>
    );

  // status === "ready"
  if (!networks || networks.length === 0) return null;

  if (networks.length === 1) {
    return (
      <div className="p-8 max-w-md mx-auto">
        <h1 className="text-2xl mb-4">Lier ce serveur</h1>
        <p className="mb-4">
          Lier ce serveur à <strong>{networks[0].name}</strong> ?
        </p>
        <button onClick={handleConfirm} className="px-4 py-2 bg-blue-600 text-white rounded">
          Confirmer
        </button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-md mx-auto">
      <h1 className="text-2xl mb-4">Choisis le Network destination</h1>
      <ul className="grid gap-2 mb-4">
        {networks.map((n) => (
          <li key={n.id}>
            <button
              onClick={() => setSelectedId(n.id)}
              className={`w-full text-left p-3 border rounded ${
                selectedId === n.id ? "border-blue-500 bg-blue-50" : "border-zinc-700"
              }`}
            >
              {n.name} {selectedId === n.id && "✓"}
            </button>
          </li>
        ))}
      </ul>
      <button
        onClick={handleConfirm}
        disabled={!selectedId}
        className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
      >
        Confirmer
      </button>
    </div>
  );
}

export default LinkRoute;
