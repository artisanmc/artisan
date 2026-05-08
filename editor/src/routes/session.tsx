import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type RefObject, useEffect, useRef, useState } from "react";
import { exchangeEditorSession, validateEditorSession, refreshEditorSession } from "@/lib/editorSession";
import { EditorWs } from "@/lib/editorWs";
import { loadPacks, savePack } from "@/lib/packApi";
import { transform } from "@/features/export/transform";
import { useAccountStore } from "@/state/accountStore";
import { useSessionStore } from "@/state/sessionStore";
import type { PackId, AccountId } from "@/domain/types";

export const Route = createFileRoute("/session")({
  component: SessionPage,
});

function SessionPage() {
  const tokenRef = useRef<string | null>(null);
  const [state, setState] = useState<"loading" | "invalid" | "expired" | "already_used" | "empty">("loading");
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const wsRef = useRef<EditorWs | null>(null);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const navigate = useNavigate();
  const setSession = useSessionStore((s) => s.setSession);
  const clearSession = useSessionStore((s) => s.clearSession);
  const setTrusted = useSessionStore((s) => s.setTrusted);

  useEffect(() => {
    mountedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");

    (async () => {
      try {
        let accessToken: string;

        if (urlToken) {
          // Fresh link — exchange the one-time url token
          history.replaceState({}, "", "/session");
          try {
            const result = await exchangeEditorSession(urlToken);
            accessToken = result.access_token;
          } catch (e) {
            if (!mountedRef.current) return;
            setState(e instanceof Error && e.message === "already_used" ? "already_used" : "invalid");
            return;
          }
        } else {
          // Page refresh — try cookie-based refresh
          const newToken = await refreshEditorSession();
          if (!newToken) {
            if (mountedRef.current) setState("expired");
            return;
          }
          accessToken = newToken;
        }

        if (!mountedRef.current) return;
        tokenRef.current = accessToken;

        const info = await validateEditorSession(accessToken);
        if (!mountedRef.current) return;
        const trustCode = info.trust_code;

        const packs = await loadPacks(accessToken);
        if (!mountedRef.current) return;

        useAccountStore.getState().setAccount({
          id: info.server_key_id as AccountId,
          packs,
          packOrder: packs.map((p) => p.id as PackId),
        });

        setSession(accessToken, info.server_key_id, trustCode, info.trusted);

        wsRef.current = new EditorWs(
          accessToken,
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
          () => {
            if (!mountedRef.current) return;
            setTrusted(true);
          },
        );

        // Silent refresh every 4 minutes
        refreshRef.current = setInterval(async () => {
          const newToken = await refreshEditorSession();
          if (!newToken) { clearSession(); setState("expired"); return; }
          tokenRef.current = newToken;
          setSession(newToken, info.server_key_id, trustCode, useSessionStore.getState().trusted);
        }, 4 * 60 * 1000);

        const firstPack = packs[0];
        if (firstPack) {
          await navigate({ to: "/pack/$packId", params: { packId: firstPack.id } });
        } else {
          setState("empty");
        }
      } catch {
        if (mountedRef.current) {
          clearSession();
          setState("invalid");
        }
      }
    })();

    return () => {
      mountedRef.current = false;
      wsRef.current?.disconnect();
      if (refreshRef.current) clearInterval(refreshRef.current);
    };
  }, [navigate, setSession, clearSession, setTrusted]);

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

  if (state === "already_used") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-destructive text-lg">Lien déjà utilisé.</p>
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
    return <EmptyState tokenRef={tokenRef} navigate={navigate} />;
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

function EmptyState({
  tokenRef,
  navigate,
}: {
  tokenRef: RefObject<string | null>;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const createPack = useAccountStore((s) => s.createPack);

  const submit = async () => {
    const trimmed = id.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const packId = createPack({ id: trimmed });
      const pack = useAccountStore.getState().account.packs.find((p) => p.id === packId)!;
      const files = transform(pack);
      await savePack(tokenRef.current!, pack, files);
      await navigate({ to: "/pack/$packId", params: { packId } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <p className="text-lg font-medium">Aucun pack</p>
      <p className="text-muted-foreground text-sm">Créez votre premier pack pour commencer.</p>
      <div className="flex gap-2">
        <input
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          placeholder="my_pack"
          value={id}
          onChange={(e) => setId(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          autoFocus
        />
        <button
          type="button"
          onClick={submit}
          disabled={!id.trim() || busy}
          className="rounded border border-emerald-600/60 bg-emerald-600/10 px-4 py-2 text-sm text-emerald-200 hover:bg-emerald-600/20 disabled:opacity-40"
        >
          Créer
        </button>
      </div>
    </div>
  );
}
