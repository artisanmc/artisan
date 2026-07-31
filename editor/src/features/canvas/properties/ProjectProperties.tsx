import type { Project } from "@/domain/types";
import { DeleteProjectDialog } from "@/features/account/DeleteProjectDialog";
import { NewMenuDialog } from "@/features/canvas/NewMenuDialog";
import { NewCommandDialog } from "@/features/canvas/NewCommandDialog";
import { useAccountStore } from "@/state/accountStore";
import { LayoutGrid, Plus, Terminal, Trash2 } from "lucide-react";
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
  const [menuDialogOpen, setMenuDialogOpen] = useState(false);
  const [commandDialogOpen, setCommandDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1 text-[10px] uppercase text-[var(--text-faint)]">{t("projectProperties.id")}</div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-[var(--text-mut)]">{project.id}</span>
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
      </div>

      <ContentsSection
        icon={<LayoutGrid className="h-3.5 w-3.5" />}
        label={t("projectProperties.menusLabel")}
        count={project.menus.length}
        emptyHint={t("projectProperties.menusEmpty")}
        onCreate={() => setMenuDialogOpen(true)}
        createLabel={t("projectProperties.newMenu")}
      />
      <NewMenuDialog projectId={project.id} open={menuDialogOpen} onOpenChange={setMenuDialogOpen} />
      <ContentsSection
        icon={<Terminal className="h-3.5 w-3.5" />}
        label={t("projectProperties.commandsLabel")}
        count={project.commands.length}
        emptyHint={t("projectProperties.commandsEmpty")}
        onCreate={() => setCommandDialogOpen(true)}
        createLabel={t("projectProperties.newCommand")}
      />
      <NewCommandDialog
        projectId={project.id}
        open={commandDialogOpen}
        onOpenChange={setCommandDialogOpen}
      />

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

function ContentsSection({
  icon,
  label,
  count,
  emptyHint,
  onCreate,
  createLabel,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  emptyHint: string;
  onCreate: () => void;
  createLabel: string;
}) {
  const isEmpty = count === 0;
  return (
    <div
      className={
        isEmpty
          ? "flex flex-col gap-2 rounded border border-[var(--border-soft)] border-dashed bg-[var(--surface-raised)]/40 p-3"
          : "flex items-center gap-2"
      }
    >
      <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-faint)] uppercase tracking-wide">
        {icon}
        <span>
          {count} {label}
        </span>
      </div>
      {isEmpty ? <p className="text-[11px] text-[var(--text-mut)]">{emptyHint}</p> : null}
      <button
        type="button"
        onClick={onCreate}
        className={
          isEmpty
            ? "self-start inline-flex items-center gap-1 rounded border border-[var(--brand)]/60 bg-[var(--brand-soft)] px-2.5 py-1.5 text-[11px] text-[var(--brand)] hover:bg-[var(--brand)]/20"
            : "ml-auto inline-flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-raised-2)]"
        }
      >
        <Plus className="h-3 w-3" />
        {createLabel}
      </button>
    </div>
  );
}
