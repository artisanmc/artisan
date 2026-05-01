import type { Menu, MenuId, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useEditingStore } from "@/state/editingStore";
import { useSelectionStore } from "@/state/selectionStore";
import type Konva from "konva";
import { useCallback } from "react";
import { Group, Image as KonvaImage, Rect, Text } from "react-konva";
import { toast } from "sonner";
import useImage from "use-image";
import { MiniMessageKonvaText } from "./MiniMessageKonvaText";
import { hitTestSlot } from "./hitTest";
import { itemTextureUrl } from "./itemTextures";
import {
  COLS,
  TEX_FIRST_SLOT_X,
  TEX_SCALE,
  TEX_SLOT_INNER,
  TEX_SLOT_INNER_OFFSET,
  TEX_SLOT_STRIDE,
  TEX_URL,
  bottomPieceCrop,
  bottomPieceY,
  menuBoxSize,
  slotXY,
  topPieceCrop,
} from "./menuLayout";

interface SlotItemProps {
  material: string;
  innerX: number;
  innerY: number;
}

/**
 * Renders the visual content of a filled slot — vanilla MC item texture if
 * we have it bundled (most cases), or a small fallback Rect with the first 4
 * letters of the material name otherwise. The Rect is the slot Group's hit
 * shape; the Image draws on top of it so click/drag still register.
 */
function SlotItem({ material, innerX, innerY }: SlotItemProps) {
  const url = itemTextureUrl(material);
  const [image] = useImage(url ?? "");
  return (
    <>
      {/* Backdrop Rect — also acts as the slot Group's hit shape. */}
      <Rect
        x={innerX}
        y={innerY}
        width={TEX_SLOT_INNER}
        height={TEX_SLOT_INNER}
        fill={url ? "transparent" : "rgba(20,20,20,0.55)"}
        cornerRadius={2}
        perfectDrawEnabled={false}
      />
      {url && image ? (
        <KonvaImage
          image={image}
          x={innerX}
          y={innerY}
          width={TEX_SLOT_INNER}
          height={TEX_SLOT_INNER}
          listening={false}
          perfectDrawEnabled={false}
        />
      ) : (
        <Text
          x={innerX}
          y={innerY}
          width={TEX_SLOT_INNER}
          height={TEX_SLOT_INNER}
          text={material.slice(0, 4)}
          fontFamily="ui-monospace, monospace"
          fontSize={6 * TEX_SCALE}
          fill="#fafafa"
          align="center"
          verticalAlign="middle"
          listening={false}
        />
      )}
    </>
  );
}

