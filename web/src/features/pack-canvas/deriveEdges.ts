import type { Pack } from "@/domain/types";
import type { Edge } from "@xyflow/react";

export function deriveEdges(pack: Pack): Edge[] {
  const edges: Edge[] = [];
  const seen = new Set<string>();

  const push = (source: string, target: string) => {
    const id = `${source}->${target}`;
    if (seen.has(id)) return;
    seen.add(id);
    edges.push({ id, source, target, animated: false });
  };

  for (const menu of pack.menus) {
    for (const layer of menu.layers) {
      for (const el of layer.elements) {
        for (const appearance of el.appearances) {
          if (!appearance.click) continue;
          for (const handler of Object.values(appearance.click)) {
            if (!handler) continue;
            for (const action of [...handler.actions, ...(handler.fallback ?? [])]) {
              if (action.type === "open_menu") push(menu.id, action.menuId);
            }
          }
        }
      }
    }
  }

  for (const cmd of pack.commands) {
    for (const action of cmd.actions) {
      if (action.type === "open_menu") push(cmd.id, action.menuId);
    }
  }

  return edges;
}
