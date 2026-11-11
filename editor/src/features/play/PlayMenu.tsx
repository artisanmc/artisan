import { McTooltip } from "@/components/mc-preview";
import type { Menu, Project } from "@/domain/types";
import { MenuBackground } from "@/features/canvas/MenuBackground";
import { SlotItem } from "@/features/canvas/SlotItem";
import { positionCount } from "@/features/canvas/inventoryTypes";
import {
  TEX_SCALE,
  TEX_SLOT_INNER,
  TEX_SLOT_INNER_OFFSET,
  menuBoxSize,
  slotXY,
} from "@/features/canvas/menuLayout";
import { TitleRender } from "@/features/canvas/title/composer/TitleRender";
import type { Style } from "@/lib/miniMessage";
import { ITEM_NAME } from "@/lib/mm/profiles";
import { type McScreenGeometry, centeredScreen } from "@artisan/editor-sdk";
import { useMemo, useState } from "react";
import { Group, Layer, Rect, Stage } from "react-konva";
import { clickSteps, clickTypeOf, playMenuSlots } from "./engine/menuSlots";
import type { OpenMenu, PlaySession } from "./engine/session";

const MATERIAL_NAME: Style = { color: "#ffffff", italic: false };

/**
 * The open menu inside `McScreen`: the canvas' own pieces (background, title, item icons)
 * at the GUI scale, centred as the game centres a container. Slots show their state for
 * the test player; a click runs that click type's chain in the session, and hovering
 * shows the tooltip next to the cursor.
 */
export function PlayMenu({
  project,
  menu,
  open,
  session,
  lang,
  geometry: { layout, scale },
}: {
  project: Project;
  menu: Menu;
  open: OpenMenu;
  session: PlaySession;
  lang: string;
  geometry: McScreenGeometry;
}) {
  const type = menu.inventoryType ?? "chest";
  const box = menuBoxSize(type, menu.rows);
  const rect = centeredScreen(layout, box.width / TEX_SCALE, box.height / TEX_SCALE);
  const k = scale / TEX_SCALE;
  const scope = useMemo(() => session.menuScope(menu, open), [session, menu, open]);
  const slots = useMemo(
    () =>
      playMenuSlots({
        menu,
        project,
        scope,
        pages: open.pages,
        lang,
        env: (s) => session.env(s, project),
        render: (template, s) => session.render(template, s, project),
      }),
    [menu, project, scope, open.pages, lang, session],
  );
  const [hover, setHover] = useState<{ position: number; x: number; y: number } | null>(null);
  const hovered = hover ? slots.get(hover.position) : undefined;
  const total = positionCount(type, menu.rows, menu.playerInventory);

  return (
    <div
      data-testid="play-menu"
      data-menu={menu.id}
      style={{ position: "absolute", left: rect.x * scale, top: rect.y * scale }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Stage width={box.width * k} height={box.height * k} scaleX={k} scaleY={k}>
        <Layer>
          <MenuBackground menu={menu} />
          <Group listening={false}>
            <TitleRender
              projectId={project.id}
              menuId={menu.id}
              scale={TEX_SCALE}
              project={project}
            />
          </Group>
          {Array.from({ length: total }, (_, i) => {
            const slot = slots.get(i);
            const { x, y } = slotXY(i, type, menu.rows);
            return (
              <Group
                // biome-ignore lint/suspicious/noArrayIndexKey: the position is the slot's identity
                key={i}
                x={x}
                y={y}
                onMouseEnter={(e) => {
                  const p = e.target.getStage()?.getPointerPosition();
                  setHover({ position: i, x: p?.x ?? 0, y: p?.y ?? 0 });
                }}
                onMouseMove={(e) => {
                  const p = e.target.getStage()?.getPointerPosition();
                  if (p) setHover({ position: i, x: p.x, y: p.y });
                }}
                onMouseLeave={() => setHover(null)}
                onMouseUp={(e) => {
                  if (!slot) return;
                  const click = clickTypeOf(e.evt.button, e.evt.shiftKey);
                  const steps = clickSteps(slot.appearance, click);
                  if (steps) session.clickSlot(slot.element, steps, i, click, slot.scope);
                }}
              >
                {/* Hit shape: the slot reacts even when empty, as in game. */}
                <Rect
                  x={TEX_SLOT_INNER_OFFSET}
                  y={TEX_SLOT_INNER_OFFSET}
                  width={TEX_SLOT_INNER}
                  height={TEX_SLOT_INNER}
                  fill="rgba(0,0,0,0.001)"
                />
                {slot?.material ? (
                  <Group listening={false}>
                    <SlotItem
                      material={slot.material}
                      head={slot.head}
                      innerX={TEX_SLOT_INNER_OFFSET}
                      innerY={TEX_SLOT_INNER_OFFSET}
                      count={slot.count}
                      enchanted={slot.enchanted}
                    />
                  </Group>
                ) : null}
                {/* The game's hover highlight, white at half opacity over the item. */}
                {hover?.position === i ? (
                  <Rect
                    x={TEX_SLOT_INNER_OFFSET}
                    y={TEX_SLOT_INNER_OFFSET}
                    width={TEX_SLOT_INNER}
                    height={TEX_SLOT_INNER}
                    fill="rgba(255,255,255,0.5)"
                    listening={false}
                  />
                ) : null}
              </Group>
            );
          })}
        </Layer>
      </Stage>
      {hovered && hover ? (
        <div
          data-testid="play-menu-tooltip"
          className="pointer-events-none"
          style={{ position: "absolute", left: hover.x + 12 * scale, top: hover.y - 12 * scale }}
        >
          <McTooltip
            title={hovered.title}
            titleDefaults={hovered.materialTitle ? MATERIAL_NAME : ITEM_NAME.defaults}
            enchants={hovered.enchants}
            lore={hovered.lore}
            maxWidth={project.loreMaxWidth}
            scale={scale}
          />
        </div>
      ) : null}
    </div>
  );
}