interface MenuGroupProps {
  packId: PackId;
  menu: Menu;
  position: { x: number; y: number };
  /** Full pack-canvas layout — needed by the slot drag-out handler to
   *  resolve which menu (if any) the cursor was over on dragend. */
  layout: Record<string, { x: number; y: number }>;
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
export function MenuGroup({ packId, menu, position, layout }: MenuGroupProps) {
  const setCanvasPosition = useAccountStore((s) => s.setCanvasPosition);
  const isSelected = useSelectionStore((s) => s.ids.has(menu.id));
  const customBgUrl = useAccountStore((s) => {
    if (!menu.background) return undefined;
    const pack = s.account.packs.find((p) => p.id === packId);
    return pack?.assets.find((a) => a.id === menu.background!.assetId)?.url;
  });
  const [vanillaTex] = useImage(TEX_URL);
  const [customTex] = useImage(customBgUrl ?? "");
  const usingCustom = Boolean(customBgUrl);

  const box = menuBoxSize(menu.rows);

  const onMenuDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    e.target.moveToTop();
  }, []);

  const onDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const sourceEvent = e.evt;
      const cx = sourceEvent.clientX;
      const cy = sourceEvent.clientY;
      const minis = document.querySelectorAll<HTMLElement>("[data-pack-mini='true']");
      for (const m of minis) {
        const rect = m.getBoundingClientRect();
        if (cx < rect.left || cx > rect.right || cy < rect.top || cy > rect.bottom) continue;
        const targetPackId = m.getAttribute("data-pack-id") as PackId | null;
        if (!targetPackId || targetPackId === packId) continue;
        e.target.position({ x: position.x, y: position.y });
        try {
          useAccountStore
            .getState()
            .moveMenuToPack({ menuId: menu.id, fromPackId: packId, toPackId: targetPackId });
          toast.success(`Moved ${menu.id} to ${targetPackId}`);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "move failed");
        }
        return;
      }
      setCanvasPosition({ packId, nodeId: menu.id, x: e.target.x(), y: e.target.y() });
    },
    [packId, menu.id, position.x, position.y, setCanvasPosition],
  );

  const onClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
      const additive = "evt" in e && (e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey);
      const { ids, set, toggle } = useSelectionStore.getState();
      if (additive) toggle(menu.id);
      else if (!ids.has(menu.id) || ids.size > 1) set([menu.id]);
    },
    [menu.id],
  );

  const onDblClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
      useEditingStore.getState().setEditing(menu.id);
    },
    [menu.id],
  );

  const onSlotDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    e.target.getParent()?.moveToTop();
    e.target.moveToTop();
  }, []);

  const onSlotDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>, srcPosition: number, material: string) => {
      e.cancelBubble = true;
      const node = e.target;
      const localX = node.x();
      const localY = node.y();
      const original = slotXY(srcPosition);
      node.position({ x: original.x, y: original.y });

      const worldX = position.x + localX + TEX_SLOT_STRIDE / 2;
      const worldY = position.y + localY + TEX_SLOT_STRIDE / 2;
      const account = useAccountStore.getState().account;
      const pack = account.packs.find((p) => p.id === packId);
      if (!pack) return;
      const hit = hitTestSlot(pack, layout, worldX, worldY);

      if (hit && hit.menuId === menu.id && hit.position === srcPosition) return;

      try {
        if (!hit) {
          useAccountStore.getState().clearSlot({
            packId,
            menuId: menu.id,
            position: srcPosition,
          });
        } else {
          useAccountStore.getState().setSlotMaterial({
            packId,
            menuId: hit.menuId as MenuId,
            position: hit.position,
            material,
          });
          useAccountStore.getState().clearSlot({
            packId,
            menuId: menu.id,
            position: srcPosition,
          });
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "slot drag failed");
      }
    },
    [packId, menu.id, position.x, position.y, layout],
  );

  const elementsByPosition = new Map<
    string,
    { material?: string; title?: string; elementId: string }
  >();
  for (const layer of menu.layers) {
    for (const el of layer.elements) {
      const appearance = el.appearances[0];
      if (!appearance) continue;
      elementsByPosition.set(el.positions, {
        material: appearance.material,
        title: appearance.title,
        elementId: el.id,
      });
    }
  }

  const slotCount = menu.rows * COLS;
  const top = topPieceCrop(menu.rows);
  const bottom = bottomPieceCrop();
  const bottomY = bottomPieceY(menu.rows);

  return (
    <Group
      x={position.x}
      y={position.y}
      draggable
      onDragStart={onMenuDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onTap={onClick}
      onDblClick={onDblClick}
      onDblTap={onDblClick}
      name={`menu:${menu.id}`}
      id={menu.id}
    >
      {/* Background. Custom upload covers the full menu box; vanilla mode
          renders two slices so the chest height adapts to `rows`.
          Images are listening=true so the menu Group has a hit shape and
          drag works from anywhere on the texture (Konva picks the deepest
          draggable, so filled slots still take precedence). */}
      {usingCustom && customTex ? (
        <KonvaImage
          image={customTex}
          x={0}
          y={0}
          width={box.width}
          height={box.height}
          perfectDrawEnabled={false}
        />
      ) : vanillaTex ? (
        <>
          <KonvaImage
            image={vanillaTex}
            x={0}
            y={0}
            width={top.width * TEX_SCALE}
            height={top.height * TEX_SCALE}
            crop={top}
            perfectDrawEnabled={false}
          />
          <KonvaImage
            image={vanillaTex}
            x={0}
            y={bottomY}
            width={bottom.width * TEX_SCALE}
            height={bottom.height * TEX_SCALE}
            crop={bottom}
            perfectDrawEnabled={false}
          />
        </>
      ) : (
        <Rect width={box.width} height={box.height} fill="#c6c6c6" perfectDrawEnabled={false} />
      )}
      {/* Selection halo */}
      {isSelected ? (
        <Rect
          width={box.width}
          height={box.height}
          stroke="#22c55e"
          strokeWidth={2}
          listening={false}
          perfectDrawEnabled={false}
        />
      ) : null}
      {/* Title text in the texture's title bar — MiniMessage-aware so e.g.
          "<gold>Profil</gold>" actually renders gold. */}
      <MiniMessageKonvaText
        source={menu.title}
        x={TEX_FIRST_SLOT_X + 1}
        y={5 * TEX_SCALE}
        fontSize={7 * TEX_SCALE}
        defaultColor="#404040"
      />
      {/* Slot interaction overlays */}
      {Array.from({ length: slotCount }, (_, i) => {
        const { x, y } = slotXY(i);
        const el = elementsByPosition.get(String(i));
        const filled = Boolean(el?.material);
        const innerX = TEX_SLOT_INNER_OFFSET;
        const innerY = TEX_SLOT_INNER_OFFSET;
        return (
          <Group
            // biome-ignore lint/suspicious/noArrayIndexKey: slot position is the stable identifier
            key={i}
            x={x}
            y={y}
            name={`slot:${menu.id}:${i}`}
            id={el?.elementId}
            listening={filled}
            draggable={filled}
            onDragStart={filled ? onSlotDragStart : undefined}
            onClick={
              filled
                ? (e) => {
                    e.cancelBubble = true;
                    if (el?.elementId) useSelectionStore.getState().set([el.elementId]);
                  }
                : undefined
            }
            onTap={
              filled
                ? (e) => {
                    e.cancelBubble = true;
                    if (el?.elementId) useSelectionStore.getState().set([el.elementId]);
                  }
                : undefined
            }
            onDragEnd={
              filled && el?.material ? (e) => onSlotDragEnd(e, i, el.material!) : undefined
            }
          >
            {filled ? (
              <SlotItem material={el?.material ?? ""} innerX={innerX} innerY={innerY} />
            ) : null}
          </Group>
        );
      })}
    </Group>
  );
}
