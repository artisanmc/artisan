import { Input } from "@/components/ui/input";
import type { Appearance } from "@/domain/types";
import type {
  Command,
  CommandArg,
  CommandId,
  Element,
  ElementId,
  Menu,
  MenuId,
  PackId,
} from "@/domain/types";
import { MaterialPicker } from "@/features/canvas/MaterialPicker";
import { itemTextureUrl } from "@/features/canvas/itemTextures";
import {
  ArgInsertBar,
  type PlaceholderInfo,
  PlaceholderProvider,
} from "@/features/canvas/properties/ActionEditor";
import { ConditionListEditor } from "@/features/canvas/properties/ConditionListEditor";
import { MenuProperties } from "@/features/canvas/properties/MenuProperties";
import { PackProperties } from "@/features/canvas/properties/PackProperties";
import { PropertyField } from "@/features/canvas/properties/PropertyField";
import { buildPreviewScope, renderPreview } from "@/features/canvas/menuPreviewScope";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { lookupPath } from "@/lib/placeholders";
import { formatPositions, parsePositions } from "@/lib/positions";
import { useGetText } from "@/lib/useText";
import { useAccountStore } from "@/state/accountStore";
import { useFlowSelectionStore } from "@/state/flowSelectionStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CommandStepPseudocode, ElementClickHandlersPseudocode } from "./PseudocodeView";

interface FlowCanvasProps {
  packId: PackId;
}

const looksLikeMiniMessage = (s: string): boolean => s.includes("<");

/**
 * Unified editor for the current selection. Routes by kind:
 *   Pack            → pack-level fields (description, source).
 *   Menu            → title / permission / rows / background.
 *   Element         → identity + per-state cards (with all state-level
 *                     fields embedded) + click handlers for the focused state.
 *   Command         → command identity + step tree.
 *
 * The "Properties" / "Code" split is gone: everything for the current
 * selection is rendered together so users always see how state-level
 * fields (title, count, lore, conditions) and click handlers belong to a
 * specific state card.
 */
export function FlowCanvas({ packId }: FlowCanvasProps) {
  const ids = useSelectionStore((s) => s.ids);
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const setSub = useFlowSelectionStore((s) => s.set);

  // biome-ignore lint/correctness/useExhaustiveDependencies: ids change is the trigger
  useEffect(() => {
    setSub(null);
  }, [setSub, [...ids].sort().join(",")]);

  if (!pack) return <EmptyHint label="Pack not found." />;
  if (ids.size > 1) {
    return <EmptyHint label="Multi-edit not supported in v1. Select one item." />;
  }
  if (ids.size === 0) {
    return (
      <div className="h-full overflow-y-auto p-3">
        <PackProperties pack={pack} />
      </div>
    );
  }

  const id = [...ids][0]!;
  const command = pack.commands.find((c) => c.id === id);
  if (command) return <CommandEditor packId={packId} command={command} />;

  for (const menu of pack.menus) {
    for (const layer of menu.layers) {
      const el = layer.elements.find((e) => e.id === id);
      if (el) return <ElementEditor packId={packId} menu={menu} element={el} />;
    }
  }

  const menu = pack.menus.find((m) => m.id === id);
  if (menu) {
    return (
      <div className="h-full overflow-y-auto p-3">
        <MenuProperties packId={packId} menu={menu} />
      </div>
    );
  }

  return <EmptyHint label="Selection has no editor." />;
}

