import { useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";

interface TrustGatePageProps {
  trustCode: string;
}

export function TrustGatePage({ trustCode }: TrustGatePageProps) {
  const [copied, setCopied] = useState(false);

  const command = `/artisan trusteditor ${trustCode}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <div className="flex max-w-md flex-col items-center gap-5 text-center">
        <div className="flex flex-col gap-2">
          <p className="text-lg font-semibold text-zinc-100">Vérification requise</p>
          <p className="text-sm text-zinc-400">
            Tapez cette commande dans Minecraft pour débloquer l&apos;éditeur :
          </p>
        </div>

        <div className="flex w-full items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3">
          <code className="flex-1 text-left font-mono text-sm text-amber-200">{command}</code>
          <button
            type="button"
            onClick={handleCopy}
            className="flex shrink-0 items-center gap-1.5 rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-700 active:scale-95"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copié</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>Copier</span>
              </>
            )}
          </button>
        </div>

        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>En attente de confirmation…</span>
        </div>
      </div>
    </div>
  );
}
