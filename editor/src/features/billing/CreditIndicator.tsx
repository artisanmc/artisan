import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HBar } from "@/components/ui/h-bar";
import type { BalanceBreakdown } from "@/lib/api/billing";
import { formatCredits } from "@/lib/format";
import { useTranslation } from "react-i18next";

export type CreditTone = "ok" | "low" | "critical" | "empty";

export function creditTone(b: BalanceBreakdown): CreditTone {
  if (b.total <= 0) return "empty";
  // Tone reflects TOTAL spendable runway (subscription + rollover + topup),
  // measured against the monthly quota as a reference. Basing it on the
  // subscription bucket alone would cry wolf every period-end for any
  // subscriber who still has rollover/top-up credits.
  if (b.subscriptionQuota && b.subscriptionQuota > 0) {
    const ratio = b.total / b.subscriptionQuota;
    if (ratio < 0.05) return "critical";
    if (ratio < 0.2) return "low";
  }
  return "ok";
}

// tone → semantic token for the status dot (no hex/rgba literals).
// Traffic-light tones — must stay visually distinct so a low/critical balance
// alarms. --brand is NOT used: it equals --success (emerald) in the light theme,
// which would make "critical" indistinguishable from "ok". Both critical and
// empty use --danger (act-now red); low is --warning (amber); ok is --success.
const DOT: Record<CreditTone, string> = {
  ok: "var(--success)",
  low: "var(--warning)",
  critical: "var(--danger)",
  empty: "var(--danger)",
};

export function CreditIndicator({
  balance,
  onRecharge,
  compact,
}: {
  balance: BalanceBreakdown | null;
  /** Omit on the credits page itself — hides the recharge action. */
  onRecharge?: () => void;
  compact?: boolean;
}) {
  const { t, i18n } = useTranslation();
  if (balance === null) return null;
  const tone = creditTone(balance);
  const totalStr = formatCredits(balance.total, i18n.language);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-tone={tone}
          aria-label={t("billing.indicator.ariaLabel", { n: totalStr })}
          className="flex h-[34px] shrink-0 items-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface-raised)] px-3 font-mono text-[12px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
        >
          <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: DOT[tone] }} />
          <span className="tabular-nums">
            {compact ? totalStr : t("billing.indicator.total", { n: totalStr })}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[16rem]">
        <DropdownMenuLabel>{t("billing.indicator.breakdownTitle")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="flex flex-col gap-2 px-2 py-1.5 text-[12.5px]">
          {balance.subscriptionQuota && balance.subscriptionQuota > 0 ? (
            <HBar
              label={t("billing.indicator.subscription")}
              value={balance.subscription}
              max={balance.subscriptionQuota}
              caption={t("billing.indicator.quotaUsed", {
                used: formatCredits(balance.subscription, i18n.language),
                quota: formatCredits(balance.subscriptionQuota, i18n.language),
              })}
            />
          ) : (
            <Row
              label={t("billing.indicator.subscription")}
              value={formatCredits(balance.subscription, i18n.language)}
            />
          )}
          <Row
            label={t("billing.indicator.rollover")}
            value={formatCredits(balance.rollover, i18n.language)}
          />
          <Row
            label={t("billing.indicator.topup")}
            value={formatCredits(balance.topup, i18n.language)}
          />
          {balance.periodEnd ? (
            <p className="text-[11.5px] text-[var(--text-mut)]">
              {t("billing.indicator.renews", {
                date: new Date(balance.periodEnd).toLocaleDateString(i18n.language),
              })}
            </p>
          ) : null}
          {onRecharge && (
            <Button variant="primary" size="sm" className="mt-1 w-full" onClick={onRecharge}>
              {t("billing.indicator.recharge")}
            </Button>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[var(--text-mut)]">{label}</span>
      <span className="tabular-nums text-[var(--text)]">{value}</span>
    </div>
  );
}
