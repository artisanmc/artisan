import { projectBoard } from "@/features/canvas/autoLayout";
import { menuBoxSize } from "@/features/canvas/menuLayout";
import type { Project } from "@/domain/types";
import type { Box } from "./drive";

/** Boîte d'un menu sur la planche, telle que le Stage la dispose. */
export function menuBox(project: Project, menuId: string): Box {
  const menu = project.menus.find((m) => m.id === menuId);
  const at = projectBoard(project).layout[menuId];
  if (!menu || !at) throw new Error(`menu ${menuId} absent de la planche`);
  return { ...at, ...menuBoxSize("chest", menu.rows) };
}

/** Boîte qui englobe plusieurs menus. */
export function unionBox(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
}

/** Copie du projet où le menu `menuId` ne garde, dans `layerId`, que les éléments listés. */
export function withElements(project: Project, menuId: string, layerId: string, keep: string[]): Project {
  return {
    ...project,
    menus: project.menus.map((m) =>
      m.id !== menuId
        ? m
        : {
            ...m,
            layers: m.layers.map((l) =>
              l.id !== layerId ? l : { ...l, elements: l.elements.filter((e) => keep.includes(e.id)) },
            ),
          },
    ),
  };
}
