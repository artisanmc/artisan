import { BarList } from "@/components/ui/bar-list";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Funnel } from "@/components/ui/funnel";
import { Input } from "@/components/ui/input";
import { type SortableColumn, SortableTable } from "@/components/ui/sortable-table";
import { StatCard } from "@/components/ui/stat-card";
import { TimeChart } from "@/components/ui/time-chart";
import {
  type StatsCatalogEntry,
  type StatsJourney,
  type StatsJourneyResult,
  computeStatsJourney,
  fetchStatsCatalog,
  fetchStatsJourneys,
  saveStatsJourneys,
} from "@/lib/api/stats";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_WINDOW_DAYS,
  MAX_GOALS,
  MAX_WINDOW_DAYS,
  actionLabel,
  emptyGoal,
  formatFilter,
  journeyId,
  journeyPeriod,
  journeyProblems,
  parseFilter,
  retentionCurve,
  retentionShare,
} from "./journeys";
import { Panel, PanelEmpty, PanelLoading } from "./parts";
import { formatCount, formatDuration } from "./period";
import { type StatsScope, useLoaded } from "./statsScope";
import type { StatsTabProps } from "./statsTabs";

type Cohort = StatsJourneyResult["cohorts"][number];

/**
 * The journeys of new players: retention, and for a journey the admin composed (ordered
 * goals), its funnel, its weekly cohorts and what the players who left did last. The
 * period filters the arrivals; the open journey is the tab's focus, kept in the URL.
 */
