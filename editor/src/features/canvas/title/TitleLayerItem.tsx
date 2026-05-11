import { Image as ImageIcon, Sparkles, Trash2, Type as TypeIcon, Wand2 } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import type { Asset } from "@/domain/asset";
import type { MenuTitleLayer } from "@/domain/types";
import { cn } from "@/lib/cx";

interface TitleLayerItemProps {
  layer: MenuTitleLayer;
  index: number;
  selected: boolean;
  /**
   * Pre-resolved label preview. Built by `TitleLayerList` so this component
   * stays unaware of stores / i18n lookups.
   */
  preview: string;
  /** Pre-resolved asset (background/glyph only). Used for the type icon hint. */
  asset?: Asset;
  onSelect: () => void;
  onDelete: () => void;
  onEditText?: () => void;
  onDragStart: (e: React.DragEvent<HTMLDivElement>, index: number) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>, index: number) => void;
}

function KindIcon({ kind }: { kind: MenuTitleLayer["kind"] }) {
  if (kind === "background") {
    return <ImageIcon aria-hidden="true" className="size-4 text-zinc-400" />;
  }
  if (kind === "glyph") {
    return <Sparkles aria-hidden="true" className="size-4 text-zinc-400" />;
  }
  if (kind === "text") {
    return <TypeIcon aria-hidden="true" className="size-4 text-zinc-400" />;
  }
  // external_glyph
  return <Wand2 aria-hidden="true" className="size-4 text-amber-400" />;
}

/**
 * One row in the title layer list. The row itself is the drop target; the
 * delete button is a child that stops propagation so clicking it doesn't
 * also fire `onSelect`. Double-click on a text row escalates to
 * `onEditText` (forward hook for the TitleTextEditor modal in Task 9).
 *
 * Mobile-first: visible delete icon at all sizes — no hover-only reveal.
 */
export function TitleLayerItem({
  layer,
  index,
  selected,
  preview,
  onSelect,
  onDelete,
  onEditText,
  onDragStart,
  onDragOver,
  onDrop,
}: TitleLayerItemProps) {
  return (
    <div
      data-testid="title-layer-row"
      data-selected={selected ? "true" : "false"}
      draggable
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(e, index)}
      onClick={onSelect}
      onDoubleClick={() => {
        if (layer.kind === "text") onEditText?.();
      }}
      className={cn(
        "flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs",
        "cursor-grab active:cursor-grabbing select-none",
        selected
          ? "border-emerald-500 bg-emerald-500/10 text-zinc-100"
          : "border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800",
      )}
    >
      <KindIcon kind={layer.kind} />
      <span className="flex-1 truncate font-mono">{preview}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Delete layer ${index + 1}`}
        data-testid="title-layer-delete"
        className="h-6 w-6 text-zinc-400 hover:text-red-400"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}
