import { cn } from "@/lib/cx";

/**
 * Pulsing grey block standing in for what has not arrived yet.
 *
 * It does not say "loading" — it says **what will arrive and where**: a
 * skeleton shaped like the screen holds the layout while waiting, instead of
 * making it jump when the data lands.
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
