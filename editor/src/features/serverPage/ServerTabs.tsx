import { cx } from "@/lib/cx";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

/**
 * The server page's tabs, in order. Each is a route of its own, shown under the
 * frame's header; a server-level view adds its entry here (its route id is its
 * `to`). The overview is the server route itself, active when no child matches.
 */
export const SERVER_TABS = [
  { to: "/servers/$serverId", label: "serverDetail.tabs.overview" },
  { to: "/servers/$serverId/canvas", label: "serverDetail.tabs.board" },
  { to: "/servers/$serverId/play", label: "serverDetail.tabs.play" },
  { to: "/servers/$serverId/data", label: "serverDetail.tabs.data" },
  { to: "/servers/$serverId/settings", label: "serverDetail.tabs.settings" },
] as const;

type ServerTab = (typeof SERVER_TABS)[number]["to"];

/** The tab a child route id belongs to — `undefined` for a view that is not a tab (a project). */
export function serverTabOf(childRouteId: string | undefined): ServerTab | undefined {
  if (childRouteId === undefined) return SERVER_TABS[0].to;
  return SERVER_TABS.find((tab) => tab.to === childRouteId)?.to;
}

export function ServerTabs({ serverId, active }: { serverId: string; active: ServerTab }) {
  const { t } = useTranslation();
  return (
    // The tabs fill the header's height, their underline on its bottom edge; nothing overflows
    // downward, so the strip only ever scrolls sideways (a narrow window).
    <nav
      className="tabstrip min-w-0 basis-full items-stretch overflow-x-auto overflow-y-hidden lg:basis-auto [&_.tab]:h-auto [&_.tab]:min-h-10 [&_.tab]:after:bottom-0"
      aria-label={t("serverDetail.tabs.label")}
    >
      {SERVER_TABS.map((tab) => (
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
    </nav>
  );
}
