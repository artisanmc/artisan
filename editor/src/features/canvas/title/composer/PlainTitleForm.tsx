import { LocalizedTextField } from "@/components/LocalizedTextField";
import { MmEditor } from "@/components/minimessage/MmEditor";
import { usePlaceholderEntries } from "@/components/usePlaceholderEntries";
import { menusOf } from "@/domain/documents";
import type { MenuId, ProjectId } from "@/domain/types";
import { CONTAINER_TITLE } from "@/lib/mm/profiles";
import { useProjectsStore } from "@/state/projectsStore";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

interface PlainTitleFormProps {
  projectId: ProjectId;
  menuId: MenuId;
}

/**
 * Inline editor for a vanilla (plain) title layer. Shown directly in the
 * LayersPanel when vanilla mode is active — no layer selection needed.
 */
export function PlainTitleForm({ projectId, menuId }: PlainTitleFormProps) {
  const { t } = useTranslation();
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
  const menu = menusOf(project).find((m) => m.id === menuId);
  const placeholderLocation = useMemo(() => ({ kind: "menu" as const, menuId }), [menuId]);
  const placeholderEntries = usePlaceholderEntries(projectId, placeholderLocation);

  const plainLayer = menu?.title.find((l) => l.kind === "plain");
  if (!plainLayer || plainLayer.kind !== "plain") return null;

  return (
    <div className="flex flex-col gap-3 text-xs text-[var(--text)]">
      <div className="rounded border border-[var(--border)] bg-[var(--surface-inset)]/60 px-2.5 py-2 text-[11px] text-[var(--text-mut)] leading-snug">
        {t("layerEditForm.plainHint")} (<code className="text-[var(--text)]">{"<gold>"}</code>,{" "}
        <code className="text-[var(--text)]">{"<bold>"}</code>, etc.).
      </div>

      <LocalizedTextField
        projectId={projectId}
        lt={plainLayer.value}
        label={t("layerEditForm.plainName")}
        renderEditor={({ value, fallback, label, onChange }) => (
          <MmEditor
            value={value}
            onChange={onChange}
            aria-label={label}
            profile={CONTAINER_TITLE}
            entries={placeholderEntries}
            placeholder={fallback ?? t("layerEditForm.plainPlaceholder")}
            toolbar="focus"
            minHeight="0"
          />
        )}
      />
    </div>
  );
}
