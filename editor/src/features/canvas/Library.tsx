import { Input } from "@/components/ui/input";
import { cx } from "@/lib/cx";
import { type LibraryItem, fetchItems } from "@/lib/packApi";
import { useSessionStore } from "@/state/sessionStore";
import { useUiStore } from "@/state/uiStore";
import { useDraggable } from "@dnd-kit/core";
import { type CSSProperties, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/** ID prefix for Library items inside the top-level DndContext. */
export const LIBRARY_DRAG_PREFIX = "lib:";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

interface ItemTileProps {
  item: LibraryItem;
  version: string;
}

function ItemTile({ item, version }: ItemTileProps) {
  const url = `${API_URL}/api/textures/${version}/${item.texture}`;
  const armed = useUiStore((s) => s.armedMaterial === item.id);
  const setArmedMaterial = useUiStore((s) => s.setArmedMaterial);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${LIBRARY_DRAG_PREFIX}${item.id}`,
    data: { material: item.id },
  });
  const style: CSSProperties = { opacity: isDragging ? 0.4 : 1 };

  return (
    <button
      ref={setNodeRef}
      type="button"
      style={style}
      onClick={() => setArmedMaterial(armed ? null : item.id)}
      title={item.label}
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
      <img
        src={url}
        alt={item.label}
        loading="lazy"
        draggable={false}
        className="pixelated h-3/4 w-3/4 object-contain"
        style={{ imageRendering: "pixelated" }}
        onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }}
      />
    </button>
  );
}

export function Library() {
  const token = useSessionStore((s) => s.accessToken);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [version, setVersion] = useState("");
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [error, setError] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    if (!token) return;
    fetchItems(token)
      .then((data) => { setVersion(data.version); setItems(data.items); })
      .catch(() => setError(true));
  }, [token]);

  const categories = ["all", ...Array.from(new Set(items.map((i) => i.category))).sort()];

  const filtered = items.filter(
    (i) =>
      (category === "all" || i.category === category) &&
      (i.id.includes(search.toLowerCase()) || i.label.toLowerCase().includes(search.toLowerCase())),
  );

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-zinc-500">
        {t("library.unavailable")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <Input
        placeholder={t("library.search")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="flex flex-wrap gap-1">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(cat)}
            className={cx(
              "rounded-full border px-2 py-0.5 text-[10px] capitalize",
              category === cat
                ? "border-emerald-600 bg-emerald-600/10 text-emerald-300"
                : "border-zinc-700 text-zinc-400 hover:border-zinc-500",
            )}
          >
            {cat}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 overflow-y-auto pb-2">
        {items.length === 0 && !error && (
          <div className="w-full py-4 text-center text-xs text-zinc-500">{t("library.loading")}</div>
        )}
        {filtered.map((item) => (
          <ItemTile key={item.id} item={item} version={version} />
        ))}
        {items.length > 0 && filtered.length === 0 && (
          <div className="w-full py-4 text-center text-xs text-zinc-500">{t("library.noMatch")}</div>
        )}
      </div>
    </div>
  );
}
