import { resolveDisplayRef } from "@/domain/capturedItems";
import { docKey } from "@/domain/documents";
import type { ElementId, Menu, ProjectId } from "@/domain/types";
import { useCssVar } from "@/lib/themeColors";
import { useEdgeHoverStore } from "@/state/edgeHoverStore";
import { useHoverStore } from "@/state/hoverStore";
import { usePaginationStore } from "@/state/paginationStore";
import { useProjectsStore } from "@/state/projectsStore";
import { isElementSelected, useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { useMemo } from "react";
import { Group, Rect } from "react-konva";
import { ImageButtonsRender } from "./ImageButtonsRender";
import { MenuBackground } from "./MenuBackground";
import { PaginationControls } from "./PaginationControls";
import { PlacementTray } from "./PlacementTray";
import { PreviewContextBanner } from "./PreviewContextBanner";
import { SlotDragGhosts } from "./SlotDragGhosts";
import { SlotItem } from "./SlotItem";
import { SystemTag } from "./SystemTag";
import {
  INHERITED_OPACITY,
  OriginTag,
  VariantTag,
  useOriginTag,
  useVariantStatus,
} from "./VariantTag";
import { dispatchOpenElement } from "./canvasEvents";
import { positionCount } from "./inventoryTypes";
import { type SlotEntry, fanoutElements } from "./menuFanout";
import {
  TEX_SCALE,
  TEX_SLOT_INNER,
  TEX_SLOT_INNER_OFFSET,
  menuBoxSize,
  slotXY,
} from "./menuLayout";
import { buildPreviewScope } from "./menuPreviewScope";
import { edgeTriggerPositions, resolveMenuSlots } from "./menuSlots";
import { TitleRender } from "./title/composer/TitleRender";
import { useMenuClick } from "./useMenuClick";
import { useMenuDrag } from "./useMenuDrag";
import { useMenuPreviewSnapshots } from "./useMenuPreviewSnapshots";
import { useNodeAlignment } from "./useNodeAlignment";
import { useSlotDrag } from "./useSlotDrag";
import { useSlotPointer } from "./useSlotPointer";

interface MenuGroupProps {
  projectId: ProjectId;
  menu: Menu;
  position: { x: number; y: number };
  /** Full project-canvas layout — needed by the slot drag-out handler to
   *  resolve which menu (if any) the cursor was over on dragend. */
  layout: Record<string, { x: number; y: number }>;
  /** Solo mode: render at origin, non-draggable, no menu-level drag/select
   *  handlers. Slot-level handlers (click-to-edit, library placement) remain
   *  active. Used by the individual-element view so it reuses this component
   *  without diverging. */
  solo?: boolean;
  /** The module whose system menu this is: tagged above the box. */
  systemModule?: string;
}

/**
 * MenuGroup is a Konva Group composing a vanilla-Minecraft chest GUI
 * representation: title bar + N-row chest slot grid + 4-row player inventory
 * (always visible, non-interactive). The default rendering uses the actual
 * `generic_54.png` vanilla texture, sliced into top + bottom pieces so the
 * chest height adapts to `menu.rows`. A custom uploaded background image
 * replaces BOTH slices and covers the full menu box.
 *
 * Slot interactivity (click-bubbles-up to select menu, drag-out to clear/move)
 * sits on Group overlays positioned at each chest slot's outer cell. The
 * texture itself draws the visual slot wells; we just overlay material text
 * + interaction targets.
 */
export function MenuGroup({
  projectId,
  menu,
  position,
  layout,
  solo = false,
  systemModule,
}: MenuGroupProps) {
  const key = docKey("menu", menu.id);
  const isSelected = useSelectionStore((s) => s.menuId === null && s.ids.has(key));
  const selectedIds = useSelectionStore((s) => s.ids);
  const selectionMenuId = useSelectionStore((s) => s.menuId);
  const focusedSlot = useSelectionStore((s) => s.focusedSlot);
  const hoveredEdge = useEdgeHoverStore((s) => s.edge);
  const brand = useCssVar("--brand");
  const borderStrong = useCssVar("--border-strong");
  const warning = useCssVar("--warning");
  const triggerPositions = useMemo(
    () => edgeTriggerPositions(hoveredEdge, menu.layers),
    [hoveredEdge, menu.layers],
  );

  // Placement tap-to-place: while a row is armed for THIS menu, every slot
  // (including empty ones) becomes a tap target that pins the row.
  const armedPlacement = useUiStore((s) => s.armedPlacement);
  const armedForThisMenu = armedPlacement?.menuId === menu.id;
  const { onSlotClick, onSlotTap } = useSlotPointer({
    projectId,
    menuId: menu.id,
    armedPlacement: armedForThisMenu ? armedPlacement : null,
  });

  const type = menu.inventoryType ?? "chest";
  const box = menuBoxSize(type, menu.rows);

  const { onMenuDragStart, onMenuDragEnd } = useMenuDrag({ projectId, nodeId: key, position });
  const nodeAlign = useNodeAlignment(projectId, key);

  const { onClick } = useMenuClick({ projectId, menu, layout });

  const { dragState, onSlotDragStart, onSlotDragMove, onSlotDragEnd } = useSlotDrag({
    projectId,
    menuId: menu.id,
    position,
    layout,
    menuLayers: menu.layers,
    inventoryType: type,
    menuRows: menu.rows,
  });

  // Fanout: Map<elementId, SlotEntry[]> — single source of truth for both
  // materialized and phantom (no-material) slots; O(1) per-element lookup.
  const fannedSlotsByElement = useMemo(() => {
    const map = new Map<string, SlotEntry[]>();
    for (const entry of fanoutElements(menu.layers)) {
      const key = entry.elementId as string;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(entry);
    }
    return map;
  }, [menu.layers]);

  // Active language + project ref so we can resolve `LText` refs (menu
  // title, appearance titles, lore lines) into the actually-displayed
  // string. Project ref is stable thanks to immer; the resolver reads
  // `project.i18nKeys[lt.key][activeLang]` with fallback to defaultLang.
  // For `iterates` elements, positions are unrolled against the preview
  // scope; each position i binds the i-th item with placeholder resolution.
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
  const snapshots = useMenuPreviewSnapshots(menu);
  // Build a preview scope from contextInputs — primitives are coerced to their
  // declared type; sourceRefs resolve against a live snapshot (server sources)
  // with project.dataSources as the project-data path.
  const previewArgs = useUiStore((s) => s.menuPreviewArgs[menu.id]);
  const sampleCtx = project ? buildPreviewScope(menu, project, snapshots, previewArgs) : {};
  const activeLang = useUiStore((s) => s.activeLang);
  // Per-element page index for iteration overflow. Shared via
  // paginationStore so the ItemTooltip (which renders outside MenuGroup)
  // can resolve placeholders against the right item on hover.
  const pageByElement = usePaginationStore((s) => s.pageByElement);
  const setPage = usePaginationStore((s) => s.setPage);
  const { elementsByPosition, overflowing } = resolveMenuSlots({
    menu,
    project,
    sampleCtx,
    activeLang,
    pageByElement,
    fannedSlotsByElement,
  });

  const total = positionCount(type, menu.rows, menu.playerInventory);
  const variantStatus = useVariantStatus(projectId, "menu", menu.id);
  const originTag = useOriginTag(projectId, "menu", menu.id);

  return (
    <Group
      x={solo ? 0 : position.x}
      y={solo ? 0 : position.y}
      draggable={!solo}
      onDragStart={solo ? undefined : onMenuDragStart}
      onDragMove={solo ? undefined : nodeAlign.onDragMove}
      onDragEnd={solo ? undefined : onMenuDragEnd}
      // Selection stays active in solo too: otherwise a click on an element locked
      // the view — nothing let the menu be selected again. Slot clicks set
      // cancelBubble, so only the background bubbles up here.
      onClick={onClick}
      onTap={onClick}
      onDblClick={solo ? undefined : () => dispatchOpenElement(key)}
      onDblTap={solo ? undefined : () => dispatchOpenElement(key)}
      name={`menu:${menu.id}`}
      id={key}
      opacity={variantStatus === "inherited" ? INHERITED_OPACITY : 1}
    >
      <MenuBackground menu={menu} />
      {systemModule && !solo && <SystemTag module={systemModule} width={box.width} />}
      {originTag && !solo && (
        <OriginTag status={originTag} width={box.width} y={systemModule ? -28 : -14} />
      )}
      {variantStatus && !solo && (
        <VariantTag
          projectId={projectId}
          status={variantStatus}
          width={box.width}
          y={systemModule ? -28 : -14}
        />
      )}
      {/* Selection halo */}
      {isSelected ? (
        <Rect
          width={box.width}
          height={box.height}
          stroke={brand}
          strokeWidth={2}
          listening={false}
          perfectDrawEnabled={false}
        />
      ) : null}
      {/* Edge-hover halo: gold border when this menu is the source of the hovered edge */}
      {hoveredEdge?.source === key ? (
        <Rect
          width={box.width}
          height={box.height}
          stroke={warning}
          strokeWidth={2}
          listening={false}
          perfectDrawEnabled={false}
        />
      ) : null}
      {/* Title bar — TitleRender draws all title layers (background + glyphs +
          text) faithfully, matching what the plugin emits in-game. Clicks on
          layers select them, clicks on the grey backdrop set this menu as the
          selected one (and clear any layer selection belonging to this menu). */}
      <TitleRender projectId={projectId} menuId={menu.id} scale={TEX_SCALE} />
      <ImageButtonsRender projectId={projectId} menu={menu} />
      <PlacementTray
        menu={menu}
        project={project}
        scope={sampleCtx}
        boxWidth={box.width}
        boxHeight={box.height}
      />
      {/* Slot interaction overlays */}
      {Array.from({ length: total }, (_, i) => {
        const { x, y } = slotXY(i, type, menu.rows);
        const el = elementsByPosition.get(i);
        if (el?.image) return null;
        const present = Boolean(el);
        const filled = Boolean(el?.material);
        const innerX = TEX_SLOT_INNER_OFFSET;
        const innerY = TEX_SLOT_INNER_OFFSET;
        const elementSelected = Boolean(
          el?.elementId && isElementSelected(selectedIds, selectionMenuId, el.elementId, menu.id),
        );
        const isFocusedSlot = elementSelected && focusedSlot === i;
        const isButtonMode = elementSelected && focusedSlot === null;
        const isEdgeTrigger = Boolean(triggerPositions?.has(i));
        // During selection drag, hide the SlotItem at the source's "sibling"
        // positions so the user only sees the offset ghost, not a stale copy
        // pinned at the original spot.
        const isSelectionSibling =
          dragState?.kind === "selection" &&
          i !== dragState.sourcePosition &&
          dragState.siblings.some((s) => s.position === i);
        return (
          <Group
            // biome-ignore lint/suspicious/noArrayIndexKey: slot position is the stable identifier
            key={i}
            x={x}
            y={y}
            name={`slot:${menu.id}:${i}`}
            listening={present || armedForThisMenu}
            draggable={filled}
            onDragStart={
              filled && el?.elementId
                ? (e) => onSlotDragStart(e, i, el.elementId as ElementId)
                : undefined
            }
            onDragMove={filled ? onSlotDragMove : undefined}
            onClick={present || armedForThisMenu ? (e) => onSlotClick(e, i, el) : undefined}
            onTap={present || armedForThisMenu ? (e) => onSlotTap(e, i, el) : undefined}
            onMouseEnter={
              present
                ? () => {
                    if (el?.elementId)
                      useHoverStore.getState().setElement(el.elementId as ElementId, i, menu.id);
                  }
                : undefined
            }
            onMouseLeave={
              present ? () => useHoverStore.getState().setElement(null, null) : undefined
            }
            onDragEnd={
              filled && el?.elementId
                ? (e) => onSlotDragEnd(e, i, el.elementId as ElementId)
                : undefined
            }
          >
            {filled && !isSelectionSibling
              ? (() => {
                  // `item:<id>` refs expand to the captured display (custom
                  // material / head texture); other refs pass through.
                  const d = project
                    ? resolveDisplayRef(project, el?.material ?? "")
                    : { material: el?.material ?? "" };
                  return (
                    <SlotItem
                      material={d.material}
                      head={el?.head ?? d.head}
                      innerX={innerX}
                      innerY={innerY}
                      count={el?.count}
                      enchanted={el?.enchanted || d.enchanted}
                    />
                  );
                })()
              : null}
            {present && !filled && !isSelectionSibling ? (
              <>
                {/* Transparent hit area so the group receives pointer events */}
                <Rect
                  x={innerX}
                  y={innerY}
                  width={TEX_SLOT_INNER}
                  height={TEX_SLOT_INNER}
                  fill="rgba(0,0,0,0.001)"
                  listening={true}
                  perfectDrawEnabled={false}
                />
                <Rect
                  x={innerX}
                  y={innerY}
                  width={TEX_SLOT_INNER}
                  height={TEX_SLOT_INNER}
                  stroke="rgba(255,255,255,0.45)"
                  strokeWidth={1.5}
                  dash={[3, 3]}
                  cornerRadius={2}
                  fill="transparent"
                  listening={false}
                  perfectDrawEnabled={false}
                />
              </>
            ) : null}
            {/* Armed placement: empty slots become tap targets, highlighted so
                the user sees where the armed row will land. */}
            {armedForThisMenu && !present ? (
              <>
                <Rect
                  x={innerX}
                  y={innerY}
                  width={TEX_SLOT_INNER}
                  height={TEX_SLOT_INNER}
                  fill="rgba(0,0,0,0.001)"
                  listening={true}
                  perfectDrawEnabled={false}
                />
                <Rect
                  x={innerX}
                  y={innerY}
                  width={TEX_SLOT_INNER}
                  height={TEX_SLOT_INNER}
                  stroke={brand}
                  strokeWidth={1.5}
                  dash={[3, 3]}
                  cornerRadius={2}
                  fill="transparent"
                  listening={false}
                  perfectDrawEnabled={false}
                />
              </>
            ) : null}
            {/* Selection outlines:
                  - button mode: every position outlined in solid blue
                  - instance mode: focused slot in emerald, siblings in blue
                    (so the user always sees the rest of the button) */}
            {elementSelected ? (
              <Rect
                x={innerX - 1}
                y={innerY - 1}
                width={TEX_SLOT_INNER + 2}
                height={TEX_SLOT_INNER + 2}
                stroke={isFocusedSlot ? brand : borderStrong}
                strokeWidth={isFocusedSlot || isButtonMode ? 2 : 1.5}
                listening={false}
                perfectDrawEnabled={false}
              />
            ) : null}
            {isEdgeTrigger ? (
              <Rect
                x={innerX - 2}
                y={innerY - 2}
                width={TEX_SLOT_INNER + 4}
                height={TEX_SLOT_INNER + 4}
                stroke={warning}
                strokeWidth={2}
                listening={false}
                perfectDrawEnabled={false}
              />
            ) : null}
          </Group>
        );
      })}
      <SlotDragGhosts
        dragState={dragState}
        elementsByPosition={elementsByPosition}
        inventoryType={type}
        rows={menu.rows}
      />
      {/* Pagination preview controls — one row per iterating element with
          overflow. Stacked below the menu's bottom edge so the menu's
          texture stays clean. Editor-only; not part of the runtime menu. */}
      {overflowing.map((info, ix) => (
        <PaginationControls
          key={info.elementId}
          y={box.height + 6 + ix * 22}
          width={box.width}
          page={info.page}
          totalPages={info.totalPages}
          onPrev={() => setPage(info.elementId, Math.max(0, info.page - 1))}
          onNext={() => setPage(info.elementId, Math.min(info.totalPages - 1, info.page + 1))}
        />
      ))}
      {/* LAST child on purpose: its dropdown opens over the top of the menu,
          and in Konva render order IS click priority. Rendered before the
          slots, its first lines were covered by them — the click went through
          and selected the element below instead of picking the context. */}
      <PreviewContextBanner
        menu={menu}
        project={project}
        width={box.width}
        previewArgs={previewArgs}
      />
    </Group>
  );
}
