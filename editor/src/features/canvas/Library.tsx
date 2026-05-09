import { Input } from "@/components/ui/input";
import { cx } from "@/lib/cx";
import { type LibraryItem, type CustomItemsData, fetchItems, fetchCustomItems } from "@/lib/packApi";
import { useSessionStore } from "@/state/sessionStore";
import { useUiStore } from "@/state/uiStore";
import { useDraggable } from "@dnd-kit/core";
import { type CSSProperties, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTextureStore } from "./textureStore";

/** ID prefix for Library items inside the top-level DndContext. */
export const LIBRARY_DRAG_PREFIX = "lib:";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

interface ItemTileProps {
  item: LibraryItem;
  textureBase: string;
}

function ItemTile({ item, textureBase }: ItemTileProps) {
  const url = `${textureBase}/${item.texture}`;
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
        "group relative flex h-16 w-16 shrink-0 select-none touch-none items-center justify-center",
        "rounded border bg-[#8b8b8b] active:cursor-grabbing",
        armed
          ? "border-emerald-500 bg-emerald-500/20 ring-1 ring-emerald-500"
          : "border-zinc-600 cursor-grab hover:border-zinc-400",
      )}
    >
      <img
        src={url}
        alt={item.label}
        loading="lazy"
        draggable={false}
        className="h-full w-full object-contain p-1"
        style={{ imageRendering: item.texture.startsWith("icons/") ? "auto" : "pixelated" }}
        onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }}
      />
    </button>
  );
}

export function Library() {
  const token = useSessionStore((s) => s.accessToken);
  const setTextureData = useTextureStore((s) => s.setData);
  const setCustomTextureData = useTextureStore((s) => s.setCustomData);
  const version = useTextureStore((s) => s.version);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [customData, setCustomData] = useState<CustomItemsData>({ serverKeyId: "", items: [] });
  const [error, setError] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    if (!token) return;
    Promise.all([fetchItems(token), fetchCustomItems(token)])
      .then(([vanilla, custom]) => {
        setTextureData(vanilla.version, vanilla.items);
        setItems(vanilla.items);
        setCustomData(custom);
        if (custom.serverKeyId) setCustomTextureData(custom.items, custom.serverKeyId);
      })
      .catch(() => setError(true));
  }, [token, setTextureData, setCustomTextureData]);

  const allItems = [...items, ...customData.items];
  const categories = ["all", ...Array.from(new Set(allItems.map((i) => i.category))).sort()];

  const filtered = allItems.filter(
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
        {allItems.length === 0 && !error && (
          <div className="w-full py-4 text-center text-xs text-zinc-500">{t("library.loading")}</div>
        )}
        {filtered.map((item) => {
          const isCustom = customData.items.some((c) => c.id === item.id);
          const textureBase = isCustom
            ? `${API_URL}/api/textures/custom/${customData.serverKeyId}`
            : `${API_URL}/api/textures/${version}`;
          return <ItemTile key={item.id} item={item} textureBase={textureBase} />;
        })}
        {allItems.length > 0 && filtered.length === 0 && (
          <div className="w-full py-4 text-center text-xs text-zinc-500">{t("library.noMatch")}</div>
        )}
      </div>
    </div>
  );
}
