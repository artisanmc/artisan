import type { BalanceBreakdown } from "@/lib/api/billing";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HBar } from "@/components/ui/h-bar";
import { formatCredits } from "@/lib/format";
import { useTranslation } from "react-i18next";

export type CreditTone = "ok" | "low" | "critical" | "empty";

export function creditTone(b: BalanceBreakdown): CreditTone {
	if (b.total <= 0) return "empty";
	if (b.subscriptionQuota && b.subscriptionQuota > 0) {
		const ratio = b.subscription / b.subscriptionQuota;
		if (ratio < 0.05) return "critical";
		if (ratio < 0.2) return "low";
	}
	return "ok";
}

// tone → semantic token for the status dot (no hex/rgba literals).
// Mirrors the sage/amber/terra/brick Badge variant palette (badge-sage → --success,
// badge-amber → --warning, badge-terra → --brand, badge-brick → --danger).
const DOT: Record<CreditTone, string> = {
	ok: "var(--success)",
	low: "var(--warning)",
	critical: "var(--brand)",
	empty: "var(--danger)",
};

export function CreditIndicator({
	balance,
	onRecharge,
	compact,
}: {
	balance: BalanceBreakdown | null;
	onRecharge: () => void;
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
						<Row label={t("billing.indicator.subscription")} value={formatCredits(balance.subscription, i18n.language)} />
					)}
					<Row label={t("billing.indicator.rollover")} value={formatCredits(balance.rollover, i18n.language)} />
					<Row label={t("billing.indicator.topup")} value={formatCredits(balance.topup, i18n.language)} />
					{balance.periodEnd ? (
						<p className="text-[11.5px] text-[var(--text-mut)]">
							{t("billing.indicator.renews", { date: new Date(balance.periodEnd).toLocaleDateString(i18n.language) })}
						</p>
					) : null}
					<Button variant="primary" size="sm" className="mt-1 w-full" onClick={onRecharge}>
						{t("billing.indicator.recharge")}
					</Button>
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
