import { Input } from "@/components/ui/input";
import type { Element, Menu, Placement, ProjectId } from "@/domain/types";
import {
  PLACEMENT_ROW_DRAG_PREFIX,
  type PlacementRowDragData,
} from "@/features/canvas/placementDrop";
import { useAccountStore } from "@/state/accountStore";
import { useNetworksStore } from "@/state/networksStore";
import { useServerDataSourcesStore } from "@/state/serverDataSourcesStore";
import { useServerSnapshotsStore } from "@/state/serverSnapshotsStore";
import { useServersStore } from "@/state/serversStore";
import { useUiStore } from "@/state/uiStore";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

interface StaticSource {
  /** contextInput name (what `places.source` stores). */
  name: string;
  /** underlying SourceRef (snapshot key). */
  ref: string;
  keyField: string;
}

/**
 * Placement-mode authoring, a sibling of IterationField. Placement mode is only
 * offered when the menu binds a **static** data source (a stable, enumerable
 * key-set). Enabling it seeds `element.places`; a draggable row palette (with a
 * tap-to-place mobile fallback) pins rows onto slots, and the placement list
 * lets the user remove or override each pinned row.
 */
export function PlacementField({
  projectId,
  menu,
  element,
}: {
  projectId: ProjectId;
  menu: Menu;
  element: Element;
}) {
  const { t } = useTranslation();
  const setElementPlaces = useAccountStore((s) => s.setElementPlaces);
  const sources = useServerDataSourcesStore((s) => s.sources);
  const places = element.places;

  // Static sources bound to this menu: a sourceRef contextInput whose declared
  // stability is "static" (and therefore carries a Row key field).
  const staticSources = useMemo<StaticSource[]>(() => {
    const out: StaticSource[] = [];
    for (const c of menu.contextInputs ?? []) {
      if (c.kind !== "sourceRef") continue;
      const ds = sources.find((s) => s.ref === String(c.ref));
      if (ds?.stability === "static" && ds.keyField) {
        out.push({ name: c.name, ref: String(c.ref), keyField: ds.keyField });
      }
    }
    return out;
  }, [menu.contextInputs, sources]);

  // XOR with iteration; IterationField owns the iterating case.
  if (element.iterates) return null;

  const enable = () => {
    const first = staticSources[0];
    if (!first) return;
    setElementPlaces({
      projectId,
      menuId: menu.id,
      elementId: element.id,
      places: { source: first.name, alias: "item", keyField: first.keyField, placements: [] },
    });
  };

  if (!places) {
    if (staticSources.length === 0) return null; // placement needs a static source
    return (
      <div className="mb-3">
        <button
          type="button"
          onClick={enable}
          className="rounded border border-[var(--border)] border-dashed px-2 py-1 text-[10px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
          title={t("flow.placementBindHint")}
        >
          {t("flow.placementEnable")}
        </button>
      </div>
    );
  }

  return (
    <PlacementPanel
      projectId={projectId}
      menu={menu}
      element={element}
      places={places}
      staticSources={staticSources}
    />
  );
}

