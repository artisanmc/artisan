import { walkActions } from "@/domain/stepPath";
import type { Project } from "@/domain/types";

export type EdgeTrigger =
  | { kind: "element"; elementId: string; material: string; clickType: string }
  | { kind: "command"; commandId: string }
  | { kind: "dialog_button"; dialogId: string; buttonId: string };

export interface Edge {
  id: string;
  source: string;
  target: string;
  triggers: EdgeTrigger[];
}

export function deriveEdges(project: Project): Edge[] {
  const edgeMap = new Map<string, Edge>();
  const triggerSeen = new Map<string, Set<string>>();

  const addTrigger = (source: string, target: string, trigger: EdgeTrigger) => {
    const id = `${source}->${target}`;
    const triggerKey =
      trigger.kind === "element"
        ? `el:${trigger.elementId}:${trigger.clickType}`
        : trigger.kind === "dialog_button"
          ? `dlg:${trigger.dialogId}:${trigger.buttonId}`
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

  for (const menu of project.menus) {
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
              } else if (action.type === "open_dialog") {
                addTrigger(menu.id, action.dialogId, {
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

  for (const cmd of project.commands) {
    for (const action of walkActions(cmd.steps)) {
      if (action.type === "open_menu") {
        addTrigger(cmd.id, action.menuId, { kind: "command", commandId: cmd.id });
      } else if (action.type === "open_dialog") {
        addTrigger(cmd.id, action.dialogId, { kind: "command", commandId: cmd.id });
      }
    }
  }

  for (const dialog of project.dialogs ?? []) {
    for (const btn of dialog.buttons) {
      for (const action of walkActions(btn.steps)) {
        if (action.type === "open_menu") {
          addTrigger(dialog.id, action.menuId, {
            kind: "dialog_button",
            dialogId: dialog.id,
            buttonId: btn.id,
          });
        } else if (action.type === "open_dialog") {
          addTrigger(dialog.id, action.dialogId, {
            kind: "dialog_button",
            dialogId: dialog.id,
            buttonId: btn.id,
          });
        }
      }
    }
  }

  return [...edgeMap.values()];
}
