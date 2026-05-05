import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { claimLinkCode, createLinkCode, getLinkStatus, type LinkCodeResponse } from "@/lib/linkApi";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/link")({
  component: LinkPage,
});

function LinkPage() {
  const search = new URLSearchParams(window.location.search);
  const codeFromUrl = search.get("code")?.toUpperCase() ?? null;
  return codeFromUrl ? <ClaimFlow code={codeFromUrl} /> : <GenerateFlow />;
}

// ── B1: browser claims the plugin's code ────────────────────────────────────

function ClaimFlow({ code }: { code: string }) {
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");

  async function claim() {
    setState("loading");
    try {
      await claimLinkCode(code);
      setState("success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setState("error");
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Lier un serveur Minecraft</h1>

      {state === "idle" && (
        <>
          <p className="text-muted-foreground max-w-sm text-center">
            Code de liaison : <span className="font-mono font-bold">{code}</span>
          </p>
          <p className="text-muted-foreground max-w-sm text-center text-sm">
            Ce code a été généré sur votre serveur via <code>/ifz setup</code>. Cliquez pour valider
            le lien.
          </p>
          <Button onClick={claim}>Lier ce serveur</Button>
        </>
      )}

      {state === "loading" && <p className="text-muted-foreground">Liaison en cours…</p>}

      {state === "success" && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-lg font-medium text-green-600">Serveur lié ✓</p>
          <p className="text-muted-foreground text-sm">
            Votre plugin a reçu sa clé et se reconnecte automatiquement.
          </p>
        </div>
      )}

      {state === "error" && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-destructive">{error}</p>
          <Button variant="outline" onClick={() => setState("idle")}>
            Réessayer
          </Button>
        </div>
      )}
    </div>
  );
}

// ── B2: browser generates the code, admin enters it on the server ────────────

function GenerateFlow() {
  const [linkCode, setLinkCode] = useState<LinkCodeResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "pending" | "claimed" | "expired">("idle");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function generate() {
    setStatus("loading");
    try {
      const data = await createLinkCode();
      setLinkCode(data);
      setStatus("pending");
      pollRef.current = setInterval(async () => {
        const s = await getLinkStatus(data.code);
        if (s.status === "claimed") {
          setStatus("claimed");
          clearInterval(pollRef.current!);
        } else if (s.status === "expired") {
          setStatus("expired");
          clearInterval(pollRef.current!);
        }
      }, 2_000);
    } catch {
      setStatus("idle");
    }
  }

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Ajouter un serveur Minecraft</h1>

      {status === "idle" && (
        <>
          <p className="text-muted-foreground max-w-sm text-center text-sm">
            Générez un code de liaison, puis tapez la commande affichée sur votre serveur Minecraft.
          </p>
          <Button onClick={generate}>Générer un code</Button>
        </>
      )}

      {status === "loading" && <p className="text-muted-foreground">Génération…</p>}

      {status === "pending" && linkCode && (
        <div className="flex flex-col items-center gap-4">
          <p className="text-muted-foreground text-sm">
            Tapez cette commande sur votre serveur Minecraft :
          </p>
          <code className="rounded bg-muted px-4 py-3 text-lg font-bold tracking-wider">
            /ifz setup {linkCode.code}
          </code>
          <p className="text-muted-foreground text-xs animate-pulse">En attente de connexion…</p>
        </div>
      )}

      {status === "claimed" && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-lg font-medium text-green-600">Serveur lié ✓</p>
          <p className="text-muted-foreground text-sm">
            Le plugin a reçu sa clé et se reconnecte automatiquement.
          </p>
        </div>
      )}

      {status === "expired" && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-muted-foreground">Le code a expiré (10 minutes).</p>
          <Button onClick={() => { setStatus("idle"); setLinkCode(null); }}>
            Générer un nouveau code
          </Button>
        </div>
      )}
    </div>
  );
}