function EmptyHint({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-zinc-950 text-xs text-zinc-500">
      {label}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Element editor
// ────────────────────────────────────────────────────────────────────────────

function ElementEditor({
  packId,
  menu,
  element,
}: {
  packId: PackId;
  menu: Menu;
  element: Element;
}) {
  const sub = useFlowSelectionStore((s) => s.sub);
  const setSub = useFlowSelectionStore((s) => s.set);
  const focusedStateIndex =
    sub && (sub.kind === "state" || sub.kind === "step") ? (sub.stateIndex ?? 0) : 0;
  const focusedState = element.appearances[focusedStateIndex] ?? element.appearances[0];

  const headerMaterial = focusedState?.material ?? "";
  const headerTextureUrl = itemTextureUrl(headerMaterial);
  const getText = useGetText(packId);
  const headerTitle = getText(focusedState?.title);
  const menuTitle = getText(menu.title);
  const { t } = useTranslation();

  const addAppearance = useAccountStore((s) => s.addAppearance);

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Element identity strip — preview of the focused state. */}
      <div className="flex items-center gap-3 border-zinc-800 border-b bg-zinc-900 px-3 py-2">
        <div className="flex h-8 w-8 items-center justify-center rounded border border-zinc-800 bg-zinc-950">
          {headerTextureUrl ? (
            <img
              src={headerTextureUrl}
              alt={headerMaterial}
              draggable={false}
              className="h-3/4 w-3/4 object-contain"
              style={{ imageRendering: "pixelated" }}
            />
          ) : (
            <span className="text-[8px] text-zinc-500">{headerMaterial.slice(0, 4)}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-xs text-zinc-200">{headerTitle || headerMaterial}</div>
          <div className="text-[10px] text-zinc-500">
            {menuTitle} ·{" "}
            {t(element.appearances.length === 1 ? "flow.headerStateOne" : "flow.headerStateOther", {
              count: element.appearances.length,
            })}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-3 py-3">
        <ElementIdField packId={packId} menuId={menu.id} elementId={element.id} />
        <PositionsField packId={packId} menuId={menu.id} element={element} />
        <IterationField packId={packId} menu={menu} element={element} />

        <Lane label={t("flow.states")}>
          <SortableStates
            packId={packId}
            menu={menu}
            element={element}
            focusedStateIndex={focusedStateIndex}
            onAdd={() => {
              addAppearance({ packId, menuId: menu.id, elementId: element.id });
              setSub({ kind: "state", stateIndex: element.appearances.length });
            }}
          />
        </Lane>
      </div>
    </div>
  );
}

function IterationField({
  packId,
  menu,
  element,
}: {
  packId: PackId;
  menu: Menu;
  element: Element;
}) {
  const { t } = useTranslation();
  const setElementIterates = useAccountStore((s) => s.setElementIterates);
  const iterates = element.iterates;
  // Suggest sourceRef inputs — these carry list/object data from a data source.
  const sourceSuggestions = (menu.contextInputs ?? [])
    .filter((c) => c.kind === "sourceRef")
    .map((c) => c.name);
  const datalistId = `iter-source-${menu.id}-${element.id}`;

  const enable = () => {
    const firstSourceRef = (menu.contextInputs ?? []).find((c) => c.kind === "sourceRef");
    setElementIterates({
      packId,
      menuId: menu.id,
      elementId: element.id,
      iterates: { source: firstSourceRef?.name ?? "", alias: "item" },
    });
  };
  const disable = () => {
    setElementIterates({ packId, menuId: menu.id, elementId: element.id, iterates: undefined });
  };
  const update = (patch: Partial<NonNullable<Element["iterates"]>>) => {
    if (!iterates) return;
    setElementIterates({
      packId,
      menuId: menu.id,
      elementId: element.id,
      iterates: { ...iterates, ...patch },
    });
  };

  if (!iterates) {
    return (
      <div className="mb-3">
        <button
          type="button"
          onClick={enable}
          className="rounded border border-zinc-700 border-dashed px-2 py-1 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          title={t("flow.iterateBindHint")}
        >
          {t("flow.iterationEnable")}
        </button>
      </div>
    );
  }

  return (
    <div className="mb-3 flex flex-col gap-1.5 rounded border border-purple-500/40 border-dashed bg-purple-500/5 p-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-purple-300 uppercase tracking-wide">
          {t("flow.iteration")}
        </span>
        <button
          type="button"
          onClick={disable}
          title={t("flow.iterationDisable")}
          className="flex h-6 w-6 items-center justify-center rounded text-[12px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        >
          ×
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10px] text-zinc-400">{t("flow.iterationForEach")}</span>
        <Input
          value={iterates.alias}
          placeholder="item"
          onChange={(e) => update({ alias: e.target.value })}
          className="h-7 w-24 px-2 py-0 font-mono text-xs"
        />
        <span className="font-mono text-[10px] text-zinc-400">{t("flow.iterationIn")}</span>
        <Input
          value={iterates.source}
          placeholder="shops"
          list={datalistId}
          onChange={(e) => update({ source: e.target.value })}
          className="h-7 w-40 px-2 py-0 font-mono text-xs"
        />
        <datalist id={datalistId}>
          {sourceSuggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>
      <p className="text-[10px] text-zinc-500">
        {t("flow.iterationFieldsHint", { example: `{${iterates.alias}.field}` })}
      </p>
    </div>
  );
}

/**
 * State cards list with drag-and-drop reordering. The order is meaningful
 * (first matching appearance wins at runtime), so users can push the
 * "common" state up and the fallback default down. Uses ref-stable ids
 * per Appearance object — same trick as the pseudocode steps — so
 * @dnd-kit doesn't re-shuffle anything on the post-drop re-render.
 */
function SortableStates({
  packId,
  menu,
  element,
  focusedStateIndex,
  onAdd,
}: {
  packId: PackId;
  menu: Menu;
  element: Element;
  focusedStateIndex: number;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  const moveAppearance = useAccountStore((s) => s.moveAppearance);
  const setSub = useFlowSelectionStore((s) => s.set);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const ids = useStableAppearanceIds(element.appearances);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const fromIndex = ids.indexOf(active.id as string);
    const toIndex = ids.indexOf(over.id as string);
    if (fromIndex < 0 || toIndex < 0) return;

    moveAppearance({
      packId,
      menuId: menu.id,
      elementId: element.id,
      fromIndex,
      toIndex,
    });

    // Track focus across the move so the user keeps editing the state
    // they had focused, not whatever state lands at the old index.
    let newFocus = focusedStateIndex;
    if (focusedStateIndex === fromIndex) newFocus = toIndex;
    else if (fromIndex < focusedStateIndex && focusedStateIndex <= toIndex) newFocus -= 1;
    else if (toIndex <= focusedStateIndex && focusedStateIndex < fromIndex) newFocus += 1;
    if (newFocus !== focusedStateIndex) {
      setSub({ kind: "state", stateIndex: newFocus });
    }
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2">
          {element.appearances.map((_appearance, i) => (
            <StateCard
              // biome-ignore lint/suspicious/noArrayIndexKey: state index stable per list-render
              key={i}
              dragId={ids[i]!}
              packId={packId}
              menu={menu}
              element={element}
              stateIndex={i}
              focused={focusedStateIndex === i}
            />
          ))}
          <button
            type="button"
            onClick={onAdd}
            className="self-start rounded border border-zinc-700 border-dashed px-3 py-1.5 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          >
            {t("flow.addState")}
          </button>
        </div>
      </SortableContext>
    </DndContext>
  );
}

export const STATE_DROP_PREFIX = "state:";

/**
 * Build a stable drop target id for a state card's material icon. Format:
 * `state:{menuId}:{elementId}:{stateIndex}`. The pack route's onDragEnd
 * checks for this prefix to dispatch a Library drop into the right state.
 */
export function stateDropId(menuId: MenuId, elementId: ElementId, stateIndex: number): string {
  return `${STATE_DROP_PREFIX}${menuId}:${elementId}:${stateIndex}`;
}

interface StateMaterialIconProps {
  menuId: MenuId;
  elementId: ElementId;
  stateIndex: number;
  material: string;
  textureUrl: string | undefined;
  onPick: (material: string) => void;
}

/**
 * Material icon on a state card. Doubles as:
 *   - a `<MaterialPicker>` trigger (click → modal item grid),
 *   - a `useDroppable` target for Library item drags (drop → set material).
 *
 * isOver shows an emerald ring while a Library drag is hovering.
 */
function StateMaterialIcon({
  menuId,
  elementId,
  stateIndex,
  material,
  textureUrl,
  onPick,
}: StateMaterialIconProps) {
  const droppable = useDroppable({ id: stateDropId(menuId, elementId, stateIndex) });
  return (
    <div ref={droppable.setNodeRef}>
      <MaterialPicker
        trigger={
          <button
            type="button"
            title="Pick item from library — or drag a library item here"
            className={
              droppable.isOver
                ? "flex h-8 w-8 shrink-0 items-center justify-center rounded border border-emerald-500 bg-emerald-500/10 ring-2 ring-emerald-500"
                : "flex h-8 w-8 shrink-0 items-center justify-center rounded border border-zinc-800 bg-zinc-950 hover:border-emerald-500"
            }
          >
            {textureUrl ? (
              <img
                src={textureUrl}
                alt={material}
                draggable={false}
                className="h-3/4 w-3/4 object-contain"
                style={{ imageRendering: "pixelated" }}
              />
            ) : (
              <span className="text-[8px] text-zinc-600">{material.slice(0, 3) || "—"}</span>
            )}
          </button>
        }
        onPick={onPick}
      />
    </div>
  );
}

/**
 * Small grip button on the left of a state card. Holds the @dnd-kit
 * sortable listeners + attributes so dragging it triggers reorder while
 * leaving the rest of the card free to handle clicks/inputs.
 */
function DragHandleButton({
  sortable,
}: {
  sortable: ReturnType<typeof useSortable>;
}) {
  return (
    <button
      type="button"
      title="Drag to reorder state"
      {...sortable.attributes}
      {...sortable.listeners}
      className="flex w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-l border-zinc-800 border-r font-mono text-[12px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 active:cursor-grabbing"
    >
      ⠿
    </button>
  );
}

/** Per-Appearance stable IDs via WeakMap. Immer keeps refs across moves. */
function useStableAppearanceIds(appearances: readonly Appearance[]): string[] {
  const mapRef = useRef<WeakMap<Appearance, string>>(new WeakMap());
  return useMemo(() => {
    const map = mapRef.current;
    return appearances.map((a) => {
      let id = map.get(a);
      if (!id) {
        id = `appearance-${Math.random().toString(36).slice(2, 11)}`;
        map.set(a, id);
      }
      return id;
    });
  }, [appearances]);
}

function StateCard({
  dragId,
  packId,
  menu,
  element,
  stateIndex,
  focused,
}: {
  dragId: string;
  packId: PackId;
  menu: Menu;
  element: Element;
  stateIndex: number;
  focused: boolean;
}) {
  const { t } = useTranslation();
  const sortable = useSortable({ id: dragId });
  const dragStyle: CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : 1,
  };
  const setSub = useFlowSelectionStore((s) => s.set);
  const setAppearanceField = useAccountStore((s) => s.setAppearanceField);
  const setAppearanceTitle = useAccountStore((s) => s.setAppearanceTitle);
  const setAppearanceLore = useAccountStore((s) => s.setAppearanceLore);
  const setAppearanceConditions = useAccountStore((s) => s.setAppearanceConditions);
  const setAppearanceJoin = useAccountStore((s) => s.setAppearanceJoin);
  const removeAppearance = useAccountStore((s) => s.removeAppearance);
  const activeLang = useUiStore((s) => s.activeLang);
  const getText = useGetText(packId);

  const appearance = element.appearances[stateIndex];
  if (!appearance) return null;
  const isDefault = stateIndex === 0;
  const material = appearance.material ?? "";
  const textureUrl = itemTextureUrl(material);
  const title = getText(appearance.title);
  const count = appearance.count ?? 1;
  const loreText = appearance.lore ? getText(appearance.lore) : "";
  const lore = loreText ? loreText.split("\n") : [];

  // Local draft state — decoupled from the store so Enter doesn't jump the
  // cursor. Resets to loreText when element/stateIndex changes or on blur.
  const [loreDraft, setLoreDraft] = useState(loreText);
  const [loreHasFocus, setLoreHasFocus] = useState(false);
  const loreKey = `${element.id}-${stateIndex}`;
  const prevLoreKeyRef = useRef(loreKey);
  if (prevLoreKeyRef.current !== loreKey) {
    prevLoreKeyRef.current = loreKey;
    setLoreDraft(loreText);
  }
  useEffect(() => {
    if (!loreHasFocus) setLoreDraft(loreText);
  }, [loreText, loreHasFocus]);

  // Preview scope — binds the first list item when the element iterates so
  // expressions like {rank.price > 1 ? "★" : ""} resolve with real data.
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const lorePreviewCtx = useMemo(() => {
    if (!pack) return {};
    const base = buildPreviewScope(menu, pack);
    if (!element.iterates) return base;
    const list = lookupPath(base, element.iterates.source);
    if (!Array.isArray(list) || list.length === 0) return base;
    return { ...base, [element.iterates.alias]: list[0] };
  }, [pack, menu, element.iterates]);

  const update = (field: "material" | "count", value: string | number) =>
    setAppearanceField({
      packId,
      menuId: menu.id,
      elementId: element.id,
      appearanceIndex: stateIndex,
      field,
      value,
    });
  const updateTitle = (value: string) =>
    setAppearanceTitle({
      packId,
      menuId: menu.id,
      elementId: element.id,
      appearanceIndex: stateIndex,
      lang: activeLang,
      value,
    });
  const updateLore = (value: string) =>
    setAppearanceLore({
      packId,
      menuId: menu.id,
      elementId: element.id,
      appearanceIndex: stateIndex,
      lang: activeLang,
      value,
    });

  // Collapsed state — tooltip-style summary. Click anywhere to focus and
  // expand. Mirrors the in-canvas hover tooltip layout (icon left, MM-
  // formatted title + lore right) so the visual link is obvious.
  if (!focused) {
    const displayTitle = title.trim() || material || "(empty)";
    return (
      <div
        ref={sortable.setNodeRef}
        style={dragStyle}
        className="flex w-full items-stretch gap-1 rounded border border-zinc-800 bg-zinc-900 transition-colors hover:border-zinc-600"
      >
        <DragHandleButton sortable={sortable} />
        <button
          type="button"
          onClick={() => setSub({ kind: "state", stateIndex })}
          className="flex min-w-0 flex-1 items-start gap-2 px-2 py-1.5 text-left"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-zinc-800 bg-zinc-950">
            {textureUrl ? (
              <img
                src={textureUrl}
                alt={material}
                draggable={false}
                className="h-3/4 w-3/4 object-contain"
                style={{ imageRendering: "pixelated" }}
              />
            ) : (
              <span className="text-[8px] text-zinc-600">{material.slice(0, 3) || "—"}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] text-zinc-500 uppercase tracking-wide">
              {isDefault ? t("flow.stateDefault") : t("flow.stateN", { index: stateIndex })}
              {!isDefault && (appearance.if ?? []).length > 0 ? (
                <span className="ml-1.5 normal-case text-zinc-600">
                  ·{" "}
                  {t(
                    (appearance.if ?? []).length === 1
                      ? "flow.stateConditionsOne"
                      : "flow.stateConditionsOther",
                    { count: (appearance.if ?? []).length },
                  )}
                </span>
              ) : null}
            </div>
            <MiniMessageInline
              source={displayTitle}
              className="block truncate font-mono text-xs text-zinc-200"
            />
            {lore.length > 0
              ? lore.slice(0, 2).map((line, i) => (
                  <MiniMessageInline
                    // biome-ignore lint/suspicious/noArrayIndexKey: lore lines stable per render
                    key={i}
                    source={line}
                    className="block truncate font-mono text-[10px] text-zinc-400"
                  />
                ))
              : null}
            {lore.length > 2 ? (
              <div className="font-mono text-[10px] text-zinc-600">
                {t(lore.length - 2 === 1 ? "flow.moreLinesOne" : "flow.moreLinesOther", {
                  count: lore.length - 2,
                })}
              </div>
            ) : null}
          </div>
        </button>
      </div>
    );
  }

  return (
    <PlaceholderProvider value={elementPlaceholders(menu, element)}>
      <div
        ref={sortable.setNodeRef}
        style={dragStyle}
        className="relative flex w-full items-stretch gap-1 rounded border border-emerald-500 bg-emerald-500/10 text-xs transition-colors"
      >
        <DragHandleButton sortable={sortable} />
        <div className="flex flex-1 flex-col gap-2 px-2.5 py-2">
          {/* Header row — state name + delete. Click header to collapse. */}
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-wide">
              {isDefault ? t("flow.stateDefault") : t("flow.stateN", { index: stateIndex })}
            </span>
            <span className="rounded bg-emerald-500/30 px-1.5 py-0.5 text-[9px] text-emerald-200 uppercase">
              {t("flow.editing")}
            </span>
            <span className="ml-auto" />
            {element.appearances.length > 1 ? (
              <button
                type="button"
                title={t("flow.removeState")}
                onClick={() => {
                  removeAppearance({
                    packId,
                    menuId: menu.id,
                    elementId: element.id,
                    appearanceIndex: stateIndex,
                  });
                  setSub(null);
                }}
                className="flex h-7 w-7 items-center justify-center rounded text-[14px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              >
                ×
              </button>
            ) : null}
          </div>

          {/* Material row */}
          <div className="flex items-center gap-1.5">
            <StateMaterialIcon
              menuId={menu.id}
              elementId={element.id}
              stateIndex={stateIndex}
              material={material}
              textureUrl={textureUrl}
              onPick={(picked) => update("material", picked)}
            />
            <Input
              value={material}
              placeholder="DIAMOND"
              onChange={(e) => update("material", e.target.value.toUpperCase())}
              onFocus={() => setSub({ kind: "state", stateIndex })}
              className="h-8 flex-1 px-2 py-0 font-mono text-xs"
            />
          </div>

          {/* Title + count */}
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <FieldLabel>{t("flow.titleLabel", { lang: activeLang })}</FieldLabel>
              <Input
                value={title}
                placeholder={t("flow.titlePlaceholder")}
                onChange={(e) => updateTitle(e.target.value)}
                onFocus={() => setSub({ kind: "state", stateIndex })}
                className="h-8 px-2 py-0 text-xs"
              />
              <ArgInsertBar onInsert={(name) => updateTitle(`${title}{${name}}`)} />
              {looksLikeMiniMessage(title) ? (
                <div className="mt-1 rounded border border-zinc-800 bg-[var(--color-bg)] px-2 py-1">
                  <span className="mr-2 text-[9px] text-zinc-600 uppercase">
                    {t("menuProperties.preview")}
                  </span>
                  <MiniMessageInline source={title} className="font-mono text-xs" />
                </div>
              ) : null}
            </div>
            <div className="w-20 shrink-0">
              <FieldLabel>{t("flow.countLabel")}</FieldLabel>
              <Input
                type="number"
                min={1}
                max={64}
                value={count}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isNaN(n) && n >= 1 && n <= 64) update("count", n);
                }}
                onFocus={() => setSub({ kind: "state", stateIndex })}
                className="h-8 px-2 py-0 text-xs"
              />
            </div>
          </div>

          {/* Lore */}
          <div>
            <FieldLabel>{t("flow.loreLabel", { lang: activeLang })}</FieldLabel>
            <textarea
              rows={lore.length > 2 ? 4 : 2}
              placeholder={t("flow.lorePlaceholder")}
              value={loreDraft}
              onFocus={() => {
                setLoreHasFocus(true);
                setSub({ kind: "state", stateIndex });
              }}
              onBlur={() => {
                setLoreHasFocus(false);
                const trimmed = loreDraft.replace(/\n+$/, "");
                updateLore(trimmed);
                setLoreDraft(trimmed);
              }}
              onChange={(e) => {
                setLoreDraft(e.target.value);
                updateLore(e.target.value.replace(/\n+$/, ""));
              }}
              className="w-full rounded border border-zinc-800 bg-zinc-950 p-2 font-mono text-xs"
            />
            <ArgInsertBar
              onInsert={(name) => {
                const next = `${loreDraft}{${name}}`;
                setLoreDraft(next);
                updateLore(next.replace(/\n+$/, ""));
              }}
            />
            {lore.length > 0 && pack ? (
              <div className="mt-1 flex flex-col gap-0.5 rounded border border-zinc-800 bg-[var(--color-bg)] px-2 py-1">
                <span className="text-[9px] text-zinc-600 uppercase">preview</span>
                {lore.map((line, i) => (
                  <MiniMessageInline
                    // biome-ignore lint/suspicious/noArrayIndexKey: lines are stable per render
                    key={i}
                    source={renderPreview(line, lorePreviewCtx, pack, activeLang)}
                    className="font-mono text-xs"
                  />
                ))}
              </div>
            ) : null}
          </div>

          {/* Visibility conditions */}
          <div className="overflow-x-auto">
            <ConditionListEditor
              label={t("flow.visibility")}
              conditions={appearance.if ?? []}
              joins={appearance.ifJoins}
              emptyHint={isDefault ? t("flow.visibilityAlwaysDefault") : t("flow.visibilityAlways")}
              onChange={(conditions) => {
                setSub({ kind: "state", stateIndex });
                setAppearanceConditions({
                  packId,
                  menuId: menu.id,
                  elementId: element.id,
                  appearanceIndex: stateIndex,
                  conditions,
                });
              }}
              onJoinChange={(joinIndex, op) =>
                setAppearanceJoin({
                  packId,
                  menuId: menu.id,
                  elementId: element.id,
                  appearanceIndex: stateIndex,
                  joinIndex,
                  op,
                })
              }
            />
          </div>

          {/* Click handlers — nested inside the focused state so the
          ownership is obvious (these handlers belong to *this* state). */}
          <div className="mt-1">
            <FieldLabel>{t("flow.clickHandlers")}</FieldLabel>
            <ElementClickHandlersPseudocode
              packId={packId}
              menuId={menu.id}
              elementId={element.id}
              stateIndex={stateIndex}
              click={appearance.click}
            />
          </div>
        </div>
      </div>
    </PlaceholderProvider>
  );
}