export function JourneysTab({ scope, focus, onFocus }: StatsTabProps) {
  const { t } = useTranslation();
  const { serverId } = scope;
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<StatsJourney | null>(null);
  const [saveError, setSaveError] = useState(false);
  const saved = useLoaded(`${serverId}|journeys|${version}`, () => fetchStatsJourneys(serverId));
  const catalog = useLoaded(`${serverId}|catalog`, () => fetchStatsCatalog(serverId));
  if (!saved.data) return saved.loading ? <PanelLoading height={360} /> : null;

  const journeys = saved.data;
  const current = journeys.find((j) => j.id === focus) ?? journeys[0];
  const write = (next: StatsJourney[], open: string | undefined) => {
    setSaveError(false);
    saveStatsJourneys(serverId, next).then(
      () => {
        setEditing(null);
        setVersion((v) => v + 1);
        onFocus(open);
      },
      () => setSaveError(true),
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {journeys.length > 0 && (
          <select
            className="input w-auto min-w-[220px]"
            aria-label={t("stats.journeys.pick")}
            value={current?.id ?? ""}
            onChange={(e) => onFocus(e.target.value)}
          >
            {journeys.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </select>
        )}
        {current && (
          <>
            <Button size="sm" variant="outline" onClick={() => setEditing(current)}>
              {t("stats.journeys.edit")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                write(
                  journeys.filter((j) => j.id !== current.id),
                  undefined,
                )
              }
            >
              {t("stats.journeys.delete")}
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant={journeys.length === 0 ? "primary" : "outline"}
          onClick={() =>
            setEditing({ id: "", name: "", windowDays: DEFAULT_WINDOW_DAYS, goals: [emptyGoal()] })
          }
        >
          <Plus size={14} aria-hidden />
          {t("stats.journeys.create")}
        </Button>
        {journeys.length === 0 && (
          <span className="text-[12.5px] text-[var(--text-mut)]">{t("stats.journeys.none")}</span>
        )}
      </div>

      {editing && (
        <JourneyForm
          key={editing.id || "new"}
          initial={editing}
          events={catalog.data ?? []}
          failed={saveError}
          onCancel={() => setEditing(null)}
          onSave={(journey) => {
            const id =
              journey.id ||
              journeyId(
                journey.name,
                journeys.map((j) => j.id),
              );
            const next = { ...journey, id };
            write(
              journey.id ? journeys.map((j) => (j.id === id ? next : j)) : [...journeys, next],
              id,
            );
          }}
        />
      )}

      <JourneyResults scope={scope} journey={current} />
    </div>
  );
}

function JourneyForm({
  initial,
  events,
  failed,
  onSave,
  onCancel,
}: {
  initial: StatsJourney;
  events: readonly StatsCatalogEntry[];
  failed: boolean;
  onSave: (journey: StatsJourney) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initial);
  // The filters as typed: a half-written `name=` must not be thrown away while typing.
  const [filters, setFilters] = useState(() => initial.goals.map((g) => formatFilter(g.dims)));
  const parsed = filters.map(parseFilter);
  const problems = journeyProblems(draft);
  const badFilter = parsed.some((p) => p === null);
  // A journey reads raw rows about a player: the other events could never be reached.
  const pickable = events.filter((e) => e.raw && e.scope !== "server").map((e) => e.event);

  const setGoal = (i: number, patch: Partial<StatsJourney["goals"][number]>) =>
    setDraft((d) => ({ ...d, goals: d.goals.map((g, n) => (n === i ? { ...g, ...patch } : g)) }));
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= draft.goals.length) return;
    const swap = <T,>(list: readonly T[]) => {
      const out = [...list];
      [out[i], out[j]] = [out[j] as T, out[i] as T];
      return out;
    };
    setDraft((d) => ({ ...d, goals: swap(d.goals) }));
    setFilters(swap);
  };

  return (
    <Panel title={t(initial.id ? "stats.journeys.editTitle" : "stats.journeys.createTitle")}>
      <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
        <FormField label={t("stats.journeys.name")}>
          <Input
            value={draft.name}
            maxLength={80}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </FormField>
        <FormField label={t("stats.journeys.window")} hint={t("stats.journeys.windowHint")}>
          <Input
            type="number"
            min={1}
            max={MAX_WINDOW_DAYS}
            value={Number.isFinite(draft.windowDays) ? draft.windowDays : ""}
            onChange={(e) =>
              setDraft({ ...draft, windowDays: Number.parseInt(e.target.value, 10) })
            }
          />
        </FormField>
      </div>

      <div className="flex flex-col gap-2">
        <span className="field-label !mb-0">{t("stats.journeys.goals")}</span>
        {draft.goals.map((goal, i) => {
          const dimensions = events.find((e) => e.event === goal.event)?.dimensions;
          const options =
            pickable.includes(goal.event) || !goal.event ? pickable : [goal.event, ...pickable];
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: goals have no identity but their place
            <div key={i} className="card flex flex-col gap-2 p-3">
              <div className="grid items-end gap-2 md:grid-cols-[24px_1fr_1fr_1fr_auto]">
                <span className="pb-2 text-[12px] tabular-nums text-[var(--text-faint)]">
                  {i + 1}
                </span>
                <FormField label={t("stats.journeys.goalName")}>
                  <Input
                    value={goal.name}
                    maxLength={80}
                    placeholder={t("stats.journeys.goalNameExample")}
                    onChange={(e) => setGoal(i, { name: e.target.value })}
                  />
                </FormField>
                <FormField label={t("stats.journeys.goalEvent")}>
                  <select
                    className="input"
                    value={goal.event}
                    onChange={(e) => setGoal(i, { event: e.target.value })}
                  >
                    <option value="">{t("stats.journeys.pickEvent")}</option>
                    {options.map((event) => (
                      <option key={event} value={event}>
                        {event}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label={t("stats.journeys.goalFilter")}>
                  <Input
                    value={filters[i] ?? ""}
                    placeholder={dimensions?.[0] ? `${dimensions[0]}=…` : "name=value"}
                    aria-invalid={parsed[i] === null}
                    onChange={(e) => {
                      const text = e.target.value;
                      setFilters((f) => f.map((x, n) => (n === i ? text : x)));
                      const dims = parseFilter(text);
                      if (dims) setGoal(i, { dims });
                    }}
                  />
                </FormField>
                <div className="flex gap-1 pb-0.5">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("stats.journeys.moveUp")}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp size={14} aria-hidden />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("stats.journeys.moveDown")}
                    disabled={i === draft.goals.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown size={14} aria-hidden />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("stats.journeys.removeGoal")}
                    onClick={() => {
                      setDraft((d) => ({ ...d, goals: d.goals.filter((_, n) => n !== i) }));
                      setFilters((f) => f.filter((_, n) => n !== i));
                    }}
                  >
                    <Trash2 size={14} aria-hidden />
                  </Button>
                </div>
              </div>
              {dimensions && dimensions.length > 0 && (
                <span className="text-[11.5px] text-[var(--text-faint)]">
                  {t("stats.journeys.dimensions", { list: dimensions.join(", ") })}
                </span>
              )}
            </div>
          );
        })}
        <div>
          <Button
            size="sm"
            variant="outline"
            disabled={draft.goals.length >= MAX_GOALS}
            onClick={() => {
              setDraft((d) => ({ ...d, goals: [...d.goals, emptyGoal()] }));
              setFilters((f) => [...f, ""]);
            }}
          >
            <Plus size={14} aria-hidden />
            {t("stats.journeys.addGoal")}
          </Button>
        </div>
      </div>

      {(problems.length > 0 || badFilter || failed) && (
        <ul className="text-[12px] text-[var(--danger)]">
          {problems.map((p) => (
            <li key={p}>{t(`stats.journeys.problem.${p}`)}</li>
          ))}
          {badFilter && <li>{t("stats.journeys.problem.filter")}</li>}
          {failed && <li>{t("stats.journeys.problem.save")}</li>}
        </ul>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("stats.journeys.cancel")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={problems.length > 0 || badFilter}
          onClick={() =>
            onSave({
              ...draft,
              name: draft.name.trim(),
              goals: draft.goals.map((g) => ({ ...g, name: g.name.trim() })),
            })
          }
        >
          {t("stats.journeys.save")}
        </Button>
      </div>
    </Panel>
  );
}

function JourneyResults({
  scope,
  journey,
}: { scope: StatsScope; journey: StatsJourney | undefined }) {
  const { t } = useTranslation();
  const { serverId, lang } = scope;
  const period = journeyPeriod(scope.period);
  const cut = period.from !== scope.period.from;
  const goals = journey?.goals ?? [];
  const windowDays = journey?.windowDays ?? DEFAULT_WINDOW_DAYS;
  const result = useLoaded(
    `${serverId}|${period.from}|${period.to}|${windowDays}|${JSON.stringify(goals)}`,
    () => computeStatsJourney(serverId, { ...period, windowDays, goals }),
  );
  if (result.error) return <PanelEmpty>{t("stats.unavailable")}</PanelEmpty>;
  const data = result.data;
  if (!data) return <PanelLoading height={360} />;

  const count = (n: number) => formatCount(n, lang);
  const share = (ratio: number) =>
    new Intl.NumberFormat(lang, { style: "percent", maximumFractionDigits: 0 }).format(ratio);
  const week = (start: number) =>
    new Intl.DateTimeFormat(lang, { day: "numeric", month: "short" }).format(
      new Date(start * 1000),
    );
  // Past two days a median reads in days: `52 h 46` says less than `2 d`.
  const time = (seconds: number) =>
    seconds >= 2 * 86_400
      ? t("stats.journeys.days", { count: Math.round(seconds / 86_400) })
      : formatDuration(seconds);
  const curve = retentionCurve(data.retentionCurve);
  const retained = (points: Cohort["retention"], day: number) =>
    retentionShare(points.find((p) => p.day === day));

  const columns: SortableColumn<Cohort>[] = [
    {
      id: "week",
      label: t("stats.journeys.week"),
      value: (c) => c.weekStart,
      render: (c) => t("stats.journeys.weekOf", { date: week(c.weekStart) }),
    },
    {
      id: "arrivals",
      label: t("stats.journeys.arrivals"),
      align: "right",
      value: (c) => c.arrivals,
      render: (c) => count(c.arrivals),
    },
    ...data.steps.map(
      (step, i): SortableColumn<Cohort> => ({
        id: `goal-${i}`,
        label: step.name,
        align: "right",
        value: (c) => (c.arrivals > 0 ? (c.reached[i] ?? 0) / c.arrivals : 0),
        render: (c) => (c.arrivals > 0 ? share((c.reached[i] ?? 0) / c.arrivals) : "–"),
      }),
    ),
    ...[1, 7].map(
      (day): SortableColumn<Cohort> => ({
        id: `d${day}`,
        label: t("stats.journeys.dayN", { day }),
        align: "right",
        value: (c) => retained(c.retention, day) ?? -1,
        render: (c) => {
          const ratio = retained(c.retention, day);
          return ratio === null ? "–" : share(ratio);
        },
      }),
    ),
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={t("stats.journeys.arrivals")}
          value={count(data.arrivals)}
          sub={t("stats.journeys.arrivalsSub")}
        />
        {data.retention.map((point) => {
          const ratio = retentionShare(point);
          return (
            <StatCard
              key={point.day}
              label={t("stats.journeys.retentionDay", { day: point.day })}
              value={ratio === null ? "–" : share(ratio)}
              sub={
                ratio === null
                  ? t("stats.journeys.tooEarly")
                  : t("stats.journeys.returned", {
                      returned: count(point.returned),
                      eligible: count(point.eligible),
                    })
              }
            />
          );
        })}
      </div>
      {cut && (
        <p className="text-[12px] text-[var(--text-faint)]">{t("stats.journeys.periodCut")}</p>
      )}

      {data.arrivals === 0 ? (
        <PanelEmpty>{t("stats.journeys.nobody")}</PanelEmpty>
      ) : (
        <>
          <Panel title={t("stats.journeys.curve")} hint={t("stats.journeys.curveHint")}>
            {curve.length > 0 ? (
              <TimeChart
                label={t("stats.journeys.curve")}
                formatY={share}
                series={[
                  {
                    id: "retention",
                    label: t("stats.journeys.curveSeries"),
                    color: "var(--chart-1)",
                    points: curve.map((p) => ({
                      label: t("stats.journeys.dayN", { day: p.day }),
                      y: p.share,
                    })),
                  },
                ]}
              />
            ) : (
              <PanelEmpty>{t("stats.journeys.curveTooEarly")}</PanelEmpty>
            )}
          </Panel>
          {data.steps.length > 0 && (
            <Panel
              title={journey?.name ?? t("stats.journeys.funnel")}
              hint={t("stats.journeys.withinDays", { count: windowDays })}
            >
              <Funnel
                steps={[
                  { id: "arrived", label: t("stats.journeys.arrived"), value: data.arrivals },
                  ...data.steps.map((step, i) => ({
                    id: `goal-${i}`,
                    label:
                      step.medianSeconds === null
                        ? step.name
                        : t("stats.journeys.stepMedian", {
                            name: step.name,
                            time: time(step.medianSeconds),
                          }),
                    value: step.players,
                  })),
                ]}
                formatValue={count}
                formatShare={share}
              />
            </Panel>
          )}

          <Panel title={t("stats.journeys.cohorts")} hint={t("stats.journeys.cohortsHint")}>
            <SortableTable
              rows={data.cohorts}
              rowId={(c) => String(c.weekStart)}
              initialSort="week"
              columns={columns}
            />
          </Panel>

          <Panel
            title={t("stats.journeys.lastActions")}
            hint={t("stats.journeys.lastActionsHint", {
              count: data.leavers,
              days: data.awayDays,
            })}
          >
            {data.lastActions.length === 0 ? (
              <PanelEmpty>{t("stats.journeys.noLastAction")}</PanelEmpty>
            ) : (
              <BarList
                rows={data.lastActions.map((action) => ({
                  id: actionLabel(action.event, action.dimensions),
                  label: actionLabel(action.event, action.dimensions),
                  value: action.players,
                  caption: `${count(action.players)} · ${share(action.players / Math.max(1, data.leavers))}`,
                }))}
              />
            )}
          </Panel>
        </>
      )}
    </>
  );
}