function PlacementPanel({
  projectId,
  menu,
  element,
  places,
  staticSources,
}: {
  projectId: ProjectId;
  menu: Menu;
  element: Element;
  places: NonNullable<Element["places"]>;
  staticSources: StaticSource[];
}) {
  const { t } = useTranslation();
  const setElementPlaces = useAccountStore((s) => s.setElementPlaces);
  const removeElementPlacement = useAccountStore((s) => s.removeElementPlacement);
  const loadSnapshot = useServerSnapshotsStore((s) => s.loadSnapshot);
  const rowsByRef = useServerSnapshotsStore((s) => s.rowsByRef);
  const networkId = useNetworksStore((s) => s.activeId);
  const serverId = useServersStore((s) => s.activeServerId);

  const current = staticSources.find((s) => s.name === places.source);
  const ref = current?.ref;

  // Ensure the source snapshot is loaded so the palette can enumerate rows.
  useEffect(() => {
    if (networkId && serverId && ref) loadSnapshot({ networkId, serverId, ref });
  }, [networkId, serverId, ref, loadSnapshot]);

  const rows = (ref ? rowsByRef[ref] : undefined) ?? [];
  const placedKeys = new Set(places.placements.map((p) => p.key));

  const disable = () =>
    setElementPlaces({ projectId, menuId: menu.id, elementId: element.id, places: undefined });

  const changeSource = (name: string) => {
    const next = staticSources.find((s) => s.name === name);
    if (!next) return;
    // A new source invalidates the existing keys, so reset the layout.
    setElementPlaces({
      projectId,
      menuId: menu.id,
      elementId: element.id,
      places: { source: next.name, alias: places.alias, keyField: next.keyField, placements: [] },
    });
  };

  const updateAlias = (alias: string) =>
    setElementPlaces({
      projectId,
      menuId: menu.id,
      elementId: element.id,
      places: { ...places, alias },
    });

  return (
    <div className="mb-3 flex flex-col gap-2 rounded border border-[var(--brand-line)] border-dashed bg-[var(--brand-soft)] p-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-[var(--brand)] uppercase tracking-wide">
          {t("flow.placement")}
        </span>
        <button
          type="button"
          onClick={disable}
          title={t("flow.placementDisable")}
          className="flex h-6 w-6 items-center justify-center rounded text-[12px] text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          ×
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10px] text-[var(--text-mut)]">{t("flow.placementFrom")}</span>
        {staticSources.length > 1 ? (
          <select
            value={places.source}
            onChange={(e) => changeSource(e.target.value)}
            className="h-7 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] px-1.5 font-mono text-xs text-[var(--text)]"
          >
            {staticSources.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="font-mono text-xs text-[var(--text)]">{places.source}</span>
        )}
        <span className="font-mono text-[10px] text-[var(--text-mut)]">{t("flow.placementAs")}</span>
        <Input
          value={places.alias}
          placeholder="item"
          onChange={(e) => updateAlias(e.target.value)}
          className="h-7 w-24 px-2 py-0 font-mono text-xs"
        />
      </div>

      <p className="text-[10px] text-[var(--text-faint)]">{t("flow.placementPaletteHint")}</p>

      {/* Row palette — drag onto a canvas slot, or tap to arm then tap a slot. */}
      <div className="flex flex-wrap gap-1">
        {rows.length === 0 ? (
          <span className="text-[10px] text-[var(--text-faint)]">{t("flow.placementNoRows")}</span>
        ) : (
          rows.map((row, i) => {
            const key = String(row[places.keyField] ?? "");
            if (!key) return null;
            return (
              <RowChip
                // biome-ignore lint/suspicious/noArrayIndexKey: key may repeat across malformed rows; index disambiguates
                key={`${key}-${i}`}
                menuId={menu.id}
                elementId={element.id}
                rowKey={key}
                placed={placedKeys.has(key)}
              />
            );
          })
        )}
      </div>

      {/* Current placements — page/slot summary + remove. */}
      {places.placements.length > 0 ? (
        <div className="flex flex-col gap-1">
          {[...places.placements]
            .sort((a, b) => a.page - b.page || a.position - b.position)
            .map((p) => (
              <PlacementRow
                key={p.key}
                placement={p}
                onRemove={() =>
                  removeElementPlacement({
                    projectId,
                    menuId: menu.id,
                    elementId: element.id,
                    key: p.key,
                  })
                }
              />
            ))}
        </div>
      ) : null}
    </div>
  );
}

/** One draggable palette row. Tap arms it for tap-to-place; drag pins it directly. */
function RowChip({
  menuId,
  elementId,
  rowKey,
  placed,
}: {
  menuId: string;
  elementId: string;
  rowKey: string;
  placed: boolean;
}) {
  const armedPlacement = useUiStore((s) => s.armedPlacement);
  const setArmedPlacement = useUiStore((s) => s.setArmedPlacement);
  const armed =
    armedPlacement?.menuId === menuId &&
    armedPlacement.elementId === elementId &&
    armedPlacement.key === rowKey;

  const data: PlacementRowDragData = { placementRow: { menuId, elementId, key: rowKey } };
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `${PLACEMENT_ROW_DRAG_PREFIX}${elementId}:${rowKey}`,
    data,
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => setArmedPlacement(armed ? null : { menuId, elementId, key: rowKey })}
      title={rowKey}
      {...listeners}
      {...attributes}
      className={
        armed
          ? "chip h-6 max-w-[140px] touch-none cursor-grab select-none truncate px-2 text-[10.5px] is-active active:cursor-grabbing"
          : "chip h-6 max-w-[140px] touch-none cursor-grab select-none truncate px-2 text-[10.5px] active:cursor-grabbing"
      }
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.4 : placed ? 0.55 : 1,
      }}
    >
      {placed ? "✓ " : ""}
      {rowKey}
    </button>
  );
}

/** A pinned placement: page/slot summary + remove. Look/behaviour comes from the
 *  Item template — no per-placement override (conditional states cover variation). */
function PlacementRow({
  placement,
  onRemove,
}: {
  placement: Placement;
  onRemove: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-1.5 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] px-2 py-1">
      <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-[var(--text)]" title={placement.key}>
        {placement.key}
      </span>
      <span className="shrink-0 font-mono text-[9px] text-[var(--text-faint)]">
        {t("flow.placementSlotSummary", { page: placement.page + 1, slot: placement.position })}
      </span>
      <button
        type="button"
        onClick={onRemove}
        title={t("flow.placementRemove")}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[12px] text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
      >
        ×
      </button>
    </div>
  );
}