/**
 * Placeholders available inside an element's click handlers:
 *   - Implicit click context (player, slot, material) — always there.
 *   - Menu context inputs — declared by the parent menu.
 *   - This element's iteration alias, when set.
 */
function elementPlaceholders(menu: Menu, element: Element): readonly PlaceholderInfo[] {
  const list: PlaceholderInfo[] = [
    { name: "player", type: "player", source: "click-implicit" },
    { name: "slot", type: "integer", source: "click-implicit" },
    { name: "material", type: "string", source: "click-implicit" },
  ];
  for (const input of menu.contextInputs ?? []) {
    if (!input.name) continue;
    list.push({
      name: input.name,
      type: input.kind === "primitive" ? input.type : "sourceRef",
      source: "menu-context",
    });
  }
  if (element.iterates?.alias) {
    list.push({
      name: element.iterates.alias,
      type: "iteration item",
      source: "menu-context",
    });
  }
  // Pagination placeholders — computed from menu state at render time.
  // `pagination.page` / `pagination.totalPages` default to the first
  // iterable in the menu; per-source variants disambiguate when several
  // iterables coexist on the same screen.
  const iterSources = new Set<string>();
  for (const layer of menu.layers) {
    for (const el of layer.elements) {
      if (el.iterates?.source) iterSources.add(el.iterates.source);
    }
  }
  if (iterSources.size > 0) {
    list.push({ name: "pagination.page", type: "integer", source: "menu-context" });
    list.push({ name: "pagination.totalPages", type: "integer", source: "menu-context" });
    if (iterSources.size > 1) {
      for (const src of iterSources) {
        list.push({ name: `pagination.${src}.page`, type: "integer", source: "menu-context" });
        list.push({
          name: `pagination.${src}.totalPages`,
          type: "integer",
          source: "menu-context",
        });
      }
    }
  }
  return list;
}

