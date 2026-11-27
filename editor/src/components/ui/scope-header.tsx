import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cx } from "@/lib/cx";
import { useSidebarStore } from "@/state/sidebarStore";
import { Link, type LinkProps } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The header of a place the sidebar lists, the server or one of its modules: one row, as
 * tall as the sidebar's logo row, with the same parts in the same places at both levels.
 *
 * - `title`: where you are (the server switcher, a module's breadcrumb).
 * - `nav`: the views of that place, a `ScopeTabs`.
 * - `end`: tools and actions, pushed to the right.
 *
 * The rule the editor keeps: the sidebar lists the places, this header the views of the
 * place the sidebar highlights. Clear of the navigation toggle while the sidebar is not pinned.
 */
export function ScopeHeader({
  title,
  nav,
  end,
  testId,
}: {
  title: ReactNode;
  nav?: ReactNode;
  end?: ReactNode;
  testId?: string;
}) {
  const pinned = useSidebarStore((s) => s.pinned);
  return (
    <header
      data-testid={testId}
      className={cx(
        "scope-header flex shrink-0 flex-wrap items-stretch gap-x-6 bg-[var(--surface)] pr-4 pl-16 lg:h-16 lg:flex-nowrap lg:pr-6 lg:pl-24",
        pinned && "lg:pl-6",
      )}
    >
      {/* Where you are keeps its room (a long breadcrumb truncates inside it); the tabs
          give way first, scrolling sideways. */}
      <div className="flex min-h-14 min-w-0 items-center gap-2.5 lg:max-w-sm lg:shrink-0">
        {title}
      </div>
      {nav}
      {end && (
        <div className="ml-auto flex min-h-12 shrink-0 items-center gap-1 lg:min-h-0">{end}</div>
      )}
    </header>
  );
}

/** A view of a place: a route (`link`) or a switch handled by the page (`onSelect`). */
export interface ScopeTab {
  id: string;
  label: string;
  /** Under **More**: the views opened now and then, so the row never has to scroll. */
  more?: boolean;
  link?: LinkProps;
  onSelect?: () => void;
  /** Beside the label (a count to fix). */
  badge?: ReactNode;
  title?: string;
  testId?: string;
}

/**
 * The views of a place, as a row of `.tab`s; the ones marked `more` under **More**, whose
 * button names the view shown when it is one of them, so the row says where you are.
 */
export function ScopeTabs({
  label,
  moreLabel,
  tabs,
  active,
  testId,
  tour,
}: {
  /** The navigation's accessible name. */
  label: string;
  moreLabel: string;
  tabs: readonly ScopeTab[];
  active: string | undefined;
  testId?: string;
  tour?: string;
}) {
  const row = tabs.filter((tab) => !tab.more);
  const more = tabs.filter((tab) => tab.more);
  const shown = more.find((tab) => tab.id === active);
  return (
    // The tabs fill the header's height, their underline on its bottom edge; nothing overflows
    // downward, so the strip only ever scrolls sideways (a narrow window).
    <nav
      data-testid={testId}
      data-tour={tour}
      className="tabstrip min-w-0 basis-full items-stretch overflow-x-auto overflow-y-hidden lg:basis-auto [&_.tab]:h-auto [&_.tab]:min-h-10 [&_.tab]:after:bottom-0"
      aria-label={label}
    >
      {row.map((tab) => (
        <TabEntry key={tab.id} tab={tab} active={tab.id === active} />
      ))}
      {more.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cx("tab shrink-0 gap-1", shown && "is-active")}
              aria-current={shown ? "page" : undefined}
            >
              <span className="max-w-40 truncate">{shown ? shown.label : moreLabel}</span>
              <ChevronDown aria-hidden className="size-3.5 opacity-70" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {more.map((tab) =>
              tab.link ? (
                <DropdownMenuItem key={tab.id} asChild>
                  <Link
                    {...tab.link}
                    data-testid={tab.testId}
                    aria-current={tab.id === active ? "page" : undefined}
                  >
                    {tab.label}
                    {tab.badge}
                  </Link>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  key={tab.id}
                  data-testid={tab.testId}
                  aria-current={tab.id === active ? "page" : undefined}
                  onSelect={tab.onSelect}
                >
                  {tab.label}
                  {tab.badge}
                </DropdownMenuItem>
              ),
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </nav>
  );
}

function TabEntry({ tab, active }: { tab: ScopeTab; active: boolean }) {
  const props = {
    className: cx("tab shrink-0", active && "is-active"),
    "aria-current": active ? ("page" as const) : undefined,
    "data-testid": tab.testId,
    title: tab.title,
  };
  return tab.link ? (
    <Link {...tab.link} {...props}>
      {tab.label}
      {tab.badge}
    </Link>
  ) : (
    <button type="button" onClick={tab.onSelect} {...props}>
      {tab.label}
      {tab.badge}
    </button>
  );
}
