import { StatCard } from "@/components/ui/stat-card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { TimeChart } from "@/components/ui/time-chart";
import { fetchStatsActives, fetchStatsEvents, fetchStatsSeries } from "@/lib/api/stats";
import { useTranslation } from "react-i18next";
import { Panel, PanelEmpty, PanelLoading, periodSeries, trendOf } from "./parts";
import { formatBucket, formatCount, formatDuration, totals } from "./period";
import { type StatsScope, scopeKey, scopeQuery, useLoaded } from "./statsScope";

const SESSION = "core:session";
const FIRST_JOIN = "core:first_join";
const ONLINE = "core:players_online";

async function loadOverview(scope: StatsScope) {
  const { serverId, period, compare } = scope;
  const sessions = scopeQuery(scope, SESSION);
  const joins = scopeQuery(scope, FIRST_JOIN);
  const online = scopeQuery({ ...scope, player: undefined }, ONLINE);
  const before = <T,>(read: () => Promise<T>) => (compare ? read() : Promise.resolve(undefined));
  const [actives, activesBefore, played, playedBefore, joined, joinedBefore, gauge] =
    await Promise.all([
      fetchStatsActives(serverId, sessions.current, period.by),
      before(() => fetchStatsActives(serverId, sessions.previous, period.by)),
      fetchStatsSeries(serverId, sessions.current, period.by),
      before(() => fetchStatsSeries(serverId, sessions.previous, period.by)),
      fetchStatsSeries(serverId, joins.current, period.by),
      before(() => fetchStatsSeries(serverId, joins.previous, period.by)),
      scope.player ? Promise.resolve([]) : fetchStatsSeries(serverId, online.current, period.by),
    ]);
  const recent = scope.player
    ? (
        await fetchStatsEvents(serverId, {
          event: SESSION,
          from: period.from,
          to: period.to,
          player: scope.player,
          limit: 20,
        })
      ).events
    : [];
  return { actives, activesBefore, played, playedBefore, joined, joinedBefore, gauge, recent };
}

/**
 * Who plays: active, new and returning players, play time and the players online over the
 * period. For one player: their visits. A visit counts when it ends, so a player still
 * online is counted at their next disconnection.
 */
export function OverviewTab({ scope }: { scope: StatsScope }) {
  const { t } = useTranslation();
  const { lang, period } = scope;
  const { data, loading } = useLoaded(scopeKey(scope), () => loadOverview(scope));
  if (!data) return loading ? <PanelLoading height={360} /> : null;

  const played = totals(data.played);
  const playedBefore = data.playedBefore && totals(data.playedBefore);
  const joined = totals(data.joined).count;
  const joinedBefore = data.joinedBefore && totals(data.joinedBefore).count;
  const active = data.actives.players;
  const activeBefore = data.activesBefore?.players;
  const returning = Math.max(0, active - joined);
  const returningBefore =
    activeBefore !== undefined && joinedBefore !== undefined
      ? Math.max(0, activeBefore - joinedBefore)
      : undefined;
  const count = (n: number) => formatCount(n, lang);
  const previousLabel = t("stats.previousPeriod");
  const onlinePeak = Math.max(0, ...data.gauge.filter((p) => p.count > 0).map((p) => p.max));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {scope.player ? (
          <StatCard
            label={t("stats.overview.sessions")}
            value={count(played.count)}
            trend={trendOf(played.count, playedBefore?.count, lang, true)}
          />
        ) : (
          <>
            <StatCard
              label={t("stats.overview.activePlayers")}
              value={count(active)}
              trend={trendOf(active, activeBefore, lang, true)}
            />
            <StatCard
              label={t("stats.overview.newPlayers")}
              value={count(joined)}
              trend={trendOf(joined, joinedBefore, lang, true)}
            />
            <StatCard
              label={t("stats.overview.returningPlayers")}
              value={count(returning)}
              trend={trendOf(returning, returningBefore, lang, true)}
            />
          </>
        )}
        <StatCard
          label={t("stats.overview.playTime")}
          value={formatDuration(played.sum)}
          sub={
            played.count > 0
              ? t("stats.overview.perSession", {
                  duration: formatDuration(played.sum / played.count),
                })
              : undefined
          }
          trend={trendOf(played.sum, playedBefore?.sum, lang, true)}
        />
      </div>

      {!scope.player && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title={t("stats.overview.activePlayers")} hint={t("stats.overview.activeHint")}>
            <TimeChart
              label={t("stats.overview.activePlayers")}
              formatY={count}
              series={periodSeries(
                t("stats.currentPeriod"),
                previousLabel,
                data.actives.points,
                data.activesBefore?.points,
                (p) => p.players,
                period.by,
                lang,
              )}
            />
          </Panel>
          <Panel
            title={t("stats.overview.playersOnline")}
            hint={
              onlinePeak > 0 ? t("stats.overview.onlinePeak", { count: onlinePeak }) : undefined
            }
          >
            {data.gauge.some((p) => p.count > 0) ? (
              <TimeChart
                label={t("stats.overview.playersOnline")}
                formatY={count}
                series={[
                  {
                    id: "average",
                    label: t("stats.overview.onlineAverage"),
                    color: "var(--chart-1)",
                    points: data.gauge.map((p) => ({
                      label: formatBucket(p.start, period.by, lang),
                      y: p.count > 0 ? p.sum / p.count : 0,
                    })),
                  },
                  {
                    id: "peak",
                    label: t("stats.overview.onlineMax"),
                    color: "var(--chart-2)",
                    points: data.gauge.map((p) => ({
                      label: formatBucket(p.start, period.by, lang),
                      y: p.count > 0 ? p.max : 0,
                    })),
                  },
                ]}
              />
            ) : (
              <PanelEmpty>{t("stats.noData")}</PanelEmpty>
            )}
          </Panel>
          <Panel title={t("stats.overview.newPlayers")}>
            <TimeChart
              label={t("stats.overview.newPlayers")}
              formatY={count}
              series={periodSeries(
                t("stats.currentPeriod"),
                previousLabel,
                data.joined,
                data.joinedBefore,
                (p) => p.count,
                period.by,
                lang,
              )}
            />
          </Panel>
          <Panel title={t("stats.overview.playTime")}>
            <TimeChart
              label={t("stats.overview.playTime")}
              formatY={(hours) => t("stats.overview.hours", { value: formatCount(hours, lang) })}
              series={periodSeries(
                t("stats.currentPeriod"),
                previousLabel,
                data.played,
                data.playedBefore,
                (p) => p.sum / 3600,
                period.by,
                lang,
              )}
            />
          </Panel>
        </div>
      )}

      {scope.player && (
        <Panel title={t("stats.overview.lastSessions")}>
          {data.recent.length === 0 ? (
            <PanelEmpty>{t("stats.noData")}</PanelEmpty>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{t("stats.overview.sessionEnd")}</TH>
                  <TH align="right">{t("stats.overview.sessionLength")}</TH>
                </TR>
              </THead>
              <TBody>
                {data.recent.map((row) => (
                  <TR key={row.id}>
                    <TD>
                      {new Intl.DateTimeFormat(lang, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(row.at))}
                    </TD>
                    <TD align="right">{formatDuration(row.value)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Panel>
      )}
    </div>
  );
}
