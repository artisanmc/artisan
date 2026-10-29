import { useTranslation } from "react-i18next";

import { cn } from "@/lib/cx";

/**
 * Marks a control reserved to Artisan Pro in the free jar. Next to a disabled button or option,
 * with the reason in its tooltip.
 */
export function ProBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <span className={cn("badge badge-amber", className)} title={t("edition.proOnly")}>
      {t("edition.pro")}
    </span>
  );
}
