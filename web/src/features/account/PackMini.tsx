import type { Pack, PackId } from "@/domain/types";
import { cx } from "@/lib/cx";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { PackMiniPreview } from "./PackMiniPreview";

interface PackMiniProps {
  pack: Pack;
  active: boolean;
}

const sourceLabel = (source: Pack["source"]) =>
  source === "imported" ? "imp" : source === "forked" ? "fork" : "user";

const sourceColor = (source: Pack["source"]) =>
  source === "imported"
    ? "bg-blue-500/15 text-blue-300"
    : source === "forked"
      ? "bg-amber-500/15 text-amber-300"
      : "bg-emerald-500/15 text-emerald-300";

export function PackMini({ pack, active }: PackMiniProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: pack.id,
  });
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
        "group rounded-md border bg-zinc-950/60 p-2 transition-colors",
        active
          ? "border-emerald-600 ring-1 ring-emerald-600/40"
          : "border-zinc-800 hover:border-zinc-600",
      )}
    >
      <Link
        to="/pack/$packId"
        params={{ packId: pack.id as PackId }}
        className="flex flex-col gap-1.5"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-xs">{pack.name}</span>
          <span className={cx("rounded px-1 py-0.5 text-[9px]", sourceColor(pack.source))}>
            {sourceLabel(pack.source)}
          </span>
        </div>
        <div className="h-16 overflow-hidden rounded border border-zinc-900 bg-[var(--color-bg)]">
          <PackMiniPreview pack={pack} />
        </div>
        <div className="text-[10px] text-zinc-500">
          {pack.menus.length}m · {pack.commands.length}c
        </div>
      </Link>
      {/* Drag handle for reorder — overlays the card without intercepting clicks unless held. */}
      <button
        type="button"
        aria-label="Reorder pack"
        {...attributes}
        {...listeners}
        className="absolute -top-1 right-2 cursor-grab rounded text-[10px] text-zinc-500 opacity-0 group-hover:opacity-100 active:cursor-grabbing"
      >
        ⠿
      </button>
    </div>
  );
}
