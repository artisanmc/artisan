import { BarList } from "@/components/ui/bar-list";
import { SortableTable } from "@/components/ui/sortable-table";
import { StatCard } from "@/components/ui/stat-card";
import { TimeChart } from "@/components/ui/time-chart";
import { fetchStatsBreakdown, fetchStatsSeries } from "@/lib/api/stats";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Panel, PanelEmpty, PanelLoading, periodSeries, trendOf } from "./parts";
import { formatCount, totals } from "./period";
import { type StatsScope, scopeKey, scopeQuery, useLoaded } from "./statsScope";
import type { StatsTabProps } from "./statsTabs";

const COMMAND = "core:command";

interface CommandRow {
  command: string;
  runs: number;
  refused: number;
}

async function loadCommands(scope: StatsScope, focus: string | undefined) {
  const { serverId, period, compare } = scope;
  const all = scopeQuery(scope, COMMAND);
  const shown = scopeQuery(scope, COMMAND, focus ? { command: focus } : undefined);
  const [byCommand, okByCommand, series, seriesBefore, results, subs] = await Promise.all([
    fetchStatsBreakdown(serverId, all.current, "command"),
    fetchStatsBreakdown(serverId, { ...all.current, dims: { result: "ok" } }, "command"),
    fetchStatsSeries(serverId, shown.current, period.by),
    compare ? fetchStatsSeries(serverId, shown.previous, period.by) : undefined,
    focus ? fetchStatsBreakdown(serverId, shown.current, "result") : undefined,
    focus ? fetchStatsBreakdown(serverId, shown.current, "sub") : undefined,
  ]);
  const ok = new Map(okByCommand.map((r) => [r.value, r.count]));
  const rows: CommandRow[] = byCommand.map((r) => ({
    command: r.value,
    runs: r.count,
    refused: r.count - (ok.get(r.value) ?? 0),
  }));
  return { rows, series, seriesBefore, results, subs };
}

/** The commands made in Artisan: how often each is run, how often it is refused and why. */
export function CommandsTab({ scope, focus, onFocus, known }: StatsTabProps) {
  const { t } = useTranslation();
  const { lang, period } = scope;
  const { data, loading } = useLoaded(`${scopeKey(scope)}|${focus ?? ""}`, () =>
    loadCommands(scope, focus),
  );
  if (!data) return loading ? <PanelLoading height={360} /> : null;

  const count = (n: number) => formatCount(n, lang);
  const share = (ratio: number) =>
    new Intl.NumberFormat(lang, { style: "percent", maximumFractionDigits: 0 }).format(ratio);
  const runs = totals(data.series).count;
  const runsBefore = data.seriesBefore && totals(data.seriesBefore).count;
  const totalRuns = data.rows.reduce((n, r) => n + r.runs, 0);
  const totalRefused = data.rows.reduce((n, r) => n + r.refused, 0);
  const used = new Set(data.rows.map((r) => r.command));
  const unused = scope.player ? [] : known.commands.filter((c) => !used.has(c));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={focus ? `/${focus}` : t("stats.commands.runs")}
          value={count(runs)}
          trend={trendOf(runs, runsBefore, lang)}
        />
        {!focus && (
          <>
            <StatCard label={t("stats.commands.distinct")} value={count(data.rows.length)} />
            <StatCard
              label={t("stats.commands.refused")}
              value={count(totalRefused)}
              sub={totalRuns > 0 ? share(totalRefused / totalRuns) : undefined}
            />
          </>
        )}
      </div>

      <Panel
        title={focus ? t("stats.commands.runsOf", { command: focus }) : t("stats.commands.runs")}
        actions={
          focus && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onFocus(undefined)}
            >
              <X className="size-3.5" aria-hidden />
              {t("stats.allCommands")}
            </button>
          )
        }
      >
        <TimeChart
          label={t("stats.commands.runs")}
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

      {focus && data.results && data.subs && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title={t("stats.commands.byResult")}>
            {data.results.length === 0 ? (
              <PanelEmpty>{t("stats.noData")}</PanelEmpty>
            ) : (
              <BarList
                rows={data.results.map((r) => ({
                  id: r.value,
                  label: t(`stats.commands.result.${r.value}`, { defaultValue: r.value }),
                  value: r.count,
                  caption: count(r.count),
                }))}
              />
            )}
          </Panel>
          <Panel title={t("stats.commands.bySub")}>
            {data.subs.length === 0 ? (
              <PanelEmpty>{t("stats.noData")}</PanelEmpty>
            ) : (
              <BarList
                rows={data.subs.map((r) => ({
                  id: r.value || "-",
                  label: r.value ? `/${focus} ${r.value}` : `/${focus}`,
                  value: r.count,
                  caption: count(r.count),
                }))}
              />
            )}
          </Panel>
        </div>
      )}

      <Panel title={t("stats.commands.table")} hint={t("stats.clickToDetail")}>
        {data.rows.length === 0 ? (
          <PanelEmpty>{t("stats.noData")}</PanelEmpty>
        ) : (
          <SortableTable
            rows={data.rows}
            rowId={(r) => r.command}
            initialSort="runs"
            selectedId={focus}
            onSelect={(id) => onFocus(id === focus ? undefined : id)}
            columns={[
              {
                id: "command",
                label: t("stats.commands.command"),
                value: (r) => r.command,
                render: (r) => `/${r.command}`,
              },
              {
                id: "runs",
                label: t("stats.commands.runs"),
                value: (r) => r.runs,
                render: (r) => count(r.runs),
                align: "right",
              },
              {
                id: "refused",
                label: t("stats.commands.refused"),
                value: (r) => r.refused,
                render: (r) => count(r.refused),
                align: "right",
              },
              {
                id: "refusedShare",
                label: t("stats.commands.refusedShare"),
                value: (r) => (r.runs > 0 ? r.refused / r.runs : 0),
                render: (r) => (r.runs > 0 ? share(r.refused / r.runs) : "—"),
                align: "right",
              },
            ]}
          />
        )}
      </Panel>

      {unused.length > 0 && (
        <Panel title={t("stats.commands.unused")} hint={t("stats.commands.unusedHint")}>
          <ul className="flex flex-wrap gap-1.5">
            {unused.map((c) => (
              <li key={c} className="chip">
                /{c}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