function CommandIdField({ packId, commandId }: { packId: PackId; commandId: CommandId }) {
  const { t } = useTranslation();
  const setCommandId = useAccountStore((s) => s.setCommandId);
  const [draft, setDraft] = useState(commandId as string);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(commandId);
    setError(null);
  }, [commandId]);

  const commit = () => {
    if (draft === commandId) return;
    try {
      setCommandId({ packId, oldId: commandId, newId: draft as CommandId });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("menuProperties.renameRejected"));
      setDraft(commandId);
    }
  };

  return (
    <div>
      <FieldLabel>{t("flow.elementId")}</FieldLabel>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setDraft(commandId);
            setError(null);
            e.currentTarget.blur();
          }
        }}
        className={
          error
            ? "h-8 border-red-500/60 px-2 py-0 font-mono text-xs"
            : "h-8 px-2 py-0 font-mono text-xs"
        }
      />
      {error ? <div className="mt-1 text-[10px] text-red-300">{error}</div> : null}
    </div>
  );
}

function ElementIdField({
  packId,
  menuId,
  elementId,
}: {
  packId: PackId;
  menuId: MenuId;
  elementId: ElementId;
}) {
  const { t } = useTranslation();
  const setElementId = useAccountStore((s) => s.setElementId);
  const [draft, setDraft] = useState(elementId as string);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(elementId);
    setError(null);
  }, [elementId]);

  const commit = () => {
    if (draft === elementId) return;
    try {
      setElementId({ packId, menuId, oldId: elementId, newId: draft as ElementId });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("menuProperties.renameRejected"));
      setDraft(elementId);
    }
  };

  return (
    <div className="mb-3">
      <FieldLabel>{t("flow.elementId")}</FieldLabel>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setDraft(elementId);
            setError(null);
            e.currentTarget.blur();
          }
        }}
        className={
          error
            ? "h-8 border-red-500/60 px-2 py-0 font-mono text-xs"
            : "h-8 px-2 py-0 font-mono text-xs"
        }
      />
      {error ? <div className="mt-1 text-[10px] text-red-300">{error}</div> : null}
    </div>
  );
}

