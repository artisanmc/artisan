import { getFirstTitleText } from "@/domain/menuTitle";
import type { Menu, Project, ProjectId } from "@/domain/types";
import { getText } from "@/lib/i18n";
import { useCssVar } from "@/lib/themeColors";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { Group, Rect, Text } from "react-konva";
import { menuBoxSize } from "./menuLayout";

/**
 * En dessous de cette échelle, un inventaire n'est plus lisible (ni ses slots,
 * ni son titre) : la planche montre une carte légère à la place.
 */
export const MENU_CARD_MAX_SCALE = 0.45;

/** Taille du titre à l'écran, quelle que soit l'échelle de la planche. */
const SCREEN_FONT_PX = 15;

/**
 * Un menu vu de loin : son cadre et son titre, lisibles à l'écran. Un clic le
 * sélectionne et centre la planche dessus, ce qui ramène à l'inventaire complet.
 */
export function MenuCard({
  projectId,
  project,
  menu,
  position,
  scale,
}: {
  projectId: ProjectId;
  project: Project;
  menu: Menu;
  position: { x: number; y: number };
  scale: number;
}) {
  const activeLang = useUiStore((s) => s.activeLang);
  const selected = useSelectionStore((s) => s.ids.has(menu.id as never));
  const surface = useCssVar("--surface-raised");
  const border = useCssVar("--border-strong");
  const brand = useCssVar("--brand");
  const text = useCssVar("--text");
  const { width, height } = menuBoxSize(menu.inventoryType ?? "chest", menu.rows);
  const title = getFirstTitleText(menu);
  const label = (title ? getText(project, title, activeLang) : "") || menu.id;
  const fontSize = SCREEN_FONT_PX / Math.max(scale, 0.05);
  const open = () => {
    useSelectionStore.getState().set([menu.id as never]);
    useUiStore.getState().requestCenter(projectId, menu.id);
  };
  return (
    <Group name={`menu-card:${menu.id}`} x={position.x} y={position.y} onClick={open} onTap={open}>
      <Rect
        width={width}
        height={height}
        fill={surface}
        stroke={selected ? brand : border}
        strokeWidth={(selected ? 3 : 1.5) / Math.max(scale, 0.05)}
        cornerRadius={8}
      />
      <Text
        x={fontSize * 0.6}
        y={fontSize * 0.6}
        width={Math.max(0, width - fontSize * 1.2)}
        text={label.replace(/<[^>]*>/g, "")}
        fontSize={fontSize}
        fontStyle="bold"
        fill={text}
        ellipsis
        wrap="none"
        listening={false}
      />
    </Group>
  );
}
