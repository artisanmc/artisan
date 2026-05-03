import { Input } from "@/components/ui/input";
import { cx } from "@/lib/cx";
import { useUiStore } from "@/state/uiStore";
import { useDraggable } from "@dnd-kit/core";
import { type CSSProperties, useState } from "react";
import { useTranslation } from "react-i18next";
import { itemTextureUrl, knownMaterials } from "./itemTextures";

/** ID prefix for Library items inside the top-level DndContext. */
export const LIBRARY_DRAG_PREFIX = "lib:";

interface ItemTileProps {
  name: string;
}

function ItemTile({ name }: ItemTileProps) {
  const url = itemTextureUrl(name);
  const armed = useUiStore((s) => s.armedMaterial === name);
  const setArmedMaterial = useUiStore((s) => s.setArmedMaterial);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${LIBRARY_DRAG_PREFIX}${name}`,
    data: { material: name },
  });
  const style: CSSProperties = {
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <button
      ref={setNodeRef}
      type="button"
      style={style}
      // Tap (without drag) toggles "armed" — the next slot tap places this
      // material. Drag (≥8px) starts a @dnd-kit drag for cross-platform
      // drop on the canvas.
      onClick={() => setArmedMaterial(armed ? null : name)}
      title={name}
      {...listeners}
      {...attributes}
      className={cx(
        "group relative flex h-12 w-12 shrink-0 select-none touch-none items-center justify-center",
        "rounded border bg-zinc-900 active:cursor-grabbing",
        armed
          ? "border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500"
          : "border-zinc-800 cursor-grab hover:border-zinc-600",
      )}
    >
      {url ? (
        <img
          src={url}
          alt={name}
          draggable={false}
          className="pixelated h-3/4 w-3/4 object-contain"
          style={{ imageRendering: "pixelated" }}
        />
      ) : (
        <span className="text-[8px] text-zinc-400">{name.slice(0, 4)}</span>
      )}
    </button>
  );
}

export function Library() {
  const [search, setSearch] = useState("");
  const all = knownMaterials();
  const filtered = all.filter((m) => m.toLowerCase().includes(search.toLowerCase()));
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col gap-2">
      <Input
        placeholder={t("library.search")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="flex flex-wrap gap-1.5 overflow-y-auto pb-2">
        {filtered.map((m) => (
          <ItemTile key={m} name={m} />
        ))}
        {filtered.length === 0 && (
          <div className="w-full py-4 text-center text-xs text-zinc-500">{t("library.noMatch")}</div>
        )}
      </div>
    </div>
  );
}
