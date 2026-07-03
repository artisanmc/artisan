import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { HBar } from "@/components/ui/h-bar";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/ui/stat-card";
import { getUsageSummary, type UsageSummary } from "@/lib/api/adminAiUsage";
import { formatCredits, formatTokens, formatUsdFromMicro } from "@/lib/format";
import { Link } from "@tanstack/react-router";
import { BarChart3 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type Period = "7d" | "30d" | "custom";

const ZERO_TOTALS: UsageSummary["totals"] = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  creditsCharged: 0,
  realCostMicroUsd: 0,
  marginMicroUsd: 0,
  turns: 0,
  errors: 0,
};

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function toDateInputValue(iso: string): string {
  return iso.slice(0, 10);
}

/** Custom "to" dates come from a bare <input type="date"> (midnight UTC) — clamp
 * to the end of that day so the selected day's rows aren't excluded. */
function endOfDayIso(value: string): string {
  const d = new Date(value); // date-only strings parse as UTC midnight
  d.setUTCHours(23, 59, 59, 999);
  return d.toISOString();
}

function isEmptySummary(s: UsageSummary): boolean {
  const t = s.totals;
  return (
    t.inputTokens === 0 &&
    t.outputTokens === 0 &&
    t.creditsCharged === 0 &&
    t.turns === 0 &&
    t.errors === 0 &&
    s.byModel.length === 0 &&
    s.byProvider.length === 0 &&
    s.daily.length === 0
  );
}

export function AiUsagePage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [period, setPeriod] = useState<Period>("30d");
  const [from, setFrom] = useState(() => isoDaysAgo(30));
  const [to, setTo] = useState(() => new Date().toISOString());
  const [summary, setSummary] = useState<UsageSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    getUsageSummary(from, to)
      .then((s) => {
        if (cancelled) return;
        setSummary(s ?? { totals: ZERO_TOTALS, byModel: [], byProvider: [], daily: [] });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        console.warn("[admin-ai] fetch failed:", e);
        setSummary({ totals: ZERO_TOTALS, byModel: [], byProvider: [], daily: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  function selectPeriod(p: "7d" | "30d") {
    setPeriod(p);
    setFrom(isoDaysAgo(p === "7d" ? 7 : 30));
    setTo(new Date().toISOString());
  }

  function handleCustomFrom(value: string) {
    if (!value) return;
    setPeriod("custom");
    setFrom(new Date(value).toISOString());
  }

  function handleCustomTo(value: string) {
    if (!value) return;
    setPeriod("custom");
    setTo(endOfDayIso(value));
  }

  const totals = summary?.totals ?? ZERO_TOTALS;
  const marginTone = totals.marginMicroUsd > 0 ? "positive" : totals.marginMicroUsd < 0 ? "negative" : "default";

  const byModelMax = useMemo(
    () => Math.max(1, ...(summary?.byModel.map((m) => m.creditsCharged) ?? [0])),
    [summary],
  );
  const byProviderMax = useMemo(
    () => Math.max(1, ...(summary?.byProvider.map((p) => p.creditsCharged) ?? [0])),
    [summary],
  );
  const dailyMax = useMemo(
    () => Math.max(1, ...(summary?.daily.map((d) => d.creditsCharged) ?? [0])),
    [summary],
  );

  const noData = summary != null && isEmptySummary(summary);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1
            className="display text-[32px] tracking-tight text-[var(--text)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {t("admin.ai.usage.title")}
          </h1>
          <p className="text-[13.5px] text-[var(--text-mut)]">{t("admin.ai.usage.subtitle")}</p>
        </div>
        <Link to="/admin/ai/usage/logs" className="btn btn-sm btn-outline">
          {t("admin.ai.logs.title")}
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Button
          type="button"
          variant={period === "7d" ? "primary" : "outline"}
          size="sm"
          onClick={() => selectPeriod("7d")}
        >
          {t("admin.ai.usage.range.7d")}
        </Button>
        <Button
          type="button"
          variant={period === "30d" ? "primary" : "outline"}
          size="sm"
          onClick={() => selectPeriod("30d")}
        >
          {t("admin.ai.usage.range.30d")}
        </Button>
        <label className="flex flex-col gap-1 text-[12px] text-[var(--text-mut)]">
          {t("admin.ai.usage.range.from")}
          <Input type="date" value={toDateInputValue(from)} onChange={(e) => handleCustomFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-[var(--text-mut)]">
          {t("admin.ai.usage.range.to")}
          <Input type="date" value={toDateInputValue(to)} onChange={(e) => handleCustomTo(e.target.value)} />
        </label>
      </div>

      {noData ? (
        <EmptyState icon={BarChart3} title={t("admin.ai.usage.noData")} className="h-auto py-16" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label={t("admin.ai.usage.stat.inputTokens")} value={formatTokens(totals.inputTokens, lang)} />
            <StatCard label={t("admin.ai.usage.stat.outputTokens")} value={formatTokens(totals.outputTokens, lang)} />
            <StatCard
              label={t("admin.ai.usage.stat.creditsCharged")}
              value={formatCredits(totals.creditsCharged, lang)}
            />
            <StatCard
              label={t("admin.ai.usage.stat.realCost")}
              value={formatUsdFromMicro(totals.realCostMicroUsd, lang)}
            />
            <StatCard
              label={t("admin.ai.usage.stat.margin")}
              value={formatUsdFromMicro(totals.marginMicroUsd, lang)}
              tone={marginTone}
            />
            <StatCard label={t("admin.ai.usage.stat.turns")} value={formatCredits(totals.turns, lang)} />
            <StatCard label={t("admin.ai.usage.stat.errors")} value={formatCredits(totals.errors, lang)} />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="card flex flex-col gap-3 p-4">
              <span className="eyebrow">{t("admin.ai.usage.byModel")}</span>
              {(summary?.byModel ?? []).map((m) => (
                <HBar
                  key={`${m.provider}:${m.modelId ?? m.modelName}`}
                  label={m.modelName}
                  value={m.creditsCharged}
                  max={byModelMax}
                  caption={formatCredits(m.creditsCharged, lang)}
                />
              ))}
            </div>
            <div className="card flex flex-col gap-3 p-4">
              <span className="eyebrow">{t("admin.ai.usage.byProvider")}</span>
              {(summary?.byProvider ?? []).map((p) => (
                <HBar
                  key={p.provider}
                  label={p.provider}
                  value={p.creditsCharged}
                  max={byProviderMax}
                  caption={formatCredits(p.creditsCharged, lang)}
                />
              ))}
            </div>
          </div>

          <div className="card flex flex-col gap-3 p-4">
            <span className="eyebrow">{t("admin.ai.usage.daily")}</span>
            {(summary?.daily ?? []).map((d) => (
              <HBar
                key={d.date}
                label={d.date}
                value={d.creditsCharged}
                max={dailyMax}
                caption={formatCredits(d.creditsCharged, lang)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
