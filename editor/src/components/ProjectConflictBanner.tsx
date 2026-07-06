import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useProjectVersionStore } from "@/state/projectVersionStore";

/**
 * Blocking notice shown when a save was rejected with 409: another writer
 * (other tab, other admin, plugin push, deploy) advanced the project since
 * this tab loaded it. Auto-save is suspended for the project while flagged
 * (see useProjectAutoSave); reloading picks up the server state.
 */
export function ProjectConflictBanner({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const conflicted = useProjectVersionStore((s) => !!s.conflicts[projectId]);
  if (!conflicted) return null;
  return (
    <div
      role="alert"
      className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--border-soft)] bg-[var(--surface-raised)] px-5 py-2.5"
    >
      <span className="text-[13px] font-medium text-[var(--text)]">
        {t("project.conflict.title")}
      </span>
      <span className="text-[13px] text-[var(--text-muted)]">
        {t("project.conflict.body")}
      </span>
      <Button size="sm" onClick={() => window.location.reload()}>
        {t("project.conflict.reload")}
      </Button>
    </div>
  );
}
