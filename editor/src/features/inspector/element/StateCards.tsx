import { RevealField } from "@/components/RevealField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePlaceholderEntries } from "@/components/usePlaceholderEntries";
import { assetPreviewUrl } from "@/domain/asset";
import { CAPTURED_ITEM_REF_PREFIX, resolveDisplayRef } from "@/domain/capturedItems";
import { capturedStackDetails } from "@/domain/capturedStack";
import type {
  Appearance,
  Element,
  ElementId,
  I18nKey,
  Menu,
  MenuId,
  ProjectId,
} from "@/domain/types";
import { useAssetStore } from "@/features/assets/assetStore";
import { ItemEditor } from "@/features/canvas/ItemEditor";
import { MaterialPicker } from "@/features/canvas/MaterialPicker";
import { ItemBindingEditor } from "@/features/canvas/item/ItemBindingEditor";
import { previewItem } from "@/features/canvas/itemValuePreview";
import { buildPreviewScope } from "@/features/canvas/menuPreviewScope";
import { useTextureUrl } from "@/features/canvas/textureStore";
import { useHeadPreviewUrl } from "@/features/canvas/useHeadPreviewUrl";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { lookupPath } from "@/lib/placeholders";
import { stateDropId } from "@/lib/stateDropId";
import { useGetText } from "@/lib/useText";
import { useAccountStore } from "@/state/accountStore";
import { useFlowSelectionStore } from "@/state/flowSelectionStore";
import { useServerSnapshotsStore } from "@/state/serverSnapshotsStore";
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
import { type CSSProperties, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ElementClickHandlersPseudocode } from "../chain/PseudocodeView";
import { conditionsSummary } from "../chain/labels";
import { FieldLabel } from "../layout";
import { ConditionListEditor } from "../properties/ConditionListEditor";
import { ImageButtonEditor } from "./ImageButtonEditor";

/**
 * State cards list with drag-and-drop reordering. The order is meaningful
 * (first matching appearance wins at runtime), so users can push the
 * "common" state up and the fallback default down. Uses ref-stable ids
 * per Appearance object — same trick as the pseudocode steps — so
 * @dnd-kit doesn't re-shuffle anything on the post-drop re-render.
 */
