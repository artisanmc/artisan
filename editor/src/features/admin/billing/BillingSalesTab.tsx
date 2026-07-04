import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { HBar } from "@/components/ui/h-bar";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/ui/stat-card";
import { getSales, type SalesSummary } from "@/lib/api/adminBilling";
import { formatCredits, formatMoney } from "@/lib/format";
import { LineChart } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type Period = "7d" | "30d" | "custom";

const EMPTY_SUMMARY: SalesSummary = {
  from: "",
  to: "",
  topups: { count: 0, byCurrency: {} },
  subscriptions: { activeCount: 0, mrrByCurrency: {}, perPlan: [] },
  daily: [],
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

function isEmptySummary(s: SalesSummary): boolean {
  return (
    s.topups.count === 0 &&
    Object.keys(s.topups.byCurrency).length === 0 &&
    s.subscriptions.activeCount === 0 &&
    s.subscriptions.perPlan.length === 0 &&
    s.daily.length === 0
  );
}

export function BillingSalesTab() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [period, setPeriod] = useState<Period>("30d");
  const [from, setFrom] = useState(() => isoDaysAgo(30));
  const [to, setTo] = useState(() => new Date().toISOString());
  const [summary, setSummary] = useState<SalesSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSales(from, to)
      .then((s) => {
        if (cancelled) return;
        setSummary(s ?? EMPTY_SUMMARY);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        console.warn("[admin-billing] sales fetch failed:", e);
        setSummary(EMPTY_SUMMARY);
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

  const s = summary ?? EMPTY_SUMMARY;

  const perPlanMax = useMemo(
    () => Math.max(1, ...s.subscriptions.perPlan.map((p) => p.activeCount)),
    [s],
  );
  const dailyMax = useMemo(() => Math.max(1, ...s.daily.map((d) => d.topupCents)), [s]);

  const noData = summary != null && isEmptySummary(summary);

  const topupRevenueEntries = Object.entries(s.topups.byCurrency);
  const mrrEntries = Object.entries(s.subscriptions.mrrByCurrency);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-[18px] font-semibold text-[var(--text)]">{t("admin.billing.sales.title")}</h2>
        <p className="text-[13.5px] text-[var(--text-mut)]">{t("admin.billing.sales.subtitle")}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Button
          type="button"
          variant={period === "7d" ? "primary" : "outline"}
          size="sm"
          onClick={() => selectPeriod("7d")}
        >
          {t("admin.billing.sales.range.7d")}
        </Button>
        <Button
          type="button"
          variant={period === "30d" ? "primary" : "outline"}
          size="sm"
          onClick={() => selectPeriod("30d")}
        >
          {t("admin.billing.sales.range.30d")}
        </Button>
        <label className="flex flex-col gap-1 text-[12px] text-[var(--text-mut)]">
          {t("admin.billing.sales.range.from")}
          <Input type="date" value={toDateInputValue(from)} onChange={(e) => handleCustomFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-[var(--text-mut)]">
          {t("admin.billing.sales.range.to")}
          <Input type="date" value={toDateInputValue(to)} onChange={(e) => handleCustomTo(e.target.value)} />
        </label>
      </div>

      {noData ? (
        <EmptyState icon={LineChart} title={t("admin.billing.sales.noData")} className="h-auto py-16" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label={t("admin.billing.sales.stat.topupRevenue")}
              value={
                topupRevenueEntries.length === 0
                  ? formatMoney(0, "usd", lang)
                  : topupRevenueEntries.map(([cur, cents]) => formatMoney(cents, cur, lang)).join(" / ")
              }
            />
            <StatCard label={t("admin.billing.sales.stat.topupCount")} value={formatCredits(s.topups.count, lang)} />
            <StatCard
              label={t("admin.billing.sales.stat.activeSubs")}
              value={formatCredits(s.subscriptions.activeCount, lang)}
            />
            <StatCard
              label={t("admin.billing.sales.stat.mrr")}
              value={
                mrrEntries.length === 0
                  ? formatMoney(0, "usd", lang)
                  : mrrEntries.map(([cur, cents]) => formatMoney(cents, cur, lang)).join(" / ")
              }
            />
          </div>

          <div className="card flex flex-col gap-3 p-4">
            <span className="eyebrow">{t("admin.billing.sales.perPlan")}</span>
            {s.subscriptions.perPlan.map((p) => (
              <HBar
                key={p.planId}
                label={p.planName}
                value={p.activeCount}
                max={perPlanMax}
                caption={formatMoney(p.priceCents * p.activeCount, p.currency, lang)}
              />
            ))}
          </div>

          <div className="card flex flex-col gap-3 p-4">
            <span className="eyebrow">{t("admin.billing.sales.daily")}</span>
            {s.daily.map((d) => (
              <HBar
                key={d.date}
                label={new Date(d.date).toLocaleDateString(lang)}
                value={d.topupCents}
                max={dailyMax}
                caption={formatCredits(d.topupCount, lang)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
