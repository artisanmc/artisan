import type { Pack, PackId } from "@/domain/types";
import { cx } from "@/lib/cx";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { PackMiniPreview } from "./PackMiniPreview";

interface PackMiniProps {
  pack: Pack;
  active: boolean;
}

const sourceLabelKey = (source: Pack["source"]): "sourceImported" | "sourceForked" | "sourceUser" =>
  source === "imported" ? "sourceImported" : source === "forked" ? "sourceForked" : "sourceUser";

const sourceColor = (source: Pack["source"]) =>
  source === "imported"
    ? "bg-[var(--terra-soft)] text-[var(--terra)]"
    : source === "forked"
      ? "bg-[var(--gold-soft)] text-[var(--gold)]"
      : "bg-[var(--sage-soft)] text-[var(--terra)]";

export function PackMini({ pack, active }: PackMiniProps) {
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
        "group rounded-md border bg-[var(--bg-deep)]/60 p-2 transition-colors",
        active
          ? "border-[var(--terra)] ring-1 ring-[var(--terra-line)]"
          : "border-[var(--line-soft)] hover:border-[var(--line)]",
      )}
    >
      <Link
        to="/workspace/$workspaceId"
        params={{ workspaceId: pack.id as PackId }}
        className="flex flex-col gap-1.5"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-xs">{pack.name}</span>
          <span className={cx("rounded px-1 py-0.5 text-[9px]", sourceColor(pack.source))}>
            {t(`packMini.${sourceLabelKey(pack.source)}`)}
          </span>
        </div>
        <div className="h-16 overflow-hidden rounded border border-[var(--line-soft)] bg-[var(--color-bg)]">
          <PackMiniPreview pack={pack} />
        </div>
        <div className="text-[10px] text-[var(--ink-faint)]">
          {t("packMini.countMenusCommands", {
            menus: pack.menus.length,
            commands: pack.commands.length,
          })}
        </div>
      </Link>
      {/* Drag handle for reorder — overlays the card without intercepting clicks unless held. */}
      <button
        type="button"
        aria-label={t("packMini.reorderPack")}
        {...attributes}
        {...listeners}
        className="absolute -top-1 right-2 flex h-6 w-6 cursor-grab items-center justify-center rounded text-[12px] text-[var(--ink-faint)] opacity-100 active:cursor-grabbing lg:opacity-0 lg:group-hover:opacity-100"
      >
        ⠿
      </button>
    </div>
  );
}
