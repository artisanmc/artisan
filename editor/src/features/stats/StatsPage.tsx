import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { fetchStatsCatalog } from "@/lib/api/stats";
import { cx } from "@/lib/cx";
import { ChartColumn } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CommandsTab } from "./CommandsTab";
import { JourneysTab } from "./JourneysTab";
import { MenusTab } from "./MenusTab";
import { OverviewTab } from "./OverviewTab";
import { PlayerPicker } from "./PlayerPicker";
import { RANGE_PRESETS, type StatsSearch, isCustomPeriod, resolvePeriod } from "./period";
import { type StatsScope, useLoaded } from "./statsScope";
import type { KnownContent, StatsTab } from "./statsTabs";

const NO_TABS: StatsTab[] = [];

/** `YYYY-MM-DD` of a local day, for a date field. */
function dayOf(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/**
 * The statistics space of a server: the period and the player every tab reads, then
 * Artisan's own tabs and one per module that declares one (`moduleTabs`). Its state lives
 * in the URL (`search`), so a link reopens the same view.
 */
export function StatsPage({
  serverId,
  search,
  onSearch,
  known,
  moduleTabs = NO_TABS,
  now,
}: {
  serverId: string;
  search: StatsSearch;
  /** Merges `patch` into the URL's search; `undefined` removes a key. */
  onSearch: (patch: Partial<StatsSearch>) => void;
  known: KnownContent;
  moduleTabs?: StatsTab[];
  /** The present, fixed by tests. */
  now?: Date;
}) {
  const { t, i18n } = useTranslation();
  // The period moves with the hour: resolved once per search, not on every render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `now` is a test's fixed clock
  const period = useMemo(
    () => resolvePeriod(search, now ?? new Date()),
    [search.range, search.from, search.to],
  );
  const scope: StatsScope = useMemo(
    () => ({
      serverId,
      period,
      player: search.player,
      compare: search.compare !== false,
      lang: i18n.language,
    }),
    [serverId, period, search.player, search.compare, i18n.language],
  );
  // One cheap read says whether statistics answer at all, before any tab asks for numbers.
  const access = useLoaded(serverId, () => fetchStatsCatalog(serverId));

  const first: StatsTab = {
    id: "overview",
    label: t("stats.tabs.overview"),
    component: OverviewTab,
  };
  const tabs: StatsTab[] = [
    first,
    { id: "commands", label: t("stats.tabs.commands"), component: CommandsTab },
    { id: "menus", label: t("stats.tabs.menus"), component: MenusTab },
    { id: "journeys", label: t("stats.tabs.journeys"), component: JourneysTab },
    ...moduleTabs,
  ];
  const tab = tabs.find((x) => x.id === search.tab) ?? first;
  const Tab = tab.component;
  const custom = isCustomPeriod(search);

  if (access.error)
    return (
      <EmptyState
        icon={ChartColumn}
        title={t(
          access.error === "stats_disabled"
            ? "stats.disabled"
            : access.error === "http_403" || access.error === "forbidden"
              ? "stats.forbidden"
              : "stats.unavailable",
        )}
        hint={access.error === "stats_disabled" ? t("stats.disabledHint") : undefined}
      />
    );

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-6">
        {/* The filters: one row above every tab, since every tab reads them. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Segmented
            label={t("stats.period.label")}
            value={custom ? "custom" : (search.range ?? "7d")}
            options={[
              ...RANGE_PRESETS.map((r) => ({ value: r as string, label: t(`stats.period.${r}`) })),
              { value: "custom", label: t("stats.period.custom") },
            ]}
            onChange={(value) =>
              value === "custom"
                ? onSearch({ from: dayOf(period.from), to: dayOf(period.to - 1) })
                : onSearch({ range: value as StatsSearch["range"], from: undefined, to: undefined })
            }
          />
          {custom && (
            <span className="flex items-center gap-1.5 text-[12.5px] text-[var(--text-mut)]">
              <input
                type="date"
                className="input h-8 w-auto"
                aria-label={t("stats.period.from")}
                value={search.from}
                max={search.to}
                onChange={(e) => e.target.value && onSearch({ from: e.target.value })}
              />
              →
              <input
                type="date"
                className="input h-8 w-auto"
                aria-label={t("stats.period.to")}
                value={search.to}
                min={search.from}
                onChange={(e) => e.target.value && onSearch({ to: e.target.value })}
              />
            </span>
          )}
          <PlayerPicker
            serverId={serverId}
            value={search.player}
            onChange={(player) => onSearch({ player })}
          />
          <span className="ml-auto flex items-center gap-2 text-[12.5px] text-[var(--text-mut)]">
            <Switch
              checked={scope.compare}
              onCheckedChange={(on) => onSearch({ compare: on ? undefined : false })}
              aria-label={t("stats.compare")}
            />
            {t("stats.compare")}
          </span>
        </div>

        <nav className="tabstrip overflow-x-auto" aria-label={t("stats.tabs.label")}>
          {tabs.map((x) => (
            <button
              key={x.id}
              type="button"
              className={cx("tab shrink-0", x.id === tab.id && "is-active")}
              aria-current={x.id === tab.id ? "page" : undefined}
              onClick={() =>
                onSearch({ tab: x.id === first.id ? undefined : x.id, focus: undefined })
              }
            >
              {x.label}
            </button>
          ))}
        </nav>

        <Tab
          key={tab.id}
          scope={scope}
          focus={search.focus}
          onFocus={(focus) => onSearch({ focus })}
          known={known}
        />
      </div>
    </div>
  );
}
