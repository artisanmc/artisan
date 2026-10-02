import { cn } from "@/lib/cx";
import { ChevronRight } from "lucide-react";
import { Children, type ReactNode } from "react";

/** Classes d'un niveau cliquable (lien du routeur ou `<a>`). */
export const breadcrumbLinkClass =
  "block min-w-0 truncate rounded-[6px] px-1 py-0.5 text-[var(--text-mut)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]";

/**
 * Fil d'Ariane : chaque enfant est un niveau, séparé du précédent par un
 * chevron. Les niveaux vides (`null`, `false`) sont ignorés. Le dernier est en
 * général un `BreadcrumbCurrent`.
 */
export function Breadcrumb({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const levels = Children.toArray(children);
  return (
    <nav aria-label={label} className={cn("min-w-0", className)}>
      <ol className="flex min-w-0 items-center gap-0.5 text-sm">
        {levels.map((level, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: les niveaux sont positionnels.
          <li key={i} className="flex min-w-0 items-center gap-0.5">
            {i > 0 && (
              <ChevronRight aria-hidden className="size-3.5 shrink-0 text-[var(--text-faint)]" />
            )}
            {level}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Le niveau où l'on se trouve : pas un lien. */
export function BreadcrumbCurrent({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      aria-current="page"
      title={title}
      className="font-display block min-w-0 truncate px-1 text-[var(--text)]"
    >
      {children}
    </span>
  );
}
