import type { ClickType, CommandId, CommandNodePath, DialogId, ElementId, MenuId } from "./types";

/**
 * Where an **Action chain** lives in a Project: the click handler of one Element state, a
 * Command's steps, or one button of a Dialog. A Step inside the chain is then addressed by
 * this plus a `StepPath` (`domain/stepPath.ts`).
 */
export type ChainAddress =
  | {
      kind: "element";
      menuId: MenuId;
      elementId: ElementId;
      /** Index of the Element state (appearance) that owns the click handler. */
      stateIndex: number;
      clickType: ClickType;
    }
  | {
      kind: "command";
      commandId: CommandId;
      /** The sub-command whose steps these are; absent: the command's own. */
      sub?: CommandNodePath;
    }
  | { kind: "dialogButton"; dialogId: DialogId; buttonIndex: number }
  /**
   * A chain slot of a Document of any kind that declares its chains (`chainSlots`): a
   * Trigger's `do`. Edited through the generic `editDocumentChain` reducer.
   */
  | { kind: "document"; docKind: string; docId: string; slot: string };

/** The chain's location as the store reducers of its owner take it. */
export type ChainTarget<A extends ChainAddress = ChainAddress> = A extends { kind: "element" }
  ? { menuId: MenuId; elementId: ElementId; appearanceIndex: number; clickType: ClickType }
  : A extends { kind: "command" }
    ? { commandId: CommandId; sub?: CommandNodePath }
    : A extends { kind: "dialogButton" }
      ? { dialogId: DialogId; buttonIndex: number }
      : { docKind: string; docId: string; slot: string };

export function chainTarget<A extends ChainAddress>(address: A): ChainTarget<A>;
export function chainTarget(address: ChainAddress): ChainTarget {
  switch (address.kind) {
    case "element":
      return {
        menuId: address.menuId,
        elementId: address.elementId,
        appearanceIndex: address.stateIndex,
        clickType: address.clickType,
      };
    case "command":
      return { commandId: address.commandId, sub: address.sub };
    case "dialogButton":
      return { dialogId: address.dialogId, buttonIndex: address.buttonIndex };
    case "document":
      return { docKind: address.docKind, docId: address.docId, slot: address.slot };
  }
}

/**
 * The menu context an action of the chain is edited in (placeholders and defaults resolve
 * against it). Only an Element's click handlers have one.
 */
export function chainActionContext(address: ChainAddress): {
  menuId?: MenuId;
  elementId?: ElementId;
  clickType?: ClickType;
} {
  return address.kind === "element"
    ? { menuId: address.menuId, elementId: address.elementId, clickType: address.clickType }
    : {};
}

/** Whether `if` steps can be added: a Dialog button runs a flat list of actions. */
export function chainAllowsIf(address: ChainAddress): boolean {
  return address.kind !== "dialogButton";
}
