import { useTranslation } from "react-i18next";
import { useConflictsStore } from "@/state/conflictsStore";

export interface ConflictBannerProps {
  onSeeDetails: () => void;
}

export function ConflictBanner({ onSeeDetails }: ConflictBannerProps) {
  const { t } = useTranslation();
  const count = useConflictsStore((s) => s.conflicts.length);
  if (count === 0) return null;
  const title = count === 1
    ? t("sync.banner.titleSingular")
    : t("sync.banner.titlePlural", { count });
  return (
    <div className="w-full bg-yellow-50 border-b border-yellow-300 px-4 py-2 flex items-center justify-between">
      <div className="text-sm">
        <span className="font-medium text-yellow-900">⚠ {title}</span>{" "}
        <span className="text-yellow-700">{t("sync.banner.subtitle")}</span>
      </div>
      <button
        type="button"
        onClick={onSeeDetails}
        className="text-sm font-medium text-yellow-900 underline hover:no-underline"
      >
        {t("sync.banner.seeDetails")}
      </button>
    </div>
  );
}
