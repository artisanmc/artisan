import type { Project, ProjectId } from "@/domain/types";
import { cx } from "@/lib/cx";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { ProjectMiniPreview } from "./ProjectMiniPreview";

interface ProjectMiniProps {
  pack: Project;
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

export function ProjectMini({ pack, active }: ProjectMiniProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: pack.id,
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
      data-pack-id={pack.id}
      data-pack-mini="true"
      className={cx(
        "group rounded-md border bg-[var(--surface)]/60 p-2 transition-colors",
        active
          ? "border-[var(--brand)] ring-1 ring-[var(--brand-line)]"
          : "border-[var(--border-soft)] hover:border-[var(--border)]",
      )}
    >
      <Link
        to="/project/$projectId"
        params={{ projectId: pack.id as ProjectId }}
        className="flex flex-col gap-1.5"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-xs">{pack.name}</span>
          <span className={cx("rounded px-1 py-0.5 text-[9px]", sourceColor(pack.source))}>
            {t(`projectMini.${sourceLabelKey(pack.source)}`)}
          </span>
        </div>
        <div className="h-16 overflow-hidden rounded border border-[var(--border-soft)] bg-[var(--color-bg)]">
          <ProjectMiniPreview pack={pack} />
        </div>
        <div className="text-[10px] text-[var(--text-faint)]">
          {t("projectMini.countMenusCommands", {
            menus: pack.menus.length,
            commands: pack.commands.length,
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
