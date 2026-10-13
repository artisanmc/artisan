import { Input } from "@/components/ui/input";
import type { LibraryItem } from "@/domain/library";
import { cx } from "@/lib/cx";
import { renderToCanvas } from "@/lib/mcModelRenderer";
import { useUiStore } from "@/state/uiStore";
import { useDraggable } from "@dnd-kit/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTextureStore } from "./textureStore";

/** ID prefix for Library items inside the top-level DndContext. */
export const LIBRARY_DRAG_PREFIX = "lib:";

const API_URL = import.meta.env.VITE_API_URL ?? "";

const TILE_SIZE = 48;
const GAP = 6;

interface ItemTileProps {
  item: LibraryItem;
  textureBase: string;
  version: string;
  isCustom: boolean;
  serverKeyId?: string;
  bundleReady: boolean;
  tints?: Record<number, string>;
}

function ItemTile({
  item,
  textureBase,
  version,
  isCustom,
  serverKeyId,
  bundleReady,
  tints,
}: ItemTileProps) {
  const armed = useUiStore((s) => s.armedMaterial === item.id);
  const setArmedMaterial = useUiStore((s) => s.setArmedMaterial);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${LIBRARY_DRAG_PREFIX}${item.id}`,
    data: { material: item.id },
  });
  const tileRef = useRef<HTMLButtonElement>(null);
  const setRendered = useTextureStore((s) => s.setRendered);
  const renderedSrc = useTextureStore((s) =>
    item.model ? (s.renderedByMaterial[item.id.toLowerCase()] ?? null) : null,
  );

  useEffect(() => {
    if (!item.model || !bundleReady || !tileRef.current) return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        observer.disconnect();
        renderToCanvas(item.model!, version, isCustom, serverKeyId, tints).then((src) => {
          if (cancelled || !src) return;
          setRendered(item.id, src);
        });
      },
      { threshold: 0 },
    );
    observer.observe(tileRef.current);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [item.model, bundleReady, version, isCustom, serverKeyId, setRendered]);

  return (
    <button
      ref={(el) => {
        setNodeRef(el);
        (tileRef as React.MutableRefObject<HTMLButtonElement | null>).current = el;
      }}
      type="button"
      onClick={() => setArmedMaterial(armed ? null : item.id)}
      title={item.label}
      {...listeners}
      {...attributes}
      className={cx(
        "group relative flex shrink-0 select-none touch-none items-center justify-center",
        "rounded-[8px] border active:cursor-grabbing",
        armed
          ? "border-[var(--brand)] bg-[var(--brand-soft)] ring-1 ring-[var(--brand)]"
          : "border-[var(--border)] bg-[var(--surface-inset)] cursor-grab hover:border-[var(--border-strong)]",
      )}
      style={{ opacity: isDragging ? 0.4 : 1, width: TILE_SIZE, height: TILE_SIZE }}
    >
      {renderedSrc || item.texture ? (
        <img
          src={renderedSrc ?? `${textureBase}/${item.texture}`}
          alt={item.label}
          loading="lazy"
          draggable={false}
          className="h-full w-full object-contain p-1"
          style={{ imageRendering: renderedSrc ? "auto" : "pixelated" }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.visibility = "hidden";
          }}
        />
      ) : (
        <span
          data-placeholder
          className="flex h-full w-full items-center justify-center text-xs font-medium uppercase text-[var(--text-mut)]"
          aria-hidden="true"
        >
          {item.category.charAt(0)}
        </span>
      )}
    </button>
  );
}

export function Library() {
  const version = useTextureStore((s) => s.version);
  const items = useTextureStore((s) => s.libraryItems);
  const customData = useTextureStore((s) => s.libraryCustomData);
  const bundleReady = useTextureStore((s) => s.libraryBundleReady);
  const error = useTextureStore((s) => s.libraryError);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const { t } = useTranslation();

  const parentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(280);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const allItems = [...items, ...customData.items];
  const categories = ["all", ...Array.from(new Set(allItems.map((i) => i.category))).sort()];

  const filtered = allItems.filter(
    (i) =>
      (category === "all" || i.category === category) &&
      (i.id.includes(search.toLowerCase()) || i.label.toLowerCase().includes(search.toLowerCase())),
  );

  const columns = Math.max(3, Math.floor((containerWidth + GAP) / (TILE_SIZE + GAP)));
  const rows: LibraryItem[][] = [];
  for (let i = 0; i < filtered.length; i += columns) {
    rows.push(filtered.slice(i, i + columns));
  }

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => TILE_SIZE + GAP,
    overscan: 4,
  });

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-[var(--text-faint)]">
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
      <div className="flex shrink-0 gap-1 overflow-x-auto pb-1">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(cat)}
            className={cx(
              "chip h-6 shrink-0 whitespace-nowrap px-2.5 text-[10.5px] capitalize",
              category === cat && "is-active",
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      {allItems.length === 0 && !error && (
        <div className="w-full py-4 text-center text-xs text-[var(--text-faint)]">
          {t("library.loading")}
        </div>
      )}
      {allItems.length > 0 && filtered.length === 0 && (
        <div className="w-full py-4 text-center text-xs text-[var(--text-faint)]">
          {t("library.noMatch")}
        </div>
      )}

      <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto pb-2">
        <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => (
            <div
              key={virtualRow.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
                display: "flex",
                gap: GAP,
                paddingBottom: GAP,
              }}
            >
              {(rows[virtualRow.index] ?? []).map((item) => {
                const isCustom = customData.items.some((c) => c.id === item.id);
                const textureBase = isCustom
                  ? `${API_URL}/api/v1/textures/custom/${customData.serverKeyId}`
                  : `${API_URL}/api/v1/textures/${version}`;
                return (
                  <ItemTile
                    key={item.id}
                    item={item}
                    textureBase={textureBase}
                    version={version}
                    isCustom={isCustom}
                    serverKeyId={isCustom ? customData.serverKeyId : undefined}
                    bundleReady={bundleReady}
                    tints={item.tints}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
