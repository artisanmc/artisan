import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuthStore } from "@/state/authStore";
import {
  getNetworkTransfer,
  acceptNetworkTransfer,
  type TransferInfo,
  type TransferState,
} from "@/lib/api/networks";

export const Route = createFileRoute("/transfer")({ component: TransferRoute });

type ViewState = "loading" | TransferInfo | "expired" | "consumed" | "not_found" | "accepted" | "error";

function TransferRoute() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const navigate = useNavigate();
  const token = new URLSearchParams(window.location.search).get("token");
  const [state, setState] = useState<ViewState>("loading");

  useEffect(() => {
    if (!currentUser) {
      navigate({ to: "/login", search: { next: `/transfer?token=${token}` } });
      return;
    }
    if (!token) {
      setState("not_found");
      return;
    }
    getNetworkTransfer(token)
      .then((r: TransferState) => setState(r))
      .catch(() => setState("error"));
  }, [currentUser, token, navigate]);

  if (state === "loading") {
    return <div className="p-8">Chargement…</div>;
  }
  if (state === "expired") {
    return <div className="p-8">Lien expiré.</div>;
  }
  if (state === "consumed") {
    return <div className="p-8">Ce lien a déjà été utilisé.</div>;
  }
  if (state === "not_found") {
    return <div className="p-8">Lien introuvable.</div>;
  }
  if (state === "error") {
    return <div className="p-8">Erreur lors du chargement du transfert.</div>;
  }
  if (state === "accepted") {
    return <div className="p-8">Transfert accepté ! Redirection…</div>;
  }

  const info = state; // TransferInfo
  return (
    <div className="p-8 max-w-md mx-auto">
      <h1 className="text-2xl mb-3">Transférer la propriété</h1>
      <p className="mb-2">
        Tu vas devenir owner de <strong>{info.networkName}</strong>.
      </p>
      <p className="text-zinc-400 mb-4 text-sm">
        {info.packCount} packs · {info.serverKeyCount} server_keys
      </p>
      <button
        onClick={async () => {
          if (!token) return;
          try {
            const result = await acceptNetworkTransfer(token);
            setState("accepted");
            setTimeout(() => {
              navigate({
                to: "/networks/$networkId",
                params: { networkId: result.networkId },
              });
            }, 1500);
          } catch {
            setState("error");
          }
        }}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        Accepter
      </button>
    </div>
  );
}

export default TransferRoute;
