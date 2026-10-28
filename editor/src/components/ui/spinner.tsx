import { Loader2 } from "lucide-react";

import { cn } from "@/lib/cx";

/**
 * Waiting indicator — for what takes a round-trip to a server's disk, where a
 * still page passes for a broken one.
 *
 * It only says "working": what is being waited for is written next to it.
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
