import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

/**
 * Shown in place of the composer once a turn comes back with a 402
 * (insufficient credits). Pure presentation — navigation is the caller's job.
 */
export function OutOfCreditsNotice({ onGetCredits }: { onGetCredits: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="assistant-out-of-credits"
      className="flex shrink-0 flex-col items-center gap-2 border-[var(--border-soft)] border-t p-4 text-center"
    >
      <p className="text-[13px] font-semibold text-[var(--text)]">
        {t("assistant.outOfCredits.title")}
      </p>
      <p className="text-[12px] text-[var(--text-mut)]">{t("assistant.outOfCredits.body")}</p>
      <Button variant="primary" size="sm" onClick={onGetCredits}>
        {t("assistant.outOfCredits.cta")}
      </Button>
    </div>
  );
}
