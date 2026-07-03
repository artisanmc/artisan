import { formatCredits } from "@/lib/format";
import { useTranslation } from "react-i18next";

/** BalanceChip — the assistant's remaining-credits pill in the composer. Hidden while loading (`balance === null`). */
export function BalanceChip({ balance }: { balance: number | null }) {
  const { t, i18n } = useTranslation();
  if (balance === null) return null;
  return (
    <span className="shrink-0 whitespace-nowrap text-[12px] text-[var(--text-mut)] tabular-nums">
      {t("assistant.balance.credits", { n: formatCredits(balance, i18n.language) })}
    </span>
  );
}