function PositionsField({
  packId,
  menuId,
  element,
}: {
  packId: PackId;
  menuId: MenuId;
  element: Element;
}) {
  const { t } = useTranslation();
  const setElementPositions = useAccountStore((s) => s.setElementPositions);
  const [draft, setDraft] = useState(element.positions);
  // biome-ignore lint/correctness/useExhaustiveDependencies: element.id forces draft reset on element switch
  useEffect(() => {
    setDraft(element.positions);
  }, [element.id, element.positions]);
  const commit = () => {
    const canonical = formatPositions(parsePositions(draft));
    if (canonical !== element.positions) {
      setElementPositions({ packId, menuId, elementId: element.id, positions: canonical });
    }
    setDraft(canonical);
  };
  const positionsCount = parsePositions(element.positions).length;
  return (
    <div className="mb-3">
      <FieldLabel>
        {t(positionsCount === 1 ? "flow.positionsLabelOne" : "flow.positionsLabelOther", {
          count: positionsCount,
        })}
      </FieldLabel>
      <Input
        value={draft}
        placeholder="0-8,17,26"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            e.currentTarget.blur();
          }
        }}
        className="h-8 px-2 py-0 font-mono text-xs"
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Command editor
// ────────────────────────────────────────────────────────────────────────────

function CommandEditor({ packId, command }: { packId: PackId; command: Command }) {
  const setCommandField = useAccountStore((s) => s.setCommandField);
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col bg-zinc-950">
      <div className="border-zinc-800 border-b bg-zinc-900 px-3 py-2">
        <div className="font-mono text-xs text-zinc-200">{commandSignature(command)}</div>
        <div className="text-[10px] text-zinc-500">
          {command.permission ? `perm: ${command.permission} · ` : ""}command
        </div>
      </div>
      <div className="flex-1 overflow-auto px-3 py-3">
        <Lane label={t("flow.elementId")}>
          <div className="flex flex-col gap-2">
            <CommandIdField packId={packId} commandId={command.id} />
            <PropertyField
              label={t("command.nameLabel")}
              value={command.name}
              onChange={(v) =>
                setCommandField({ packId, commandId: command.id, field: "name", value: v })
              }
            />
            <PropertyField
              label={t("command.permissionLabel")}
              value={command.permission ?? ""}
              placeholder={t("command.permissionPlaceholder")}
              onChange={(v) =>
                setCommandField({ packId, commandId: command.id, field: "permission", value: v })
              }
            />
            <PropertyField
              label={t("command.descriptionLabel")}
              value={command.description ?? ""}
              placeholder={t("command.descriptionPlaceholder")}
              multiline
              onChange={(v) =>
                setCommandField({ packId, commandId: command.id, field: "description", value: v })
              }
            />
          </div>
        </Lane>
        <Lane label={t("command.argumentsLabel")}>
          <CommandArgsEditor packId={packId} command={command} />
        </Lane>
        <Lane label={t("command.steps")}>
          <div className="overflow-x-auto rounded border border-zinc-800 bg-zinc-900/40 p-2">
            {/* Args declared above are referenceable as {name} in any text
                field of the actions inside this step tree. */}
            <PlaceholderProvider
              value={command.arguments.map<PlaceholderInfo>((a) => ({
                name: a.name,
                type: a.type,
                source: "command-arg",
              }))}
            >
              <CommandStepPseudocode
                packId={packId}
                commandId={command.id}
                steps={command.steps}
                frames={[]}
              />
            </PlaceholderProvider>
          </div>
        </Lane>
      </div>
    </div>
  );
}

