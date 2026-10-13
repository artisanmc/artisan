import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cx";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Children, type ReactNode, useState } from "react";

/** Classes of a clickable level (router link or `<a>`). */
export const breadcrumbLinkClass =
  "block min-w-0 truncate rounded-[6px] px-1 py-0.5 text-[var(--text-mut)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]";

/**
 * Breadcrumb: each child is a level, separated from the previous one by a
 * chevron. Empty levels (`null`, `false`) are skipped. The last one is
 * usually a `BreadcrumbCurrent`.
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
          // biome-ignore lint/suspicious/noArrayIndexKey: levels are positional.
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

/** The current level: not a link. */
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

export interface BreadcrumbSwitcherItem {
  id: string;
  label: string;
  /** Dot or icon before the label, in the menu. */
  leading?: ReactNode;
}

/** Above this, the menu gets a search field. */
const SWITCHER_SEARCH_THRESHOLD = 7;

/**
 * Level that opens the list of its siblings (servers of a network…) to
 * switch. Search only when the list is long.
 */
export function BreadcrumbSwitcher({
  current,
  items,
  onSelect,
  searchPlaceholder,
  title,
}: {
  current: string;
  items: BreadcrumbSwitcherItem[];
  onSelect: (id: string) => void;
  searchPlaceholder: string;
  title?: string;
}) {
  const [query, setQuery] = useState("");
  const active = items.find((i) => i.id === current);
  const q = query.trim().toLowerCase();
  const visible = q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
  return (
    <DropdownMenu onOpenChange={(open) => !open && setQuery("")}>
      <DropdownMenuTrigger
        title={title}
        className={cn(breadcrumbLinkClass, "flex items-center gap-1.5")}
      >
        <span className="truncate">{active?.label ?? current}</span>
        <ChevronDown aria-hidden className="size-3.5 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        {items.length > SWITCHER_SEARCH_THRESHOLD && (
          <Input
            autoFocus
            value={query}
            placeholder={searchPlaceholder}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key !== "Escape" && e.stopPropagation()}
            className="mb-1 h-8"
          />
        )}
        {visible.map((item) => (
          <DropdownMenuItem
            key={item.id}
            onSelect={() => onSelect(item.id)}
            className={cn("gap-2", item.id === current && "text-[var(--brand)]")}
          >
            {item.leading}
            <span className="truncate">{item.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
