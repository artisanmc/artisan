import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { validateEditorSession, refreshEditorSession } from "@/lib/editorSession";
import { EditorWs } from "@/lib/editorWs";
import { loadPacks } from "@/lib/packApi";
import { useAccountStore } from "@/state/accountStore";
import { useSessionStore } from "@/state/sessionStore";
import type { PackId, AccountId } from "@/domain/types";

export const Route = createFileRoute("/session")({
  component: SessionPage,
});

function SessionPage() {
  const tokenRef = useRef<string | null>(null);
  const [state, setState] = useState<"loading" | "invalid" | "expired" | "empty">("loading");
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const wsRef = useRef<EditorWs | null>(null);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const navigate = useNavigate();
  const setSession = useSessionStore((s) => s.setSession);
  const clearSession = useSessionStore((s) => s.clearSession);

  useEffect(() => {
    mountedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    if (!t) { setState("invalid"); return; }
    tokenRef.current = t;

    // Strip token from URL bar
    history.replaceState({}, "", "/session");

    (async () => {
      try {
        const { server_key_id } = await validateEditorSession(t);
        if (!mountedRef.current) return;

        // Load packs from backend
        const packs = await loadPacks(t);
        if (!mountedRef.current) return;

        // Hydrate store
        useAccountStore.getState().setAccount({
          id: server_key_id as AccountId,
          packs,
          packOrder: packs.map((p) => p.id as PackId),
        });

        // Store session credentials for auto-save and route guards
        setSession(t, server_key_id);

        // Open editor WS for real-time draft updates
        wsRef.current = new EditorWs(
          t,
          (_packId, menuId, _menuYaml, _updatedBy) => {
            if (!mountedRef.current) return;
            setDraftNotice(`Menu "${menuId}" mis à jour par un autre éditeur.`);
            setTimeout(() => setDraftNotice(null), 5000);
          },
          () => {
            if (!mountedRef.current) return;
            clearSession();
            setState("expired");
          },
        );

        // Auto-refresh session every 10 min
        refreshRef.current = setInterval(() => {
          if (tokenRef.current) refreshEditorSession(tokenRef.current);
        }, 10 * 60 * 1000);

        // Navigate to first pack, or show empty state if none
        const firstPack = packs[0];
        if (firstPack) {
          await navigate({ to: "/pack/$packId", params: { packId: firstPack.id } });
        } else {
          setState("empty");
        }
      } catch {
        if (mountedRef.current) setState("invalid");
      }
    })();

    return () => {
      mountedRef.current = false;
      wsRef.current?.disconnect();
      if (refreshRef.current) clearInterval(refreshRef.current);
    };
  }, [navigate, setSession, clearSession]);

  if (state === "invalid") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-destructive text-lg">Session invalide.</p>
        <p className="text-muted-foreground text-sm">
          Relancez <code>/ifz editor</code> sur votre serveur Minecraft.
        </p>
      </div>
    );
  }

  if (state === "expired") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-lg font-medium">Session expirée</p>
        <p className="text-muted-foreground text-sm">
          Relancez <code>/ifz editor</code> sur votre serveur Minecraft pour obtenir un nouveau lien.
        </p>
      </div>
    );
  }

  if (state === "empty") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-lg font-medium">Aucun pack</p>
        <p className="text-muted-foreground text-sm">Créez votre premier pack depuis l'éditeur.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      {draftNotice && (
        <div className="fixed top-4 right-4 z-50 rounded bg-amber-50 border border-amber-200 px-4 py-2 text-sm text-amber-800 shadow">
          {draftNotice}
        </div>
      )}
      <p className="text-muted-foreground">Chargement…</p>
    </div>
  );
}
