import { walkActions } from "@/domain/stepPath";
import type { Pack } from "@/domain/types";

export type EdgeTrigger =
  | { kind: "element"; elementId: string; material: string; clickType: string }
  | { kind: "command"; commandId: string };

export interface Edge {
  id: string;
  source: string;
  target: string;
  triggers: EdgeTrigger[];
}

export function deriveEdges(pack: Pack): Edge[] {
  const edgeMap = new Map<string, Edge>();
  const triggerSeen = new Map<string, Set<string>>();

  const addTrigger = (source: string, target: string, trigger: EdgeTrigger) => {
    const id = `${source}->${target}`;
    const triggerKey =
      trigger.kind === "element"
        ? `el:${trigger.elementId}:${trigger.clickType}`
        : `cmd:${trigger.commandId}`;

    let edge = edgeMap.get(id);
    if (!edge) {
      edge = { id, source, target, triggers: [] };
      edgeMap.set(id, edge);
      triggerSeen.set(id, new Set());
    }
    const seen = triggerSeen.get(id)!;
    if (!seen.has(triggerKey)) {
      seen.add(triggerKey);
      edge.triggers.push(trigger);
    }
  };

  for (const menu of pack.menus) {
    for (const layer of menu.layers) {
      for (const el of layer.elements) {
        for (const appearance of el.appearances) {
          if (!appearance.click) continue;
          const material = appearance.material ?? el.appearances[0]?.material ?? "";
          for (const [clickType, handler] of Object.entries(appearance.click)) {
            if (!handler) continue;
            for (const action of walkActions(handler.steps)) {
              if (action.type === "open_menu") {
                addTrigger(menu.id, action.menuId, {
                  kind: "element",
                  elementId: el.id,
                  material,
                  clickType,
                });
              }
            }
          }
        }
      }
    }
  }

  for (const cmd of pack.commands) {
    for (const action of walkActions(cmd.steps)) {
      if (action.type === "open_menu") {
        addTrigger(cmd.id, action.menuId, { kind: "command", commandId: cmd.id });
      }
    }
  }

  return [...edgeMap.values()];
}
