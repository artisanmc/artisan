import { PlaceholderInput } from "@/components/PlaceholderInput";
import { RevealField } from "@/components/RevealField";
import { usePlaceholderEntries } from "@/components/usePlaceholderEntries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getFirstTitleText } from "@/domain/menuTitle";
import type { Appearance, I18nKey } from "@/domain/types";
import type {
  Command,
  CommandArg,
  CommandId,
  Dialog,
  DialogId,
  DialogInput,
  Element,
  ElementId,
  Menu,
  MenuId,
  ProjectId,
} from "@/domain/types";
import { MaterialPicker } from "@/features/canvas/MaterialPicker";
import { CAPTURED_ITEM_REF_PREFIX, resolveDisplayRef } from "@/domain/capturedItems";
import { capturedStackDetails } from "@/domain/capturedStack";
import { AdvancedItemSection } from "./AdvancedItemSection";
import { headPreviewUrl } from "@/features/canvas/headTexture";
import { useTextureUrl } from "@/features/canvas/textureStore";
import { buildHeadValue, type HeadSource, headSourceOf, headValueOf } from "./headField";
import {
  type PlaceholderInfo,
  PlaceholderProvider,
} from "@/features/canvas/properties/ActionEditor";
import { ConditionListEditor } from "@/features/canvas/properties/ConditionListEditor";
import { MenuProperties } from "@/features/canvas/properties/MenuProperties";
import { ProjectProperties } from "@/features/canvas/properties/ProjectProperties";
import { PropertyField } from "@/features/canvas/properties/PropertyField";
import { AliasesField } from "@/features/canvas/properties/AliasesField";
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
import { Wand2 } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CommandStepPseudocode,
  DialogButtonStepPseudocode,
  ElementClickHandlersPseudocode,
} from "./PseudocodeView";

interface FlowCanvasProps {
  projectId: ProjectId;
}

const looksLikeMiniMessage = (s: string): boolean => s.includes("<");

