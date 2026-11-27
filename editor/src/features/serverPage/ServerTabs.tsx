import { type ScopeTab, ScopeTabs } from "@/components/ui/scope-header";
import type { LinkProps } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

/**
 * The server page's tabs, in order. Each is a route of its own, shown under the
 * frame's header (`ScopeHeader`, the same as a module's); a server-level view adds its entry here (its route id is its
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
  const tabs: ScopeTab[] = SERVER_TABS.filter(
    (tab) => !("permission" in tab) || permissions.includes(tab.permission),
  ).map((tab) => ({
    id: tab.to,
    label: t(tab.label),
    more: "more" in tab,
    link: { to: tab.to, params: { serverId } } as LinkProps,
  }));
  return (
    <ScopeTabs
      label={t("serverDetail.tabs.label")}
      moreLabel={t("serverDetail.tabs.more")}
      tabs={tabs}
      active={active}
    />
  );
}
