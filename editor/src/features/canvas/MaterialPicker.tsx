import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { LibraryItem } from "@/domain/library";
import { cx } from "@/lib/cx";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CapturedItemsSection } from "./CapturedItemsSection";
import { getTextureUrl, useTextureStore } from "./textureStore";

interface MaterialPickerProps {
  dataItems?: { value: string; label: string }[];
  onPickData?: (value: string) => void;
  /** Trigger element rendered by the consumer (a small icon button typically). */
  trigger: React.ReactNode;
  onPick: (material: string) => void;
  /** When set, adds a "Captured" tab: pick a captured item or capture straight
   *  from a player's inventory mirror (returns an `item:<id>` ref). */
  projectId?: import("@/domain/types").ProjectId;
}

/**
 * Modal item-palette picker. Used as a visual alternative to typing a
 * material name into a text input — opens, user filters + clicks, picker
 * closes and the parent receives the chosen material via `onPick`. With a
 * `projectId`, a second tab offers the project's captured items + the
 * inventory-mirror capture flow.
 */
export function MaterialPicker({
  trigger,
  onPick,
  projectId,
  dataItems,
  onPickData,
}: MaterialPickerProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"items" | "captured">("items");
  const [search, setSearch] = useState("");
  const libraryItems = useTextureStore((s) => s.libraryItems);
  const customItems = useTextureStore((s) => s.libraryCustomData.items);
  const allItems = [...libraryItems, ...customItems];
  const filtered = allItems.filter(
    (item) =>
      item.id.toLowerCase().includes(search.toLowerCase()) ||
      item.label.toLowerCase().includes(search.toLowerCase()),
  );
  const { t } = useTranslation();

  const pick = (name: string) => {
    onPick(name);
    setOpen(false);
    setSearch("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {/* Fixed height — the tabs have very different content sizes and the
          modal must not resize when switching between them. */}
      <DialogContent className="flex h-[80vh] flex-col gap-3 p-4">
        <DialogHeader>
          <DialogTitle className="text-base">{t("materialPicker.title")}</DialogTitle>
        </DialogHeader>
        {dataItems && dataItems.length > 0 && (
          <div className="flex flex-col gap-1 border-b border-[var(--border-soft)] pb-3">
            <span className="field-label">{t("itemBinding.catalog")}</span>
            {dataItems.map((entry) => (
              <button
                key={entry.value}
                type="button"
                className="btn btn-ghost justify-start text-sm"
                onClick={() => {
                  onPickData?.(entry.value);
                  setOpen(false);
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>
        )}
        {dataItems && <span className="field-label">{t("itemBinding.library")}</span>}
        {projectId ? (
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setTab("items")}
              className={cx("chip h-7 px-3 text-[11px]", tab === "items" && "is-active")}
            >
              {t("materialPicker.tabItems")}
            </button>
            <button
              type="button"
              onClick={() => setTab("captured")}
              className={cx("chip h-7 px-3 text-[11px]", tab === "captured" && "is-active")}
            >
              {t("materialPicker.tabCaptured")}
            </button>
          </div>
        ) : null}
        {tab === "captured" && projectId ? (
          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            <CapturedItemsSection projectId={projectId} onPick={pick} />
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--text-faint)]" />
              <Input
                autoFocus
                placeholder={t("library.search")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9!"
              />
            </div>
            <ItemGrid items={filtered} onPick={pick} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

const GAP = 6;

/**
 * The catalogue as a virtualized grid: only the rows in view (and a few around) are mounted,
 * so opening the picker loads a screenful of icons, not the ~1,600 of the catalogue. Each icon
 * is a request to the hub; through the editor tunnel, all of them at once went over its
 * per-minute limit and locked the whole editor out for a minute.
 */
function ItemGrid({ items, onPick }: { items: LibraryItem[]; onPick: (id: string) => void }) {
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const columns = width >= 560 ? 8 : 6;
  const tile = width > 0 ? (width - GAP * (columns - 1)) / columns : 56;
  const rows: LibraryItem[][] = [];
  for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns));

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => tile + GAP,
    overscan: 3,
  });

  return (
    <div
      ref={parentRef}
      className="min-h-0 flex-1 overflow-y-auto pb-2"
      data-testid="material-grid"
    >
      {items.length === 0 ? (
        <div className="py-4 text-center text-xs text-[var(--text-faint)]">
          {t("library.noMatch")}
        </div>
      ) : (
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((row) => (
            <div
              key={row.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${row.start}px)`,
                display: "grid",
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gap: GAP,
              }}
            >
              {(rows[row.index] ?? []).map((item) => (
                <Tile
                  key={item.id}
                  name={item.id}
                  label={item.label}
                  onClick={() => onPick(item.id)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Tile({ name, label, onClick }: { name: string; label: string; onClick: () => void }) {
  const url = getTextureUrl(name);
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cx(
        "group relative flex aspect-square cursor-pointer items-center justify-center",
        "rounded-[8px] border border-[var(--border)] bg-[var(--surface-inset)] hover:border-[var(--brand-line)] hover:bg-[var(--brand-soft)]",
      )}
    >
      {url ? (
        <img
          src={url}
          alt={name}
          draggable={false}
          className="h-3/4 w-3/4 object-contain"
          style={{ imageRendering: "pixelated" }}
        />
      ) : (
        <span className="text-[9.5px] text-[var(--text-mut)]">{label.slice(0, 4)}</span>
      )}
    </button>
  );
}