export function SortableStates({
  projectId,
  menu,
  element,
  appearances,
  focusedStateIndex,
  onAdd,
  onDuplicate,
}: {
  projectId: ProjectId;
  menu: Menu;
  element: Element;
  /** Set when the element is template-bound: cards edit the template's states. */
  appearances: Appearance[];
  focusedStateIndex: number;
  onAdd: () => void;
  onDuplicate: () => void;
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
          <div className="flex items-center gap-2 self-start">
            <button
              type="button"
              onClick={onAdd}
              className="rounded border border-[var(--border)] border-dashed px-3 py-1.5 text-xs text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
            >
              {t("flow.addState")}
            </button>
            {/* A state REPLACES the display, so "add" starts empty on purpose —
                duplicating is the separate, explicit gesture. */}
            <button
              type="button"
              onClick={onDuplicate}
              title={t("flow.duplicateStateHint")}
              className="rounded border border-[var(--border)] border-dashed px-3 py-1.5 text-xs text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
            >
              {t("flow.duplicateState")}
            </button>
          </div>
        </div>
      </SortableContext>
    </DndContext>
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
  const { t } = useTranslation();
  const droppable = useDroppable({ id: stateDropId(menuId, elementId, stateIndex) });
  return (
    <div ref={droppable.setNodeRef}>
      <MaterialPicker
        projectId={projectId}
        trigger={
          <button
            type="button"
            title={t("flow.pickMaterialHint")}
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
              <span className="text-[8px] text-[var(--text-faint)]">
                {material.slice(0, 3) || "—"}
              </span>
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
  const { t } = useTranslation();
  return (
    <button
      type="button"
      title={t("flow.dragStateHint")}
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
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const target = { menuId: menu.id, elementId: element.id };

  const isDefault = stateIndex === 0;
  const material = appearance.material ?? "";
  // Captured-item refs (`item:<id>`) expand to their display descriptor.
  const display = project ? resolveDisplayRef(project, material) : { material };
  const materialUrl = useTextureUrl(display.material);
  const itemTextureUrl = useHeadPreviewUrl(appearance.head ?? display.head) ?? materialUrl;
  const imageAsset = useAssetStore((s) =>
    s.assets.find((a) => a.projectId === projectId && a.id === appearance.image?.asset),
  );
  const textureUrl = imageAsset ? assetPreviewUrl(imageAsset) : itemTextureUrl;
  const title = getText(appearance.title);

  const loreText = appearance.lore ? getText(appearance.lore) : "";
  const lore = loreText ? loreText.split("\n") : [];

  // Fallback detection: the field shows the defaultLang text when the active
  // lang has no value — but typing writes the ACTIVE lang. Surface it in the
  // label so "I replaced the text" edits don't silently land in another lang.
  const inActiveLang = (lt: { key: I18nKey } | undefined) =>
    lt && project ? project.i18nKeys[lt.key]?.[activeLang] !== undefined : false;
  const titleIsFallback = Boolean(
    appearance.title && title !== "" && !inActiveLang(appearance.title),
  );
  const loreIsFallback = Boolean(
    appearance.lore && loreText !== "" && !inActiveLang(appearance.lore),
  );

  // Placeholder entries — computed once, shared by title and lore fields.
  const placeholderLocation = useMemo(
    () => ({ kind: "element" as const, menuId: menu.id, elementId: element.id }),
    [menu.id, element.id],
  );
  const placeholderEntries = usePlaceholderEntries(projectId, placeholderLocation);

  // Preview scope — binds the first list item when the element iterates so
  // expressions like {rank.price > 1 ? "★" : ""} resolve with real data.
  const previewArgs = useUiStore((s) => s.menuPreviewArgs[menu.id]);
  const snapshots = useServerSnapshotsStore((s) => s.rowsByRef);
  const lorePreviewCtx = useMemo(() => {
    if (!project) return {};
    const base = buildPreviewScope(menu, project, snapshots, previewArgs);
    const iteration = element.iterates ?? element.places;
    if (!iteration) return base;
    const list = lookupPath(base, iteration.source);
    if (!Array.isArray(list) || list.length === 0) return base;
    return { ...base, [iteration.alias]: list[0] };
  }, [project, menu, element.iterates, element.places, previewArgs, snapshots]);
  const linkedItem =
    appearance.item ?? (appearance.material?.startsWith("{") ? appearance.material : undefined);
  const inheritedItem = project
    ? previewItem({ item: linkedItem ?? appearance.material }, lorePreviewCtx, project, activeLang)
    : { lore: [] };

  const update = (
    field: "material" | "item" | "count" | "head" | "loreMode" | "title" | "lore",
    value: string | number | undefined,
  ) =>
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
    ? project?.capturedItems?.find(
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
    const conditionText = appearance.if?.length
      ? conditionsSummary(appearance.if, appearance.ifJoins)
      : "";
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
              <span className="text-[8px] text-[var(--text-faint)]">
                {material.slice(0, 3) || "—"}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] text-[var(--text-faint)] uppercase tracking-wide">
              {isDefault ? t("flow.stateDefault") : t("flow.stateN", { index: stateIndex })}
            </div>
            {conditionText ? (
              <div
                title={conditionText}
                className="truncate font-mono text-[10px] text-[var(--brand)]"
              >
                {t("flow.stateCondition", { summary: conditionText })}
              </div>
            ) : null}
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
    <>
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

          <ImageButtonEditor
            projectId={projectId}
            menu={menu}
            element={element}
            image={appearance.image}
            onImage={(image, positions) =>
              useAccountStore.getState().setAppearanceImage({
                projectId,
                ...target,
                appearanceIndex: stateIndex,
                image,
                positions,
              })
            }
            onItem={() => {
              if (appearance.image) update("material", "STONE");
            }}
            onPositions={(positions) =>
              useAccountStore.getState().setElementPositions({ projectId, ...target, positions })
            }
          >
            {/* biome-ignore lint/a11y/noLabelWithoutControl: RevealField renders a labelable <button> facade (then an input) inside this label; Biome cannot see through the component */}
            <label className="field-label">
              {t("flow.titleLabel", { lang: activeLang })}
              <RevealField
                value={title}
                onChange={updateTitle}
                entries={placeholderEntries}
                className="input w-full"
                facade={<MiniMessageInline source={title || t("flow.titlePlaceholder")} />}
              />
            </label>
            {/* biome-ignore lint/a11y/noLabelWithoutControl: RevealField renders a labelable <button> facade (then an input) inside this label; Biome cannot see through the component */}
            <label className="field-label">
              {t("flow.loreLabel", { lang: activeLang })}
              <RevealField
                value={loreText}
                onChange={updateLore}
                entries={placeholderEntries}
                multiline
                className="input w-full"
                facade={<MiniMessageInline source={loreText || t("flow.lorePlaceholder")} />}
              />
            </label>
          </ImageButtonEditor>
          {project && !appearance.image && (
            <ItemEditor
              project={project}
              onHead={(value) => update("head", value)}
              details={
                <>
                  {" "}
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
                </>
              }
              source={
                <ItemBindingEditor
                  project={project}
                  menu={menu}
                  element={element}
                  appearance={appearance}
                  scope={lorePreviewCtx}
                  lang={activeLang}
                  onSource={update}
                >
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
                      onChange={(e) => update("material", e.target.value)}
                      className="h-8 flex-1 px-2 py-0 font-mono text-xs"
                    />
                  </div>
                </ItemBindingEditor>
              }
              appearance={appearance}
              inherited={inheritedItem}
              preview={previewItem(appearance, lorePreviewCtx, project, activeLang)}
              title={appearance.title ? title : undefined}
              lore={appearance.lore ? loreText : undefined}
              loreMode={appearance.loreMode}
              onLoreMode={(mode) => update("loreMode", mode)}
              titleLabel={t(titleIsFallback ? "flow.titleLabelFallback" : "flow.titleLabel", {
                lang: activeLang,
              })}
              loreLabel={t(loreIsFallback ? "flow.loreLabelFallback" : "flow.loreLabel", {
                lang: activeLang,
              })}
              entries={placeholderEntries}
              onFocus={() => setSub({ kind: "state", stateIndex })}
              onText={(field, value) => {
                if (value === undefined) {
                  update(field, undefined);
                  return;
                }
                if (field === "title") updateTitle(value);
                else updateLore(value);
              }}
              onCount={(value) => update("count", value)}
              onAdvanced={(patch) =>
                setAppearanceAdvanced({ projectId, ...target, appearanceIndex: stateIndex, patch })
              }
            />
          )}

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
    </>
  );
}
