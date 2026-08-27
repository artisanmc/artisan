import { cn } from "@/lib/cx";

/**
 * Bloc gris qui pulse, à la place de ce qui n'est pas encore arrivé.
 *
 * Il ne dit pas « ça charge » — il dit **ce qui va arriver et où** : un
 * squelette qui reprend la forme de l'écran fait tenir la mise en page pendant
 * l'attente, au lieu de la faire sauter au moment où les données tombent.
 * C'est ça qu'on gagne sur un rond qui tourne au centre du vide.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-[var(--r-sm)] bg-[var(--surface-raised)]", className)}
      {...props}
    />
  );
}
