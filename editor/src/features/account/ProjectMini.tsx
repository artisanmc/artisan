import type { Project } from "@/domain/types";
import { projectDestination } from "@/lib/projectNavigation";
import { cx } from "@/lib/cx";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { ProjectMiniPreview } from "./ProjectMiniPreview";

interface ProjectMiniProps {
  project: Project;
  active: boolean;
}

const sourceLabelKey = (source: Project["source"]): "sourceImported" | "sourceForked" | "sourceUser" =>
  source === "imported" ? "sourceImported" : source === "forked" ? "sourceForked" : "sourceUser";

const sourceColor = (source: Project["source"]) =>
  source === "imported"
    ? "bg-[var(--brand-soft)] text-[var(--brand)]"
    : source === "forked"
      ? "bg-[var(--warning-soft)] text-[var(--warning)]"
      : "bg-[var(--success-soft)] text-[var(--success)]";

export function ProjectMini({ project, active }: ProjectMiniProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: project.id,
  });
  const { t } = useTranslation();
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-project-id={project.id}
      data-project-mini="true"
      className={cx(
        "group rounded-md border bg-[var(--surface)]/60 p-2 transition-colors",
        active
          ? "border-[var(--brand)] ring-1 ring-[var(--brand-line)]"
          : "border-[var(--border-soft)] hover:border-[var(--border)]",
      )}
    >
      <Link
        {...projectDestination(project, project.serverKeyId)}
        className="flex flex-col gap-1.5"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-xs">{project.name}</span>
          <span className={cx("rounded px-1 py-0.5 text-[9px]", sourceColor(project.source))}>
            {t(`projectMini.${sourceLabelKey(project.source)}`)}
          </span>
        </div>
        <div className="h-16 overflow-hidden rounded border border-[var(--border-soft)] bg-[var(--color-bg)]">
          <ProjectMiniPreview project={project} />
        </div>
        <div className="text-[10px] text-[var(--text-faint)]">
          {t("projectMini.countMenusCommands", {
            menus: project.menus.length,
            commands: project.commands.length,
          })}
        </div>
      </Link>
      {/* Drag handle for reorder — overlays the card without intercepting clicks unless held. */}
      <button
        type="button"
        aria-label={t("projectMini.reorderProject")}
        {...attributes}
        {...listeners}
        className="absolute -top-1 right-2 flex h-6 w-6 cursor-grab items-center justify-center rounded text-[12px] text-[var(--text-faint)] opacity-100 active:cursor-grabbing lg:opacity-0 lg:group-hover:opacity-100"
      >
        ⠿
      </button>
    </div>
  );
}