/**
 * Unified editor for the current selection. Routes by kind:
 *   Project            → pack-level fields (description, source).
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
export function FlowCanvas({ projectId }: FlowCanvasProps) {
  const { t } = useTranslation();
  const ids = useSelectionStore((s) => s.ids);
  const selectionMenuId = useSelectionStore((s) => s.menuId);
  const pack = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const setSub = useFlowSelectionStore((s) => s.set);

  // biome-ignore lint/correctness/useExhaustiveDependencies: ids change is the trigger
  useEffect(() => {
    setSub(null);
  }, [setSub, [...ids].sort().join(",")]);

  if (!pack) return <EmptyHint label={t("projectNotFound")} />;
  if (ids.size > 1) {
    return <EmptyHint label="Multi-edit not supported in v1. Select one item." />;
  }
  if (ids.size === 0) {
    return (
      <div className="h-full overflow-y-auto p-3">
        <ProjectProperties pack={pack} />
      </div>
    );
  }

  const id = [...ids][0]!;
  const command = pack.commands.find((c) => c.id === id);
  if (command)
    return (
      <div className="h-full overflow-hidden">
        <CommandEditor projectId={projectId} command={command} />
      </div>
    );

  const dialog = pack.dialogs.find((d) => d.id === id);
  if (dialog)
    return (
      <div className="h-full overflow-hidden">
        <DialogEditor projectId={projectId} dialog={dialog} />
      </div>
    );

  // Element ids are only unique within a menu — scope resolution to the menu
  // the selection was made in, so a shared id (e.g. `grid` in two menus) edits
  // the right one rather than the first match.
  const menusForElement = selectionMenuId
    ? pack.menus.filter((m) => m.id === selectionMenuId)
    : pack.menus;
  for (const menu of menusForElement) {
    for (const layer of menu.layers) {
      const el = layer.elements.find((e) => e.id === id);
      if (el)
        return (
          <div className="h-full overflow-hidden">
            <ElementEditor projectId={projectId} menu={menu} element={el} />
          </div>
        );
    }
  }

  const menu = pack.menus.find((m) => m.id === id);
  if (menu) {
    return (
      <div className="h-full overflow-y-auto p-3">
        <MenuProperties projectId={projectId} menu={menu} />
      </div>
    );
  }

  return <EmptyHint label="Selection has no editor." />;
}

function EmptyHint({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-[var(--surface)] text-xs text-[var(--text-faint)]">
      {label}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Element editor
// ────────────────────────────────────────────────────────────────────────────

function ElementEditor({
  projectId,
  menu,
  element,
}: {
  projectId: ProjectId;
  menu: Menu;
  element: Element;
}) {
  const sub = useFlowSelectionStore((s) => s.sub);
  const setSub = useFlowSelectionStore((s) => s.set);
  const focusedStateIndex =
    sub && (sub.kind === "state" || sub.kind === "step") ? (sub.stateIndex ?? 0) : 0;

  const headerPack = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const appearances = element.appearances;
  const focusedState = appearances[focusedStateIndex] ?? appearances[0];
  const headerMaterial = focusedState?.material ?? "";
  // Captured-item refs (`item:<id>`) expand to their display descriptor.
  const headerDisplay = headerPack
    ? resolveDisplayRef(headerPack, headerMaterial)
    : { material: headerMaterial };
  const headerMaterialUrl = useTextureUrl(headerDisplay.material);
  const headerTextureUrl = headPreviewUrl(headerDisplay.head) ?? headerMaterialUrl;
  const getText = useGetText(projectId);
  const headerTitle = getText(focusedState?.title);
  const menuTitle = getText(getFirstTitleText(menu));
  const { t } = useTranslation();

  const addAppearance = useAccountStore((s) => s.addAppearance);
  const deleteElement = useAccountStore((s) => s.deleteElement);

  return (
    <div className="flex h-full flex-col bg-[var(--surface)]">
      {/* Element identity strip — preview of the focused state. */}
      <div className="flex items-center gap-3 border-[var(--border-soft)] border-b bg-[var(--surface-raised)] px-3 py-2">
        <div className="flex h-8 w-8 items-center justify-center rounded border border-[var(--border-soft)] bg-[var(--surface)]">
          {headerTextureUrl ? (
            <img
              src={headerTextureUrl}
              alt={headerMaterial}
              draggable={false}
              className="h-3/4 w-3/4 object-contain"
              style={{ imageRendering: "pixelated" }}
            />
          ) : (
            <span className="text-[8px] text-[var(--text-faint)]">{headerMaterial.slice(0, 4)}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-xs text-[var(--text)]">{headerTitle || headerMaterial}</div>
          <div className="text-[10px] text-[var(--text-faint)]">
            {menuTitle} ·{" "}
            {t(appearances.length === 1 ? "flow.headerStateOne" : "flow.headerStateOther", {
              count: appearances.length,
            })}
          </div>
        </div>
        {/* Always-available delete — works even for elements the canvas can't
            target (e.g. a placement element whose placements were all removed). */}
        <button
          type="button"
          data-testid="delete-element"
          title={t("flow.deleteElement")}
          onClick={() => {
            deleteElement({ projectId, menuId: menu.id, elementId: element.id });
            useSelectionStore.getState().clear();
          }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[14px] text-[var(--text-faint)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
        >
          🗑
        </button>
      </div>

      <div className="flex-1 overflow-auto px-3 py-3">
        <ElementIdField projectId={projectId} menuId={menu.id} elementId={element.id} />
        {/* Positions are meaningless in placement mode (each row carries its own
            slot), and iteration is the mutually-exclusive sibling. */}
        {!element.places ? (
          <PositionsField projectId={projectId} menuId={menu.id} element={element} />
        ) : null}
        {/* Iteration is managed at the MENU level (Données — Set d'items);
            the element only shows its binding as context for the states. */}
        {element.iterates ? (
          <div className="mb-3 rounded border border-[var(--brand-line)] border-dashed bg-[var(--brand-soft)] px-2.5 py-1.5 text-[11px] text-[var(--brand)]">
            {t("flow.iterateBound", { source: element.iterates.source, alias: element.iterates.alias || "item" })}
            <span className="ml-1 text-[10px] opacity-75">
              {t("flow.iterationManagedHint", { example: `{${element.iterates.alias || "item"}.champ}` })}
            </span>
          </div>
        ) : null}

        <Lane label={t("flow.states")}>
          <SortableStates
            projectId={projectId}
            menu={menu}
            element={element}
            appearances={appearances}
            focusedStateIndex={focusedStateIndex}
            onAdd={() => {
              addAppearance({ projectId, menuId: menu.id, elementId: element.id });
              setSub({ kind: "state", stateIndex: appearances.length });
            }}
          />
        </Lane>
      </div>
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
  projectId,
  menu,
  element,
  appearances,
  focusedStateIndex,
  onAdd,
}: {
  projectId: ProjectId;
  menu: Menu;
  element: Element;
  /** Set when the element is template-bound: cards edit the template's states. */
  appearances: Appearance[];
  focusedStateIndex: number;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  const moveAppearance = useAccountStore((s) => s.moveAppearance);
  const setSub = useFlowSelectionStore((s) => s.set);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const ids = useStableAppearanceIds(appearances);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const fromIndex = ids.indexOf(active.id as string);
    const toIndex = ids.indexOf(over.id as string);
    if (fromIndex < 0 || toIndex < 0) return;

    moveAppearance({
      projectId,
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
          {appearances.map((appearance, i) => (
            <StateCard
              // biome-ignore lint/suspicious/noArrayIndexKey: state index stable per list-render
              key={i}
              dragId={ids[i]!}
              projectId={projectId}
              menu={menu}
              element={element}
              appearance={appearance}
              stateIndex={i}
              stateCount={appearances.length}
              focused={focusedStateIndex === i}
            />
          ))}
          <button
            type="button"
            onClick={onAdd}
            className="self-start rounded border border-[var(--border)] border-dashed px-3 py-1.5 text-xs text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
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

/**
 * Custom-head editor shown on a player_head state. Source `<select>` chooses
 * the ref kind (HeadDatabase id / Base64 texture / player name); the input
 * holds the bare value. `buildHeadValue` re-detects pasted canonical values so
 * users can paste a full `hdb:…`/`eyJ…` and the select snaps to match.
 */
export function HeadField({ head, onChange }: { head: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  // Hold the user's chosen source locally so an empty head doesn't snap the
  // select back to "none" mid-edit (which would unmount the value input and
  // make the field unusable from a blank state). Seed from the head at mount
  // (the use site remounts via a key per element/state, so this never leaks
  // across cards). Derive from the stored value only when it's non-empty — that
  // also keeps paste-auto-detection working.
  const [localSource, setLocalSource] = useState<HeadSource>(() => headSourceOf(head));
  const source = head ? headSourceOf(head) : localSource;
  const placeholder =
    source === "hdb"
      ? t("flow.headPlaceholderHdb")
      : source === "playerhead"
        ? t("flow.headPlaceholderPlayer")
        : t("flow.headPlaceholderBase64");
  return (
    <div>
      <FieldLabel>{t("flow.headLabel")}</FieldLabel>
      <div className="flex items-center gap-1.5">
        <select
          className="h-8 w-32 shrink-0 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] px-1.5 text-xs text-[var(--text)]"
          value={source}
          onChange={(e) => {
            const next = e.target.value as HeadSource;
            setLocalSource(next);
            if (next === "none") onChange("");
            else {
              const rebuilt = buildHeadValue(next, headValueOf(head));
              if (rebuilt !== head) onChange(rebuilt);
            }
          }}
        >
          <option value="none">{t("flow.headSourceNone")}</option>
          <option value="hdb">{t("flow.headSourceHdb")}</option>
          <option value="basehead">{t("flow.headSourceBase64")}</option>
          <option value="playerhead">{t("flow.headSourcePlayer")}</option>
        </select>
        {source !== "none" ? (
          <Input
            value={headValueOf(head)}
            placeholder={placeholder}
            onChange={(e) => onChange(buildHeadValue(source, e.target.value))}
            className="h-8 flex-1 px-2 py-0 font-mono text-xs"
          />
        ) : null}
      </div>
      {source === "hdb" ? (
        <p className="mt-1 text-[10px] text-[var(--text-faint)]">{t("flow.headHdbHint")}</p>
      ) : null}
    </div>
  );
}

interface StateMaterialIconProps {
  projectId: ProjectId;
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
  projectId,
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
        projectId={projectId}
        trigger={
          <button
            type="button"
            title="Pick item from library — or drag a library item here"
            className={
              droppable.isOver
                ? "flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[var(--brand)] bg-[var(--brand-soft)] ring-2 ring-[var(--brand)]"
                : "flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[var(--border-soft)] bg-[var(--surface)] hover:border-[var(--brand)]"
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
              <span className="text-[8px] text-[var(--text-faint)]">{material.slice(0, 3) || "—"}</span>
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
      className="flex w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-l border-[var(--border-soft)] border-r font-mono text-[12px] text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] active:cursor-grabbing"
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
  projectId,
  menu,
  element,
  appearance,
  stateIndex,
  stateCount,
  focused,
}: {
  dragId: string;
  projectId: ProjectId;
  menu: Menu;
  element: Element;
  /** Set when the element is template-bound: edits target the template. */
  appearance: Appearance;
  stateIndex: number;
  stateCount: number;
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
  const setAppearanceAdvanced = useAccountStore((s) => s.setAppearanceAdvanced);
  const setAppearanceTitle = useAccountStore((s) => s.setAppearanceTitle);
  const setAppearanceLore = useAccountStore((s) => s.setAppearanceLore);
  const setAppearanceConditions = useAccountStore((s) => s.setAppearanceConditions);
  const setAppearanceJoin = useAccountStore((s) => s.setAppearanceJoin);
  const removeAppearance = useAccountStore((s) => s.removeAppearance);
  const activeLang = useUiStore((s) => s.activeLang);
  const getText = useGetText(projectId);
  const pack = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const target = { menuId: menu.id, elementId: element.id };

  const isDefault = stateIndex === 0;
  const material = appearance.material ?? "";
  // Captured-item refs (`item:<id>`) expand to their display descriptor.
  const display = pack ? resolveDisplayRef(pack, material) : { material };
  const materialUrl = useTextureUrl(display.material);
  const textureUrl = headPreviewUrl(appearance.head ?? display.head) ?? materialUrl;
  const title = getText(appearance.title);
  const count = appearance.count ?? 1;
  const loreText = appearance.lore ? getText(appearance.lore) : "";
  const lore = loreText ? loreText.split("\n") : [];

  // Fallback detection: the field shows the defaultLang text when the active
  // lang has no value — but typing writes the ACTIVE lang. Surface it in the
  // label so "I replaced the text" edits don't silently land in another lang.
  const inActiveLang = (lt: { key: I18nKey } | undefined) =>
    lt && pack ? pack.i18nKeys[lt.key]?.[activeLang] !== undefined : false;
  const titleIsFallback = Boolean(appearance.title && title !== "" && !inActiveLang(appearance.title));
  const loreIsFallback = Boolean(appearance.lore && loreText !== "" && !inActiveLang(appearance.lore));

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

  // Placeholder entries — computed once, shared by title and lore fields.
  const placeholderLocation = useMemo(
    () => ({ kind: "element" as const, menuId: menu.id, elementId: element.id }),
    [menu.id, element.id],
  );
  const placeholderEntries = usePlaceholderEntries(projectId, placeholderLocation);

  // Preview scope — binds the first list item when the element iterates so
  // expressions like {rank.price > 1 ? "★" : ""} resolve with real data.
  const previewArgs = useUiStore((s) => s.menuPreviewArgs[menu.id]);
  const lorePreviewCtx = useMemo(() => {
    if (!pack) return {};
    const base = buildPreviewScope(menu, pack, undefined, previewArgs);
    if (!element.iterates) return base;
    const list = lookupPath(base, element.iterates.source);
    if (!Array.isArray(list) || list.length === 0) return base;
    return { ...base, [element.iterates.alias]: list[0] };
  }, [pack, menu, element.iterates, previewArgs]);

  const update = (field: "material" | "count" | "head", value: string | number) =>
    setAppearanceField({
      projectId,
      ...target,
      appearanceIndex: stateIndex,
      field,
      value,
    });
  const updateTitle = (value: string) =>
    setAppearanceTitle({
      projectId,
      ...target,
      appearanceIndex: stateIndex,
      lang: activeLang,
      value,
    });
  const updateLore = (value: string) =>
    setAppearanceLore({
      projectId,
      ...target,
      appearanceIndex: stateIndex,
      lang: activeLang,
      value,
    });

  // A captured-item ref is opaque: the stack holds enchants, a name, a tint,
  // but none of it is editable while the appearance just points at `item:<id>`.
  // Extracting explodes the stack into real fields — at the cost of the link.
  const capturedItem = material.startsWith(CAPTURED_ITEM_REF_PREFIX)
    ? pack?.capturedItems?.find(
        (c) => String(c.id) === material.slice(CAPTURED_ITEM_REF_PREFIX.length),
      )
    : undefined;
  const capturedDetails = capturedItem ? capturedStackDetails(capturedItem.stackYaml) : undefined;

  const extractCapturedDetails = () => {
    if (!capturedDetails) return;
    if (!window.confirm(t("flow.advanced.extractConfirm", { name: capturedItem?.name ?? "" })))
      return;
    setSub({ kind: "state", stateIndex });
    update("material", capturedDetails.material ?? material);
    if (capturedDetails.headTexture) update("head", `basehead:${capturedDetails.headTexture}`);
    if (capturedDetails.count !== undefined) update("count", capturedDetails.count);
    if (capturedDetails.name) updateTitle(capturedDetails.name);
    if (capturedDetails.lore?.length) updateLore(capturedDetails.lore.join("\n"));
    setAppearanceAdvanced({
      projectId,
      ...target,
      appearanceIndex: stateIndex,
      patch: {
        enchants: capturedDetails.enchants,
        enchanted: capturedDetails.enchanted,
        customModelData: capturedDetails.customModelData,
        unbreakable: capturedDetails.unbreakable,
        hide: capturedDetails.hide,
        color: capturedDetails.color,
      },
    });
  };

  // Collapsed state — tooltip-style summary. Click anywhere to focus and
  // expand. Mirrors the in-canvas hover tooltip layout (icon left, MM-
  // formatted title + lore right) so the visual link is obvious.
  if (!focused) {
    const displayTitle = title.trim() || material || "(empty)";
    return (
      <div
        ref={sortable.setNodeRef}
        style={dragStyle}
        className="flex w-full items-stretch gap-1 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] transition-colors hover:border-[var(--border)]"
      >
        <DragHandleButton sortable={sortable} />
        <button
          type="button"
          onClick={() => setSub({ kind: "state", stateIndex })}
          className="flex min-w-0 flex-1 items-start gap-2 px-2 py-1.5 text-left"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-[var(--border-soft)] bg-[var(--surface)]">
            {textureUrl ? (
              <img
                src={textureUrl}
                alt={material}
                draggable={false}
                className="h-3/4 w-3/4 object-contain"
                style={{ imageRendering: "pixelated" }}
              />
            ) : (
              <span className="text-[8px] text-[var(--text-faint)]">{material.slice(0, 3) || "—"}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] text-[var(--text-faint)] uppercase tracking-wide">
              {isDefault ? t("flow.stateDefault") : t("flow.stateN", { index: stateIndex })}
              {!isDefault && (appearance.if ?? []).length > 0 ? (
                <span className="ml-1.5 normal-case text-[var(--text-faint)]">
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
              className="block truncate font-mono text-xs text-[var(--text)]"
            />
            {lore.length > 0
              ? lore.slice(0, 2).map((line, i) => (
                  <MiniMessageInline
                    // biome-ignore lint/suspicious/noArrayIndexKey: lore lines stable per render
                    key={i}
                    source={line}
                    className="block truncate font-mono text-[10px] text-[var(--text-mut)]"
                  />
                ))
              : null}
            {lore.length > 2 ? (
              <div className="font-mono text-[10px] text-[var(--text-faint)]">
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
        className="relative flex w-full items-stretch gap-1 rounded border border-[var(--brand)] bg-[var(--brand-soft)] text-xs transition-colors"
      >
        <DragHandleButton sortable={sortable} />
        <div className="flex min-w-0 flex-1 flex-col gap-2 px-2.5 py-2">
          {/* Header row — state name + delete. Click header to collapse. */}
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-[var(--text-faint)] uppercase tracking-wide">
              {isDefault ? t("flow.stateDefault") : t("flow.stateN", { index: stateIndex })}
            </span>
            <span className="rounded bg-[var(--brand-soft)] px-1.5 py-0.5 text-[9px] text-[var(--brand)] uppercase">
              {t("flow.editing")}
            </span>
            <span className="ml-auto" />
            {stateCount > 1 ? (
              <button
                type="button"
                title={t("flow.removeState")}
                onClick={() => {
                  removeAppearance({
                    projectId,
                    ...target,
                    appearanceIndex: stateIndex,
                  });
                  setSub(null);
                }}
                className="flex h-7 w-7 items-center justify-center rounded text-[14px] text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              >
                ×
              </button>
            ) : null}
          </div>

          {/* Material row */}
          <div className="flex items-center gap-1.5">
            <StateMaterialIcon
              projectId={projectId}
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

          {/* Captured item — offer to explode the ref into editable fields */}
          {capturedDetails ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={extractCapturedDetails}
              className="h-7 justify-start px-1 text-xs"
              title={t("flow.advanced.extractHint")}
            >
              <Wand2 size={12} className="mr-1" />
              {t("flow.advanced.extract")}
            </Button>
          ) : null}

          {/* Custom head — only meaningful when the material is a player_head */}
          {material.toLowerCase() === "player_head" ? (
            <HeadField
              key={`${element.id}-${stateIndex}`}
              head={appearance.head ?? ""}
              onChange={(v) => update("head", v)}
            />
          ) : null}

          {/* Title + count */}
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <FieldLabel>
                {t(titleIsFallback ? "flow.titleLabelFallback" : "flow.titleLabel", {
                  lang: activeLang,
                })}
              </FieldLabel>
              <RevealField
                value={title}
                onChange={(v) => updateTitle(v)}
                entries={placeholderEntries}
                placeholder={t("flow.titlePlaceholder")}
                onActivate={() => setSub({ kind: "state", stateIndex })}
                className="h-8 px-2 py-0 text-xs"
                facade={
                  <MiniMessageInline
                    source={pack ? renderPreview(title, lorePreviewCtx, pack, activeLang) : title}
                    className="font-mono text-xs"
                  />
                }
                preview={
                  looksLikeMiniMessage(title) ? (
                    <div className="mt-1 rounded border border-[var(--border-soft)] bg-[var(--surface-inset)] px-2 py-1">
                      <span className="mr-2 text-[9px] text-[var(--text-faint)] uppercase">
                        {t("menuProperties.preview")}
                      </span>
                      <MiniMessageInline source={title} className="font-mono text-xs" />
                    </div>
                  ) : null
                }
              />
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
            <FieldLabel>
              {t(loreIsFallback ? "flow.loreLabelFallback" : "flow.loreLabel", {
                lang: activeLang,
              })}
            </FieldLabel>
            <RevealField
              multiline
              rows={lore.length > 2 ? 4 : 2}
              value={loreDraft}
              onChange={(v) => {
                setLoreDraft(v);
                updateLore(v.replace(/\n+$/, ""));
              }}
              onActivate={() => {
                setLoreHasFocus(true);
                setSub({ kind: "state", stateIndex });
              }}
              onDeactivate={() => {
                setLoreHasFocus(false);
                const trimmed = loreDraft.replace(/\n+$/, "");
                updateLore(trimmed);
                setLoreDraft(trimmed);
              }}
              entries={placeholderEntries}
              placeholder={t("flow.lorePlaceholder")}
              className="min-h-0 px-2 py-1 text-xs"
              facade={
                pack ? (
                  <span className="flex flex-col gap-0.5">
                    {lore.map((line, i) => (
                      <MiniMessageInline
                        // biome-ignore lint/suspicious/noArrayIndexKey: lines are stable per render
                        key={i}
                        source={renderPreview(line, lorePreviewCtx, pack, activeLang)}
                        className="font-mono text-xs"
                      />
                    ))}
                  </span>
                ) : (
                  <span className="whitespace-pre-wrap font-mono text-xs">{loreText}</span>
                )
              }
              preview={
                lore.length > 0 && pack ? (
                  <div className="mt-1 flex flex-col gap-0.5 rounded border border-[var(--border-soft)] bg-[var(--surface-inset)] px-2 py-1">
                    <span className="text-[9px] text-[var(--text-faint)] uppercase">
                      {t("menuProperties.preview")}
                    </span>
                    {lore.map((line, i) => (
                      <MiniMessageInline
                        // biome-ignore lint/suspicious/noArrayIndexKey: lines are stable per render
                        key={i}
                        source={renderPreview(line, lorePreviewCtx, pack, activeLang)}
                        className="font-mono text-xs"
                      />
                    ))}
                  </div>
                ) : null
              }
            />
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
                  projectId,
                  ...target,
                  appearanceIndex: stateIndex,
                  conditions,
                });
              }}
              onJoinChange={(joinIndex, op) =>
                setAppearanceJoin({
                  projectId,
                  ...target,
                  appearanceIndex: stateIndex,
                  joinIndex,
                  op,
                })
              }
            />
          </div>

          {/* Advanced details — enchants, glint, CMD, unbreakable, hide, tint, NBT */}
          <AdvancedItemSection
            appearance={appearance}
            material={display.material}
            onFocus={() => setSub({ kind: "state", stateIndex })}
            onChange={(patch) =>
              setAppearanceAdvanced({ projectId, ...target, appearanceIndex: stateIndex, patch })
            }
          />

          {/* Click handlers — nested inside the focused state so the
          ownership is obvious (these handlers belong to *this* state). */}
          <div className="mt-1">
            <FieldLabel>{t("flow.clickHandlers")}</FieldLabel>
            <ElementClickHandlersPseudocode
              projectId={projectId}
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

function CommandIdField({ projectId, commandId }: { projectId: ProjectId; commandId: CommandId }) {
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
      setCommandId({ projectId, oldId: commandId, newId: draft as CommandId });
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
            ? "h-8 border-[var(--danger)] px-2 py-0 font-mono text-xs"
            : "h-8 px-2 py-0 font-mono text-xs"
        }
      />
      {error ? <div className="mt-1 text-[10px] text-[var(--danger)]">{error}</div> : null}
    </div>
  );
}

function ElementIdField({
  projectId,
  menuId,
  elementId,
}: {
  projectId: ProjectId;
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
      setElementId({ projectId, menuId, oldId: elementId, newId: draft as ElementId });
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
            ? "h-8 border-[var(--danger)] px-2 py-0 font-mono text-xs"
            : "h-8 px-2 py-0 font-mono text-xs"
        }
      />
      {error ? <div className="mt-1 text-[10px] text-[var(--danger)]">{error}</div> : null}
    </div>
  );
}

function PositionsField({
  projectId,
  menuId,
  element,
}: {
  projectId: ProjectId;
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
      setElementPositions({ projectId, menuId, elementId: element.id, positions: canonical });
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

function CommandEditor({ projectId, command }: { projectId: ProjectId; command: Command }) {
  const setCommandField = useAccountStore((s) => s.setCommandField);
  const setCommandAliases = useAccountStore((s) => s.setCommandAliases);
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col bg-[var(--surface)]">
      <div className="border-[var(--border-soft)] border-b bg-[var(--surface-raised)] px-3 py-2">
        <div className="font-mono text-xs text-[var(--text)]">{commandSignature(command)}</div>
        <div className="text-[10px] text-[var(--text-faint)]">
          {command.permission ? `perm: ${command.permission} · ` : ""}command
        </div>
      </div>
      <div className="@container flex-1 overflow-auto px-3 py-3">
        {/* Wide containers (individual view) split into two columns: properties
            left, arguments + steps right. The narrow right pane stays stacked. */}
        <div className="grid grid-cols-1 gap-x-6 @2xl:grid-cols-2 @2xl:items-start">
          <div className="min-w-0">
            <Lane label={t("flow.propertiesLabel")}>
              <div className="flex flex-col gap-2">
                <CommandIdField projectId={projectId} commandId={command.id} />
                <PropertyField
                  label={t("command.nameLabel")}
                  value={command.name}
                  onChange={(v) =>
                    setCommandField({ projectId, commandId: command.id, field: "name", value: v })
                  }
                />
                <PropertyField
                  label={t("command.permissionLabel")}
                  value={command.permission ?? ""}
                  placeholder={t("command.permissionPlaceholder")}
                  onChange={(v) =>
                    setCommandField({ projectId, commandId: command.id, field: "permission", value: v })
                  }
                />
                <PropertyField
                  label={t("command.descriptionLabel")}
                  value={command.description ?? ""}
                  placeholder={t("command.descriptionPlaceholder")}
                  multiline
                  onChange={(v) =>
                    setCommandField({ projectId, commandId: command.id, field: "description", value: v })
                  }
                />
                <AliasesField
                  label={t("command.aliasesLabel")}
                  aliases={command.aliases ?? []}
                  onChange={(aliases) =>
                    setCommandAliases({
                      projectId,
                      commandId: command.id,
                      aliases,
                    })
                  }
                />
              </div>
            </Lane>
          </div>
          <div className="min-w-0">
            <Lane label={t("command.argumentsLabel")}>
              <CommandArgsEditor projectId={projectId} command={command} />
            </Lane>
            <Lane label={t("command.steps")}>
              <div className="overflow-x-auto rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] p-2">
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
                    projectId={projectId}
                    commandId={command.id}
                    steps={command.steps}
                    frames={[]}
                  />
                </PlaceholderProvider>
              </div>
            </Lane>
          </div>
        </div>
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

function CommandArgsEditor({ projectId, command }: { projectId: ProjectId; command: Command }) {
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
      setCommandArg({ projectId, commandId: command.id, index, arg: { ...current, ...patch } });
      setOrderError(null);
    } catch (e) {
      setOrderError(e instanceof Error ? e.message : t("command.argOrderError"));
    }
  };

  const addArg = () => {
    try {
      addCommandArg({ projectId, commandId: command.id });
      setOrderError(null);
    } catch (e) {
      setOrderError(e instanceof Error ? e.message : t("command.argOrderError"));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] text-[var(--text-faint)]">{t("command.argumentsHint", { tag: "{name}" })}</p>
      {orderError && (
        <div className="rounded border border-[var(--warning)] bg-[var(--warning-soft)] px-2 py-1.5 text-[10px] text-[var(--warning)]">
          {orderError}
        </div>
      )}
      {command.arguments.length === 0 ? (
        <div className="rounded border border-[var(--border-soft)] border-dashed bg-[var(--surface-raised)] px-2 py-3 text-[11px] text-[var(--text-faint)]">
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
                  ? "flex flex-col gap-1 rounded border border-[var(--danger)] bg-[var(--danger-soft)] p-1.5"
                  : "flex flex-col gap-1 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] p-1.5"
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
                      ? "h-8 w-28 border-[var(--danger)] px-2 py-0 font-mono text-xs"
                      : "h-8 w-28 px-2 py-0 font-mono text-xs"
                  }
                />
                <select
                  value={arg.type}
                  onChange={(e) => update(i, { type: e.target.value as CommandArg["type"] })}
                  className="h-8 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] px-1.5 font-mono text-xs text-[var(--text)]"
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
                      ? "h-8 rounded border border-[var(--brand)] bg-[var(--brand-soft)] px-2 font-mono text-[11px] text-[var(--brand)]"
                      : "h-8 rounded border border-[var(--border)] px-2 font-mono text-[11px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
                  }
                >
                  {arg.required ? t("command.required") : t("command.optional")}
                </button>
                <button
                  type="button"
                  title={t("command.removeArg")}
                  onClick={() => removeCommandArg({ projectId, commandId: command.id, index: i })}
                  className="ml-auto flex h-7 w-7 items-center justify-center rounded text-[14px] text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                >
                  ×
                </button>
              </div>
              {/* Row 2: default value (optional args only) */}
              {!arg.required ? (
                <div className="flex items-center gap-2 pl-0.5">
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-[10px] text-[var(--text-faint)]">
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
                    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--text-mut)]">
                      <input
                        type="checkbox"
                        checked={arg.default === "{sender}"}
                        onChange={(e) =>
                          update(i, { default: e.target.checked ? "{sender}" : undefined })
                        }
                        className="h-3.5 w-3.5 accent-[var(--brand)]"
                      />
                      {t("command.senderDefault")}
                    </label>
                  ) : null}
                </div>
              ) : null}
              {isInvalid ? (
                <div className="text-[10px] text-[var(--danger)]">
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
        className="self-start rounded border border-[var(--border)] border-dashed px-3 py-1.5 text-xs text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
      >
        {t("command.addArg")}
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Dialog editor
// ────────────────────────────────────────────────────────────────────────────

function DialogIdField({ projectId, dialogId }: { projectId: ProjectId; dialogId: DialogId }) {
  const { t } = useTranslation();
  const setDialogId = useAccountStore((s) => s.setDialogId);
  const [draft, setDraft] = useState(dialogId as string);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(dialogId);
    setError(null);
  }, [dialogId]);

  const commit = () => {
    if (draft === dialogId) return;
    try {
      setDialogId({ projectId, oldId: dialogId, newId: draft as DialogId });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("dialog.renameRejected"));
      setDraft(dialogId);
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
            setDraft(dialogId);
            setError(null);
            e.currentTarget.blur();
          }
        }}
        className={
          error
            ? "h-8 border-[var(--danger)] px-2 py-0 font-mono text-xs"
            : "h-8 px-2 py-0 font-mono text-xs"
        }
      />
      {error ? <div className="mt-1 text-[10px] text-[var(--danger)]">{error}</div> : null}
    </div>
  );
}

function DialogEditor({ projectId, dialog }: { projectId: ProjectId; dialog: Dialog }) {
  const { t } = useTranslation();
  const setDialogTitle = useAccountStore((s) => s.setDialogTitle);
  const setDialogField = useAccountStore((s) => s.setDialogField);
  const addDialogBody = useAccountStore((s) => s.addDialogBody);
  const removeDialogBody = useAccountStore((s) => s.removeDialogBody);
  const setDialogBodyText = useAccountStore((s) => s.setDialogBodyText);
  const setDialogBodyMaterial = useAccountStore((s) => s.setDialogBodyMaterial);
  const addDialogInput = useAccountStore((s) => s.addDialogInput);
  const removeDialogInput = useAccountStore((s) => s.removeDialogInput);
  const setDialogInput = useAccountStore((s) => s.setDialogInput);
  const setI18nValue = useAccountStore((s) => s.setI18nValue);
  const addDialogButton = useAccountStore((s) => s.addDialogButton);
  const removeDialogButton = useAccountStore((s) => s.removeDialogButton);
  const setDialogButtonLabel = useAccountStore((s) => s.setDialogButtonLabel);
  const activeLang = useUiStore((s) => s.activeLang);
  const getText = useGetText(projectId);

  const titlePlaceholderLocation = useMemo(
    () => ({ kind: "dialog" as const, dialogId: dialog.id }),
    [dialog.id],
  );
  const titlePlaceholderEntries = usePlaceholderEntries(projectId, titlePlaceholderLocation);

  return (
    <div className="flex h-full flex-col bg-[var(--surface)]">
      <div className="border-[var(--border-soft)] border-b bg-[var(--surface-raised)] px-3 py-2">
        <div className="font-mono text-xs text-[var(--brand)]">{dialog.id}</div>
        <div className="text-[10px] text-[var(--text-faint)]">
          dialog · {dialog.buttons.length} button{dialog.buttons.length !== 1 ? "s" : ""}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-3 py-3">
        <Lane label={t("flow.propertiesLabel")}>
          <DialogIdField projectId={projectId} dialogId={dialog.id} />
          <div>
            <div className="mb-1 text-[10px] uppercase text-[var(--text-faint)]">
              {t("dialog.titleLabel", { lang: activeLang })}
            </div>
            <PlaceholderInput
              value={getText(dialog.title)}
              onChange={(v) =>
                setDialogTitle({ projectId, dialogId: dialog.id, lang: activeLang, value: v })
              }
              entries={titlePlaceholderEntries}
            />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--text-mut)]">
              <input
                type="checkbox"
                checked={dialog.canCloseWithEscape}
                onChange={(e) =>
                  setDialogField({
                    projectId,
                    dialogId: dialog.id,
                    field: "canCloseWithEscape",
                    value: e.target.checked,
                  })
                }
                className="h-3.5 w-3.5 accent-[var(--brand)]"
              />
              {t("dialog.canCloseWithEscape")}
            </label>
          </div>
        </Lane>

        <Lane label={t("dialog.bodyLabel")}>
          <div className="flex flex-col gap-2">
            {dialog.body.map((body, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: body index stable per render
                key={i}
                className="flex items-start gap-1.5 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] p-1.5"
              >
                {body.type === "text" ? (
                  <div className="flex-1">
                    <FieldLabel>text ({activeLang})</FieldLabel>
                    <Input
                      value={getText(body.text)}
                      placeholder={t("dialog.bodyTextPlaceholder")}
                      onChange={(e) =>
                        setDialogBodyText({
                          projectId,
                          dialogId: dialog.id,
                          index: i,
                          lang: activeLang,
                          value: e.target.value,
                        })
                      }
                      className="h-8 px-2 py-0 text-xs"
                    />
                  </div>
                ) : (
                  <div className="flex flex-1 items-center gap-2">
                    <Input
                      value={body.material}
                      placeholder="DIAMOND"
                      onChange={(e) =>
                        setDialogBodyMaterial({
                          projectId,
                          dialogId: dialog.id,
                          index: i,
                          material: e.target.value.toUpperCase(),
                          count: body.count,
                        })
                      }
                      className="h-8 flex-1 px-2 py-0 font-mono text-xs"
                    />
                    <Input
                      type="number"
                      min={1}
                      max={64}
                      value={body.count}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (!Number.isNaN(n) && n >= 1 && n <= 64) {
                          setDialogBodyMaterial({
                            projectId,
                            dialogId: dialog.id,
                            index: i,
                            material: body.material,
                            count: n,
                          });
                        }
                      }}
                      className="h-8 w-16 px-2 py-0 text-xs"
                    />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeDialogBody({ projectId, dialogId: dialog.id, index: i })}
                  className="flex h-7 w-7 items-center justify-center rounded text-[14px] text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                >
                  ×
                </button>
              </div>
            ))}
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() =>
                  addDialogBody({
                    projectId,
                    dialogId: dialog.id,
                    body: { type: "text", text: { key: "" as Dialog["title"]["key"] } },
                  })
                }
                className="rounded border border-[var(--border)] border-dashed px-2 py-1 text-[10px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
              >
                {t("dialog.addBodyText")}
              </button>
              <button
                type="button"
                onClick={() =>
                  addDialogBody({
                    projectId,
                    dialogId: dialog.id,
                    body: { type: "item", material: "DIAMOND", count: 1 },
                  })
                }
                className="rounded border border-[var(--border)] border-dashed px-2 py-1 text-[10px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
              >
                {t("dialog.addBodyItem")}
              </button>
            </div>
          </div>
        </Lane>

        <Lane label={t("dialog.inputsLabel")}>
          <div className="flex flex-col gap-2">
            {dialog.inputs.map((input, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: input index stable per render
                key={i}
                className="flex flex-col gap-1.5 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] p-1.5"
              >
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-[var(--surface-raised-2)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--text-mut)]">
                    {input.type}
                  </span>
                  <Input
                    value={input.id}
                    placeholder={t("dialog.inputIdPlaceholder")}
                    onChange={(e) =>
                      setDialogInput({
                        projectId,
                        dialogId: dialog.id,
                        index: i,
                        patch: { id: e.target.value } as Partial<DialogInput>,
                      })
                    }
                    className="h-7 w-28 px-2 py-0 font-mono text-xs"
                  />
                  <Input
                    value={getText(input.label)}
                    placeholder={t("dialog.inputLabelPlaceholder")}
                    onChange={(e) =>
                      setI18nValue({
                        projectId,
                        lt: input.label,
                        lang: activeLang,
                        value: e.target.value,
                      })
                    }
                    className="h-7 flex-1 px-2 py-0 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      removeDialogInput({ projectId, dialogId: dialog.id, index: i })
                    }
                    className="flex h-7 w-7 items-center justify-center rounded text-[14px] text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                  >
                    ×
                  </button>
                </div>
                {input.type === "number_range" ? (
                  <div className="flex items-center gap-2 pl-0.5">
                    <span className="font-mono text-[10px] text-[var(--text-faint)]">{t("dialog.inputMin")}</span>
                    <Input
                      type="number"
                      value={input.min}
                      onChange={(e) =>
                        setDialogInput({
                          projectId,
                          dialogId: dialog.id,
                          index: i,
                          patch: { min: Number(e.target.value) } as Partial<DialogInput>,
                        })
                      }
                      className="h-7 w-20 px-2 py-0 text-xs"
                    />
                    <span className="font-mono text-[10px] text-[var(--text-faint)]">{t("dialog.inputMax")}</span>
                    <Input
                      type="number"
                      value={input.max}
                      onChange={(e) =>
                        setDialogInput({
                          projectId,
                          dialogId: dialog.id,
                          index: i,
                          patch: { max: Number(e.target.value) } as Partial<DialogInput>,
                        })
                      }
                      className="h-7 w-20 px-2 py-0 text-xs"
                    />
                    <span className="font-mono text-[10px] text-[var(--text-faint)]">{t("dialog.inputDefault")}</span>
                    <Input
                      type="number"
                      value={input.default}
                      onChange={(e) =>
                        setDialogInput({
                          projectId,
                          dialogId: dialog.id,
                          index: i,
                          patch: { default: Number(e.target.value) } as Partial<DialogInput>,
                        })
                      }
                      className="h-7 w-20 px-2 py-0 text-xs"
                    />
                  </div>
                ) : null}
                {input.type === "text" ? (
                  <div className="flex items-center gap-2 pl-0.5">
                    <span className="font-mono text-[10px] text-[var(--text-faint)]">{t("dialog.inputMaxLength")}</span>
                    <Input
                      type="number"
                      min={1}
                      max={256}
                      value={input.maxLength}
                      onChange={(e) =>
                        setDialogInput({
                          projectId,
                          dialogId: dialog.id,
                          index: i,
                          patch: { maxLength: Number(e.target.value) } as Partial<DialogInput>,
                        })
                      }
                      className="h-7 w-20 px-2 py-0 text-xs"
                    />
                  </div>
                ) : null}
                {input.type === "bool" ? (
                  <div className="flex items-center gap-2 pl-0.5">
                    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--text-mut)]">
                      <input
                        type="checkbox"
                        checked={input.default}
                        onChange={(e) =>
                          setDialogInput({
                            projectId,
                            dialogId: dialog.id,
                            index: i,
                            patch: { default: e.target.checked } as Partial<DialogInput>,
                          })
                        }
                        className="h-3.5 w-3.5 accent-[var(--brand)]"
                      />
                      {t("dialog.inputDefaultChecked")}
                    </label>
                  </div>
                ) : null}
              </div>
            ))}
            <div className="flex flex-wrap gap-1.5">
              {(["text", "bool", "number_range"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() =>
                    addDialogInput({ projectId, dialogId: dialog.id, inputType: type })
                  }
                  className="rounded border border-[var(--border)] border-dashed px-2 py-1 text-[10px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
                >
                  + {type}
                </button>
              ))}
            </div>
          </div>
        </Lane>

        <Lane label={t("dialog.buttonsLabel")}>
          <div className="flex flex-col gap-3">
            {dialog.buttons.map((btn, btnIndex) => (
              <div key={btn.id} className="rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] p-2">
                <div className="mb-2 flex items-center gap-1.5">
                  <span className="font-mono text-[10px] text-[var(--text-faint)]">{btn.id}</span>
                  <Input
                    value={getText(btn.label)}
                    placeholder={t("dialog.buttonLabelPlaceholder")}
                    onChange={(e) =>
                      setDialogButtonLabel({
                        projectId,
                        dialogId: dialog.id,
                        buttonIndex: btnIndex,
                        lang: activeLang,
                        value: e.target.value,
                      })
                    }
                    className="h-7 flex-1 px-2 py-0 text-xs"
                  />
                  {dialog.buttons.length > 1 ? (
                    <button
                      type="button"
                      onClick={() =>
                        removeDialogButton({
                          projectId,
                          dialogId: dialog.id,
                          buttonIndex: btnIndex,
                        })
                      }
                      className="flex h-7 w-7 items-center justify-center rounded text-[14px] text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
                <div className="overflow-x-auto rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] p-2">
                  <DialogButtonStepPseudocode
                    projectId={projectId}
                    dialogId={dialog.id}
                    buttonIndex={btnIndex}
                    steps={btn.steps}
                    frames={[]}
                  />
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => addDialogButton({ projectId, dialogId: dialog.id })}
              className="self-start rounded border border-[var(--border)] border-dashed px-3 py-1.5 text-xs text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
            >
              {t("dialog.addButton")}
            </button>
          </div>
        </Lane>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Shared
// ────────────────────────────────────────────────────────────────────────────

function Lane({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 font-mono text-[10px] text-[var(--text-faint)] uppercase tracking-wider">
        {label}
      </div>
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 font-mono text-[10px] text-[var(--text-faint)] uppercase">{children}</div>
  );
}
