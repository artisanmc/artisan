import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cx } from "@/lib/cx";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * The server page's tabs, in order. Each is a route of its own, shown under the
 * frame's header; a server-level view adds its entry here (its route id is its
 * `to`). The overview is the server route itself, active when no child matches.
 * The header is one row: the tabs opened every day sit in it, the ones opened now and
 * then (`more`) under **More**, so the row never has to scroll. A new tab is `more`
 * unless it replaces one of the row.
 */
export const SERVER_TABS = [
  { to: "/servers/$serverId", label: "serverDetail.tabs.overview" },
  { to: "/servers/$serverId/resources", label: "serverDetail.tabs.resources" },
  { to: "/servers/$serverId/play", label: "serverDetail.tabs.play" },
  { to: "/servers/$serverId/assistant", label: "serverDetail.tabs.assistant" },
  { to: "/servers/$serverId/data", label: "serverDetail.tabs.data", more: true },
  {
    to: "/servers/$serverId/stats",
    label: "serverDetail.tabs.stats",
    permission: "artisan.editor.stats",
  },
  { to: "/servers/$serverId/updates", label: "serverDetail.tabs.updates", more: true },
  {
    to: "/servers/$serverId/imports",
    label: "serverDetail.tabs.imports",
    permission: "artisan.editor.config",
    more: true,
  },
  { to: "/servers/$serverId/settings", label: "serverDetail.tabs.settings", more: true },
] as const satisfies readonly { to: string; label: string; permission?: string; more?: true }[];

type ServerTab = (typeof SERVER_TABS)[number]["to"];

/** The tab a child route id belongs to — `undefined` for a view that is not a tab (a project). */
export function serverTabOf(childRouteId: string | undefined): ServerTab | undefined {
  if (childRouteId === undefined) return SERVER_TABS[0].to;
  return SERVER_TABS.find((tab) => tab.to === childRouteId)?.to;
}

export function ServerTabs({
  serverId,
  active,
  permissions,
}: {
  serverId: string;
  active: ServerTab;
  /** The session's editor permissions: a tab that names one shows only with it. */
  permissions: readonly string[];
}) {
  const { t } = useTranslation();
  const allowed = SERVER_TABS.filter(
    (tab) => !("permission" in tab) || permissions.includes(tab.permission),
  );
  const row = allowed.filter((tab) => !("more" in tab));
  const more = allowed.filter((tab) => "more" in tab);
  // The tab shown when it is one of **More**: the button names it, so the page says where it is.
  const shown = more.find((tab) => tab.to === active);
  return (
    // The tabs fill the header's height, their underline on its bottom edge; nothing overflows
    // downward, so the strip only ever scrolls sideways (a narrow window).
    <nav
      className="tabstrip min-w-0 basis-full items-stretch overflow-x-auto overflow-y-hidden lg:basis-auto [&_.tab]:h-auto [&_.tab]:min-h-10 [&_.tab]:after:bottom-0"
      aria-label={t("serverDetail.tabs.label")}
    >
      {row.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          params={{ serverId }}
          className={cx("tab shrink-0", tab.to === active && "is-active")}
          aria-current={tab.to === active ? "page" : undefined}
        >
          {t(tab.label)}
        </Link>
      ))}
      {more.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cx("tab shrink-0 gap-1", shown && "is-active")}
              aria-current={shown ? "page" : undefined}
            >
              {shown ? t(shown.label) : t("serverDetail.tabs.more")}
              <ChevronDown aria-hidden className="size-3.5 opacity-70" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {more.map((tab) => (
              <DropdownMenuItem key={tab.to} asChild>
                <Link
                  to={tab.to}
                  params={{ serverId }}
                  aria-current={tab.to === active ? "page" : undefined}
                >
                  {t(tab.label)}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </nav>
  );
}
