import type { ProjectId } from "@/domain/types";
import { useProjectsStore } from "@/state/projectsStore";
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Over the canvas while it shows the module's original ("View as" > Module original): the view
 * is read-only, and the way out.
 */
export function OriginalBanner({ projectId }: { projectId: ProjectId }) {
  const { t } = useTranslation();
  const view = useProjectsStore(
    (s) => s.openProjects.projects.find((p) => p.id === projectId)?.originalView,
  );
  if (!view) return null;
  return (
    <div
      data-testid="original-banner"
      className="-translate-x-1/2 absolute top-3 left-1/2 z-20 flex items-center gap-2.5 rounded-full border border-[var(--brand-line)] bg-[var(--surface-raised)]/95 py-1.5 pr-1.5 pl-3.5 text-[var(--text)] backdrop-blur"
      style={{ boxShadow: "var(--shadow-md)" }}
    >
      <Lock className="size-3.5 shrink-0 text-[var(--brand)]" />
      <span className="text-[12.5px]">
        <strong className="font-semibold text-[var(--brand)]">
          {t("variants.originalBanner", { name: view.variant ?? t("variants.module") })}
        </strong>{" "}
        {t("variants.originalBannerHint")}
      </span>
      <button
        type="button"
        onClick={() => useProjectsStore.getState().showOriginal(projectId, false)}
        className="btn btn-ghost h-6 rounded-full px-2.5 text-[12px]"
      >
        {t("variants.originalLeave")}
      </button>
    </div>
  );
}
