import { Loader2 } from "lucide-react";

import { cn } from "@/lib/cx";

/**
 * Indicateur d'attente — pour ce qui prend le temps d'un aller-retour jusqu'au
 * disque d'un serveur, où une page immobile passe pour une page cassée.
 *
 * Il ne dit que « ça travaille » : ce qu'on attend s'écrit à côté, en toutes
 * lettres. Un rond qui tourne seul n'informe de rien.
 */
export function Spinner({ className, ...props }: React.HTMLAttributes<SVGElement>) {
  return (
    <Loader2
      role="status"
      aria-label="chargement"
      className={cn("size-4 animate-spin text-[var(--text-faint)]", className)}
      {...props}
    />
  );
}