const ARG_TYPES: CommandArg["type"][] = ["player", "string", "integer", "number", "boolean"];

/** `/cmd <player> [amount=10]` — Minecraft-y signature for the header. */
function commandSignature(command: Command): string {
  const parts = [`/${command.name}`];
  for (const arg of command.arguments) {
    const piece = arg.required
      ? `<${arg.name}>`
      : arg.default
        ? `[${arg.name}=${arg.default}]`
        : `[${arg.name}]`;
    parts.push(piece);
  }
  return parts.join(" ");
}

function CommandArgsEditor({ packId, command }: { packId: PackId; command: Command }) {
  const addCommandArg = useAccountStore((s) => s.addCommandArg);
  const setCommandArg = useAccountStore((s) => s.setCommandArg);
  const removeCommandArg = useAccountStore((s) => s.removeCommandArg);
  const [orderError, setOrderError] = useState<string | null>(null);
  const { t } = useTranslation();

  const dupNames = new Set<string>();
  const seen = new Set<string>();
  for (const a of command.arguments) {
    if (a.name === "") continue;
    if (seen.has(a.name)) dupNames.add(a.name);
    seen.add(a.name);
  }

  const update = (index: number, patch: Partial<CommandArg>) => {
    const current = command.arguments[index];
    if (!current) return;
    try {
      setCommandArg({ packId, commandId: command.id, index, arg: { ...current, ...patch } });
      setOrderError(null);
    } catch (e) {
      setOrderError(e instanceof Error ? e.message : t("command.argOrderError"));
    }
  };

  const addArg = () => {
    try {
      addCommandArg({ packId, commandId: command.id });
      setOrderError(null);
    } catch (e) {
      setOrderError(e instanceof Error ? e.message : t("command.argOrderError"));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] text-zinc-500">{t("command.argumentsHint", { tag: "{name}" })}</p>
      {orderError && (
        <div className="rounded border border-amber-500/60 bg-amber-500/5 px-2 py-1.5 text-[10px] text-amber-300">
          {orderError}
        </div>
      )}
      {command.arguments.length === 0 ? (
        <div className="rounded border border-zinc-800 border-dashed bg-zinc-900/40 px-2 py-3 text-[11px] text-zinc-500">
          {t("command.noArguments", { name: command.name })}
        </div>
      ) : (
        command.arguments.map((arg, i) => {
          const isInvalid = arg.name === "" || dupNames.has(arg.name);
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: arg index stable per render
              key={i}
              className={
                isInvalid
                  ? "flex flex-col gap-1 rounded border border-red-500/60 bg-red-500/5 p-1.5"
                  : "flex flex-col gap-1 rounded border border-zinc-800 bg-zinc-900/40 p-1.5"
              }
            >
              {/* Row 1: identity controls + remove button */}
              <div className="flex items-center gap-1.5">
                <Input
                  value={arg.name}
                  placeholder={t("command.argName")}
                  onChange={(e) => update(i, { name: e.target.value })}
                  className={
                    isInvalid
                      ? "h-8 w-28 border-red-500/60 px-2 py-0 font-mono text-xs"
                      : "h-8 w-28 px-2 py-0 font-mono text-xs"
                  }
                />
                <select
                  value={arg.type}
                  onChange={(e) => update(i, { type: e.target.value as CommandArg["type"] })}
                  className="h-8 rounded border border-zinc-800 bg-zinc-900 px-1.5 font-mono text-xs text-zinc-200"
                >
                  {ARG_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => update(i, { required: !arg.required })}
                  className={
                    arg.required
                      ? "h-8 rounded border border-emerald-500 bg-emerald-500/10 px-2 font-mono text-[11px] text-emerald-200"
                      : "h-8 rounded border border-zinc-700 px-2 font-mono text-[11px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                  }
                >
                  {arg.required ? t("command.required") : t("command.optional")}
                </button>
                <button
                  type="button"
                  title={t("command.removeArg")}
                  onClick={() => removeCommandArg({ packId, commandId: command.id, index: i })}
                  className="ml-auto flex h-7 w-7 items-center justify-center rounded text-[14px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                >
                  ×
                </button>
              </div>
              {/* Row 2: default value (optional args only) */}
              {!arg.required ? (
                <div className="flex items-center gap-2 pl-0.5">
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-[10px] text-zinc-500">
                      {t("command.defaultLabel")}:
                    </span>
                    <Input
                      value={arg.default === "{sender}" ? "" : (arg.default ?? "")}
                      placeholder={t("command.defaultPlaceholder")}
                      disabled={arg.default === "{sender}"}
                      onChange={(e) => update(i, { default: e.target.value || undefined })}
                      className="h-7 w-28 px-2 py-0 font-mono text-xs disabled:opacity-40"
                    />
                  </div>
                  {arg.type === "player" ? (
                    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-400">
                      <input
                        type="checkbox"
                        checked={arg.default === "{sender}"}
                        onChange={(e) =>
                          update(i, { default: e.target.checked ? "{sender}" : undefined })
                        }
                        className="h-3.5 w-3.5 accent-emerald-500"
                      />
                      {t("command.senderDefault")}
                    </label>
                  ) : null}
                </div>
              ) : null}
              {isInvalid ? (
                <div className="text-[10px] text-red-300">
                  {arg.name === ""
                    ? t("command.argNeedsName")
                    : t("command.argNameDup", { name: arg.name })}
                </div>
              ) : null}
            </div>
          );
        })
      )}
      <button
        type="button"
        onClick={addArg}
        className="self-start rounded border border-zinc-700 border-dashed px-3 py-1.5 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
      >
        {t("command.addArg")}
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Shared
// ────────────────────────────────────────────────────────────────────────────

function Lane({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 font-mono text-[10px] text-zinc-500 uppercase tracking-wider">
        {label}
      </div>
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 font-mono text-[10px] text-zinc-500 uppercase">{children}</div>;
}
