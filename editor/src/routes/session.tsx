import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { validateEditorSession, refreshEditorSession } from "@/lib/editorSession";
import { EditorWs } from "@/lib/editorWs";

export const Route = createFileRoute("/session")({
  component: SessionPage,
});

function SessionPage() {
  const token = useRef<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "invalid" | "expired">("loading");
  const [serverKeyId, setServerKeyId] = useState("");
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const wsRef = useRef<EditorWs | null>(null);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    if (!t) { setState("invalid"); return; }
    token.current = t;

    history.replaceState({}, "", "/session");

    (async () => {
      try {
        const { server_key_id } = await validateEditorSession(t);
        if (!mountedRef.current) return;
        setServerKeyId(server_key_id);

        wsRef.current = new EditorWs(
          t,
          (_packId, menuId, _menuYaml, _updatedBy) => {
            if (!mountedRef.current) return;
            setDraftNotice(`Menu "${menuId}" mis à jour par un autre éditeur.`);
            setTimeout(() => setDraftNotice(null), 5000);
          },
          () => { if (mountedRef.current) setState("expired"); },
        );

        refreshRef.current = setInterval(() => {
          if (token.current) refreshEditorSession(token.current);
        }, 10 * 60 * 1000);

        setState("ready");
      } catch {
        if (mountedRef.current) setState("invalid");
      }
    })();

    return () => {
      mountedRef.current = false;
      wsRef.current?.disconnect();
      if (refreshRef.current) clearInterval(refreshRef.current);
    };
  }, []);

  if (state === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Chargement…</p>
      </div>
    );
  }

  if (state === "invalid") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-destructive text-lg">Session invalide.</p>
        <p className="text-muted-foreground text-sm">Relancez <code>/ifz editor</code> sur votre serveur Minecraft.</p>
      </div>
    );
  }

  if (state === "expired") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-lg font-medium">Session expirée</p>
        <p className="text-muted-foreground text-sm">Relancez <code>/ifz editor</code> sur votre serveur Minecraft pour obtenir un nouveau lien.</p>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen">
      {draftNotice && (
        <div className="fixed top-4 right-4 z-50 rounded bg-amber-50 border border-amber-200 px-4 py-2 text-sm text-amber-800 shadow">
          {draftNotice}
        </div>
      )}
      <p className="p-8 text-muted-foreground text-sm">
        Connecté — serveur <code>{serverKeyId}</code>
      </p>
    </div>
  );
}
