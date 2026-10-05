import type { Project } from "@/domain/types";
import { projectUrlId } from "@/lib/projectUrlId";
import { DeleteProjectDialog } from "@/features/account/DeleteProjectDialog";
import { useAccountStore } from "@/state/accountStore";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PropertyField } from "./PropertyField";

interface ProjectPropertiesProps {
  project: Project;
}

const sourceLabelKey = (
  source: Project["source"],
): "sourceImported" | "sourceForked" | "sourceUser" =>
  source === "imported" ? "sourceImported" : source === "forked" ? "sourceForked" : "sourceUser";

const sourceColor = (source: Project["source"]) =>
  source === "imported"
    ? "bg-[var(--brand-soft)] text-[var(--brand)]"
    : source === "forked"
      ? "bg-[var(--warning-soft)] text-[var(--warning)]"
      : "bg-[var(--success-soft)] text-[var(--success)]";

export function ProjectProperties({ project }: ProjectPropertiesProps) {
  const setProjectField = useAccountStore((s) => s.setProjectField);
  const { t } = useTranslation();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1 text-[10px] uppercase text-[var(--text-faint)]">{t("projectProperties.id")}</div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-[var(--text-mut)]">{projectUrlId(project)}</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] ${sourceColor(project.source)}`}>
              {t(`projectProperties.${sourceLabelKey(project.source)}`)}
            </span>
          </div>
        </div>
        <PropertyField
          label={t("projectProperties.name")}
          value={project.name}
          onChange={(v) => setProjectField({ projectId: project.id, field: "name", value: v })}
        />
        <PropertyField
          label={t("projectProperties.description")}
          value={project.description ?? ""}
          placeholder={t("projectProperties.descriptionPlaceholder")}
          multiline
          onChange={(v) => setProjectField({ projectId: project.id, field: "description", value: v })}
        />
        <div>
          <PropertyField
            label={t("projectProperties.loreMaxWidth")}
            type="number"
            value={String(project.loreMaxWidth ?? 0)}
            onChange={(v) => setProjectField({ projectId: project.id, field: "loreMaxWidth", value: v })}
          />
          <p className="mt-1 text-[10px] text-[var(--text-faint)]">
            {t("projectProperties.loreMaxWidthHint")}
          </p>
        </div>
      </div>

      <div className="text-[10px] text-[var(--text-faint)]">
        {t("projectProperties.countAssets", {
          assets: project.assets.length,
          assetsPlural: t(
            project.assets.length === 1 ? "projectProperties.assetOne" : "projectProperties.assetOther",
          ),
        })}
      </div>

      <div className="mt-2 border-t border-[var(--border-soft)] pt-4">
        <button
          type="button"
          onClick={() => setDeleteDialogOpen(true)}
          className="inline-flex items-center gap-1.5 rounded border border-[var(--danger-soft)] px-2.5 py-1.5 text-[11px] text-[var(--danger)] hover:border-[var(--danger)] hover:bg-[var(--danger-soft)]"
        >
          <Trash2 className="h-3 w-3" />
          {t("projectProperties.deleteProject")}
        </button>
      </div>

      <DeleteProjectDialog
        projectId={project.id}
        projectName={project.name}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
      />
    </div>
  );
}
