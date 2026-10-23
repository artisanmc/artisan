import { walkDocumentRefs } from "@/domain/actionArgs";
import { parseDocRef, projectNamespace } from "@/domain/docRef";
import { documentChainSlots } from "@/domain/documentKindVisitors";
import { CORE_DOCUMENT_KINDS } from "@/domain/documentKinds";
import { allDocuments, commandsOf, dialogsOf, menusOf } from "@/domain/documents";
import { addressedAppearances } from "@/domain/element";
import type { Project } from "@/domain/types";

export type EdgeTrigger =
  | { kind: "element"; elementId: string; material: string; clickType: string }
  | { kind: "command"; commandId: string }
  | { kind: "dialog_button"; dialogId: string; buttonId: string }
  /** A chain slot of a Document of another kind (its `chainSlots` visitor). */
  | { kind: "chain"; documentId: string; slot: string; label?: string };

export interface Edge {
  id: string;
  source: string;
  target: string;
  triggers: EdgeTrigger[];
}

/**
 * The board's edges: one per (source Document, target Document) pair, carrying the
 * triggers that open the target. A trigger is any action with a `document_ref` argument
 * (`open_menu`, `open_dialog`, a module's action referencing a Document), read through
 * its declaration (ADR `extensible-document-kinds`, R3).
 */
export function deriveEdges(project: Project): Edge[] {
  const edgeMap = new Map<string, Edge>();
  const triggerSeen = new Map<string, Set<string>>();

  // A ref qualified with this project's own folder (`boutique_addon:shop_main`, as a
  // module declares its command's menu) is a Document of this board: its bare id.
  const here = projectNamespace(project);
  const local = (ref: string): string => {
    const { namespace, id } = parseDocRef(ref);
    return namespace === here ? id : ref;
  };
  const addTrigger = (source: string, rawTarget: string, trigger: EdgeTrigger) => {
    const target = local(rawTarget);
    const id = `${source}->${target}`;
    const triggerKey =
      trigger.kind === "element"
        ? `el:${trigger.elementId}:${trigger.clickType}`
        : trigger.kind === "dialog_button"
          ? `dlg:${trigger.dialogId}:${trigger.buttonId}`
          : trigger.kind === "chain"
            ? `chain:${trigger.documentId}:${trigger.slot}`
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

  for (const menu of menusOf(project)) {
    for (const layer of menu.layers) {
      for (const el of layer.elements) {
        for (const appearance of addressedAppearances(el)) {
          if (!appearance.click) continue;
          const material = appearance.material ?? el.display.material ?? "";
          for (const [clickType, handler] of Object.entries(appearance.click)) {
            if (!handler) continue;
            for (const ref of walkDocumentRefs(handler.steps)) {
              if (ref.id === "") continue;
              addTrigger(menu.id, ref.id, {
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

  for (const cmd of commandsOf(project)) {
    for (const ref of walkDocumentRefs(cmd.steps)) {
      if (ref.id !== "") addTrigger(cmd.id, ref.id, { kind: "command", commandId: cmd.id });
    }
  }

  for (const dialog of dialogsOf(project)) {
    for (const btn of dialog.buttons) {
      for (const ref of walkDocumentRefs(btn.steps)) {
        if (ref.id === "") continue;
        addTrigger(dialog.id, ref.id, {
          kind: "dialog_button",
          dialogId: dialog.id,
          buttonId: btn.id,
        });
      }
    }
  }

  // Any other kind: its chains come from its visitor, the trigger is the slot itself.
  const core = new Set(CORE_DOCUMENT_KINDS.map((k) => k.kind));
  for (const { kind, doc } of allDocuments(project)) {
    if (core.has(kind)) continue;
    for (const slot of documentChainSlots(kind, doc)) {
      for (const ref of walkDocumentRefs(slot.steps)) {
        if (ref.id === "") continue;
        addTrigger(doc.id, ref.id, {
          kind: "chain",
          documentId: doc.id,
          slot: slot.name,
          ...(slot.label !== undefined ? { label: slot.label } : {}),
        });
      }
    }
  }

  return [...edgeMap.values()];
}
