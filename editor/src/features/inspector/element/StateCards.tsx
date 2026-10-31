import { RevealField } from "@/components/RevealField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LocalizedField } from "@/components/ui/localized-field";
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
import { ItemEditor, type ItemTranslations } from "@/features/canvas/ItemEditor";
import { MaterialPicker } from "@/features/canvas/MaterialPicker";
import { droppableProps } from "@/features/canvas/dragPayload";
import { ItemBindingEditor } from "@/features/canvas/item/ItemBindingEditor";
import { previewItem } from "@/features/canvas/itemValuePreview";
import { buildPreviewScope } from "@/features/canvas/menuPreviewScope";
import { useTextureUrl } from "@/features/canvas/textureStore";
import { useHeadPreviewUrl } from "@/features/canvas/useHeadPreviewUrl";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { listLanguages } from "@/lib/i18nUsages";
import { lookupPath } from "@/lib/placeholders";
import { useGetText } from "@/lib/useText";
import { useFlowSelectionStore } from "@/state/flowSelectionStore";
import { useProjectsStore } from "@/state/projectsStore";
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
import { ElementClickHandlers } from "../chain/ElementClickHandlers";
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
  const moveAppearance = useProjectsStore((s) => s.moveAppearance);
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
  const droppable = useDroppable(
    droppableProps({ kind: "stateMaterial", menuId, elementId, stateIndex }),
  );
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
              <span className="text-[9.5px] text-[var(--text-faint)]">
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
  const setAppearanceField = useProjectsStore((s) => s.setAppearanceField);
  const setAppearanceAdvanced = useProjectsStore((s) => s.setAppearanceAdvanced);
  const setAppearanceTitle = useProjectsStore((s) => s.setAppearanceTitle);
  const setAppearanceLore = useProjectsStore((s) => s.setAppearanceLore);
  const setAppearanceConditions = useProjectsStore((s) => s.setAppearanceConditions);
  const setAppearanceJoin = useProjectsStore((s) => s.setAppearanceJoin);
  const removeAppearance = useProjectsStore((s) => s.removeAppearance);
  const activeLang = useUiStore((s) => s.activeLang);
  const getText = useGetText(projectId);
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
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

  // The item dialog edits each language's own text: a missing one shows the default
  // language's as a placeholder, never as a value a keystroke would copy.
  const ownText = (lt: { key: I18nKey } | null | undefined, lang: string) =>
    lt && project ? project.i18nKeys[lt.key]?.[lang] : undefined;
  const langs = project ? listLanguages(project) : [];
  const translations: ItemTranslations | undefined = project
    ? {
        langs,
        activeLang,
        defaultLang: project.defaultLang,
        title: Object.fromEntries(langs.map((lang) => [lang, ownText(appearance.title, lang)])),
        lore: Object.fromEntries(langs.map((lang) => [lang, ownText(appearance.lore, lang)])),
        onText: (field, lang, value) =>
          (field === "title" ? setAppearanceTitle : setAppearanceLore)({
            projectId,
            ...target,
            appearanceIndex: stateIndex,
            lang,
            value,
          }),
      }
    : undefined;

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
              <span className="text-[9.5px] text-[var(--text-faint)]">
                {material.slice(0, 3) || "—"}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="field-label !mb-0">
              {isDefault ? t("flow.stateDefault") : t("flow.stateN", { index: stateIndex })}
            </div>
            {conditionText ? (
              <div
                title={conditionText}
                className="truncate font-mono text-[11px] text-[var(--brand)]"
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
                    className="block truncate font-mono text-[11px] text-[var(--text-mut)]"
                  />
                ))
              : null}
            {lore.length > 2 ? (
              <div className="font-mono text-[11px] text-[var(--text-faint)]">
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
            <span className="field-label !mb-0">
              {isDefault ? t("flow.stateDefault") : t("flow.stateN", { index: stateIndex })}
            </span>
            <span className="rounded bg-[var(--brand-soft)] px-1.5 py-0.5 text-[10px] text-[var(--brand)] uppercase">
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
              useProjectsStore.getState().setAppearanceImage({
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
              useProjectsStore.getState().setElementPositions({ projectId, ...target, positions })
            }
          >
            {translations && (
              <LocalizedField
                label={t("flow.titleName")}
                langs={translations.langs}
                activeLang={translations.activeLang}
                defaultLang={translations.defaultLang}
                values={translations.title}
                onChange={(lang, value) => translations.onText("title", lang, value)}
                renderEditor={({ value, fallback, label, onChange }) => (
                  <RevealField
                    value={value}
                    onChange={onChange}
                    aria-label={label}
                    entries={placeholderEntries}
                    placeholder={fallback}
                    className="input w-full"
                    facade={
                      <MiniMessageInline
                        source={value || fallback || t("flow.titlePlaceholder")}
                        className={value ? undefined : "opacity-50"}
                      />
                    }
                  />
                )}
              />
            )}
            {translations && (
              <LocalizedField
                label={t("flow.loreName")}
                langs={translations.langs}
                activeLang={translations.activeLang}
                defaultLang={translations.defaultLang}
                values={translations.lore}
                onChange={(lang, value) => translations.onText("lore", lang, value)}
                renderEditor={({ value, fallback, label, onChange }) => (
                  <RevealField
                    value={value}
                    onChange={onChange}
                    aria-label={label}
                    entries={placeholderEntries}
                    multiline
                    placeholder={fallback}
                    className="input w-full"
                    facade={
                      <MiniMessageInline
                        source={value || fallback || t("flow.lorePlaceholder")}
                        className={value ? undefined : "opacity-50"}
                      />
                    }
                  />
                )}
              />
            )}
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
              previewScope={lorePreviewCtx}
              previewFor={(ctx) => previewItem(appearance, ctx, project, activeLang)}
              title={appearance.title ? (ownText(appearance.title, activeLang) ?? "") : undefined}
              lore={appearance.lore ? (ownText(appearance.lore, activeLang) ?? "") : undefined}
              translations={translations}
              loreMode={appearance.loreMode}
              onLoreMode={(mode) => update("loreMode", mode)}
              titleLabel={t("flow.titleName")}
              loreLabel={t("flow.loreName")}
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
            <ElementClickHandlers
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
