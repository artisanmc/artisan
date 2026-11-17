import { BarList } from "@/components/ui/bar-list";
import { SortableTable } from "@/components/ui/sortable-table";
import { StatCard } from "@/components/ui/stat-card";
import { TimeChart } from "@/components/ui/time-chart";
import { fetchStatsActives, fetchStatsBreakdown, fetchStatsSeries } from "@/lib/api/stats";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Panel, PanelEmpty, PanelLoading, periodSeries, trendOf } from "./parts";
import { formatCount, totals } from "./period";
import { type StatsScope, scopeKey, scopeQuery, useLoaded } from "./statsScope";
import type { StatsTabProps } from "./statsTabs";

const OPEN = "core:menu_open";
const CLICK = "core:menu_click";

interface MenuRow {
  menu: string;
  opens: number;
  clicks: number;
}

async function loadMenus(scope: StatsScope, focus: string | undefined) {
  const { serverId, period, compare } = scope;
  const dims = focus ? { menu: focus } : undefined;
  const opens = scopeQuery(scope, OPEN, dims);
  const clicks = scopeQuery(scope, CLICK, dims);
  const [openByMenu, clickByMenu, series, seriesBefore, elements, openers, clickers] =
    await Promise.all([
      fetchStatsBreakdown(serverId, scopeQuery(scope, OPEN).current, "menu"),
      fetchStatsBreakdown(serverId, scopeQuery(scope, CLICK).current, "menu"),
      fetchStatsSeries(serverId, opens.current, period.by),
      compare ? fetchStatsSeries(serverId, opens.previous, period.by) : undefined,
      focus ? fetchStatsBreakdown(serverId, clicks.current, "element") : undefined,
      focus ? fetchStatsActives(serverId, opens.current, period.by) : undefined,
      focus ? fetchStatsActives(serverId, clicks.current, period.by) : undefined,
    ]);
  const clicked = new Map(clickByMenu.map((r) => [r.value, r.count]));
  const rows: MenuRow[] = openByMenu.map((r) => ({
    menu: r.value,
    opens: r.count,
    clicks: clicked.get(r.value) ?? 0,
  }));
  return { rows, series, seriesBefore, elements, openers, clickers };
}

/** The menus: how often each is opened, what is clicked in it, and what nobody touches. */
export function MenusTab({ scope, focus, onFocus, known }: StatsTabProps) {
  const { t } = useTranslation();
  const { lang, period } = scope;
  const { data, loading } = useLoaded(`${scopeKey(scope)}|${focus ?? ""}`, () =>
    loadMenus(scope, focus),
  );
  if (!data) return loading ? <PanelLoading height={360} /> : null;

  const count = (n: number) => formatCount(n, lang);
  const share = (ratio: number) =>
    new Intl.NumberFormat(lang, { style: "percent", maximumFractionDigits: 0 }).format(ratio);
  const opens = totals(data.series).count;
  const opensBefore = data.seriesBefore && totals(data.seriesBefore).count;
  const opened = new Set(data.rows.map((r) => r.menu));
  const neverOpened = scope.player ? [] : known.menus.filter((m) => !opened.has(m.ref));
  const clickedElements = new Set(data.elements?.map((r) => r.value));
  const untouched =
    focus && !scope.player
      ? (known.menus.find((m) => m.ref === focus)?.elements ?? []).filter(
          (e) => !clickedElements.has(e),
        )
      : [];
  const openers = data.openers?.players ?? 0;
  const clickers = data.clickers?.players ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={focus ?? t("stats.menus.opens")}
          value={count(opens)}
          sub={focus ? t("stats.menus.opens") : undefined}
          trend={trendOf(opens, opensBefore, lang)}
        />
        {focus ? (
          <>
            <StatCard label={t("stats.menus.openers")} value={count(openers)} />
            <StatCard
              label={t("stats.menus.clickers")}
              value={count(clickers)}
              sub={
                openers > 0
                  ? t("stats.menus.clickersShare", {
                      share: share(Math.min(1, clickers / openers)),
                    })
                  : undefined
              }
            />
          </>
        ) : (
          <StatCard label={t("stats.menus.distinct")} value={count(data.rows.length)} />
        )}
      </div>

      <Panel
        title={focus ? t("stats.menus.opensOf", { menu: focus }) : t("stats.menus.opens")}
        actions={
          focus && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onFocus(undefined)}
            >
              <X className="size-3.5" aria-hidden />
              {t("stats.allMenus")}
            </button>
          )
        }
      >
        <TimeChart
          label={t("stats.menus.opens")}
          formatY={count}
          series={periodSeries(
            t("stats.currentPeriod"),
            t("stats.previousPeriod"),
            data.series,
            data.seriesBefore,
            (p) => p.count,
            period.by,
            lang,
          )}
        />
      </Panel>

      {focus && data.elements && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title={t("stats.menus.clicksByElement")}>
            {data.elements.length === 0 ? (
              <PanelEmpty>{t("stats.menus.noClicks")}</PanelEmpty>
            ) : (
              <BarList
                rows={data.elements.map((r) => ({
                  id: r.value || "-",
                  label: r.value || t("stats.menus.unnamedElement"),
                  value: r.count,
                  caption: count(r.count),
                }))}
              />
            )}
          </Panel>
          {untouched.length > 0 && (
            <Panel title={t("stats.menus.untouched")} hint={t("stats.menus.untouchedHint")}>
              <ul className="flex flex-wrap gap-1.5">
                {untouched.map((e) => (
                  <li key={e} className="chip">
                    {e}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}

      <Panel title={t("stats.menus.table")} hint={t("stats.clickToDetail")}>
        {data.rows.length === 0 ? (
          <PanelEmpty>{t("stats.noData")}</PanelEmpty>
        ) : (
          <SortableTable
            rows={data.rows}
            rowId={(r) => r.menu}
            initialSort="opens"
            selectedId={focus}
            onSelect={(id) => onFocus(id === focus ? undefined : id)}
            columns={[
              { id: "menu", label: t("stats.menus.menu"), value: (r) => r.menu },
              {
                id: "opens",
                label: t("stats.menus.opens"),
                value: (r) => r.opens,
                render: (r) => count(r.opens),
                align: "right",
              },
              {
                id: "clicks",
                label: t("stats.menus.clicks"),
                value: (r) => r.clicks,
                render: (r) => count(r.clicks),
                align: "right",
              },
              {
                id: "perOpen",
                label: t("stats.menus.clicksPerOpen"),
                value: (r) => (r.opens > 0 ? r.clicks / r.opens : 0),
                render: (r) => (r.opens > 0 ? formatCount(r.clicks / r.opens, lang) : "—"),
                align: "right",
              },
            ]}
          />
        )}
      </Panel>

      {neverOpened.length > 0 && (
        <Panel title={t("stats.menus.neverOpened")} hint={t("stats.menus.neverOpenedHint")}>
          <ul className="flex flex-wrap gap-1.5">
            {neverOpened.map((m) => (
              <li key={m.ref} className="chip">
                {m.ref}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
