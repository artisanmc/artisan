import {
  mintLTexts,
  rekeyCommand,
  rekeyMenu,
  rekeyPack,
  releaseLTexts,
  visitAppearanceLTexts,
  visitCommandLTexts,
  visitDialogLTexts,
  visitElementLTexts,
  visitMenuLTexts,
  visitStepLTexts,
} from "@/domain/i18nSites";
import { commandId, newCommandId, newLayerId, newPackId } from "@/domain/ids";
import { migrateTitle } from "@/domain/migrateTitle";
import { type StepFrame, type StepPath, resolveParentMut, walkActions } from "@/domain/stepPath";
import type {
  Account,
  Action,
  Appearance,
  ClickType,
  Command,
  CommandArg,
  CommandId,
  Condition,
  ConnectorSpec,
  ContextInput,
  DataSource,
  DataSourceId,
  Dialog,
  DialogBody,
  DialogId,
  DialogInput,
  EdgeAnchor,
  Element,
  ElementId,
  FieldType,
  I18nKey,
  InventoryType,
  LText,
  Layer,
  Menu,
  MenuId,
  MenuTitleLayer,
  Pack,
  PackId,
  SourceRef,
  Step,
} from "@/domain/types";
import { gridArrange } from "@/features/canvas/autoLayout";
import { colsFor, rowsFor, slotCount } from "@/features/canvas/inventoryTypes";
import { inferFieldTypeFromValue } from "@/features/data/helpers";
import { createLText, createLTextAt, deleteLText, setLText } from "@/lib/i18n";
import {
  clickHandlerKeyPrefix,
  commandKeyPrefix,
  dialogBodyTextKey,
  dialogButtonKeyPrefix,
  dialogButtonLabelKey,
  dialogInputLabelKey,
  dialogTitleKey,
  elementLoreKey,
  elementTitleKey,
  menuTitleKey,
} from "@/lib/i18nKeys";
import { migratePackToI18n } from "@/lib/i18nMigration";
import { findUnusedI18nKeys } from "@/lib/i18nUsages";
import {
  addPosition,
  formatPositions,
  parsePositions,
  positionsContains,
  removePosition,
} from "@/lib/positions";
import { commandV1ToDomain } from "@/schema/commandV1ToDomain";
import { dialogV1ToDomain } from "@/schema/dialogV1ToDomain";
import { menuV1ToDomain } from "@/schema/menuV1ToDomain";
import { current, produce } from "immer";
import { parse as parseYaml } from "yaml";
import { temporal } from "zundo";
import { create } from "zustand";

type MenuRows = 1 | 2 | 3 | 4 | 5 | 6;

interface AccountState {
  account: Account;
  setAccount: (account: Account) => void;
  createPack: (input: { id: string }) => PackId;
  /**
   * Import a pack object as a *new* pack: assigns a fresh PackId, marks
   * source=imported, retags every contained menu/command with the new
   * packId. Throws on malformed input.
   */
  importPack: (input: { pack: Pack }) => PackId;
  replacePack: (pack: Pack) => void;
  /**
   * Apply an AI-generated menu/v1: convert to domain, insert/replace in the
   * pack, merge i18n. Returns the constructs dropped during conversion (no
   * domain equivalent) so the caller can warn instead of losing them silently.
   */
  applyAssistantMenu: (input: {
    packId: PackId;
    menuV1: Record<string, unknown>;
    lang: string;
  }) => string[];
  /** Apply an AI-generated command/v1: convert + insert/replace + merge i18n. Returns dropped constructs. */
  applyAssistantCommand: (input: {
    packId: PackId;
    commandV1: Record<string, unknown>;
    lang: string;
  }) => string[];
  /** Apply an AI-generated dialog/v1: convert + insert/replace + merge i18n. Returns dropped constructs. */
  applyAssistantDialog: (input: {
    packId: PackId;
    dialogV1: Record<string, unknown>;
    lang: string;
  }) => string[];
  /**
   * Create a new menu in `packId` with sensible defaults (rows=3, single
   * default layer, no elements). Optional canvas position; falls back to
   * autoLayout's grid if omitted. Returns the new id so callers can route
   * to it.
   */
  createMenu: (input: {
    packId: PackId;
    id: string;
    rows?: MenuRows;
    position?: { x: number; y: number };
  }) => MenuId;
  /**
   * Create a new command in `packId` with sensible defaults (no args, no
   * steps). Returns the new id.
   */
  createCommand: (input: {
    packId: PackId;
    id?: string;
    name?: string;
    position?: { x: number; y: number };
  }) => CommandId;
  createDialog: (input: {
    packId: PackId;
    id: string;
    position?: { x: number; y: number };
  }) => DialogId;
  setDialogTitle: (input: {
    packId: PackId;
    dialogId: DialogId;
    lang: string;
    value: string;
  }) => void;
  setDialogField: (input: {
    packId: PackId;
    dialogId: DialogId;
    field: "canCloseWithEscape";
    value: boolean;
  }) => void;
  setDialogId: (input: { packId: PackId; oldId: DialogId; newId: DialogId }) => void;
  addDialogBody: (input: { packId: PackId; dialogId: DialogId; body: DialogBody }) => void;
  removeDialogBody: (input: { packId: PackId; dialogId: DialogId; index: number }) => void;
  setDialogBodyText: (input: {
    packId: PackId;
    dialogId: DialogId;
    index: number;
    lang: string;
    value: string;
  }) => void;
  setDialogBodyMaterial: (input: {
    packId: PackId;
    dialogId: DialogId;
    index: number;
    material: string;
    count: number;
  }) => void;
  addDialogInput: (input: {
    packId: PackId;
    dialogId: DialogId;
    inputType: DialogInput["type"];
  }) => void;
  removeDialogInput: (input: { packId: PackId; dialogId: DialogId; index: number }) => void;
  setDialogInput: (input: {
    packId: PackId;
    dialogId: DialogId;
    index: number;
    patch: Partial<DialogInput>;
  }) => void;
  addDialogButton: (input: { packId: PackId; dialogId: DialogId }) => void;
  removeDialogButton: (input: { packId: PackId; dialogId: DialogId; buttonIndex: number }) => void;
  setDialogButtonLabel: (input: {
    packId: PackId;
    dialogId: DialogId;
    buttonIndex: number;
    lang: string;
    value: string;
  }) => void;
  addDialogButtonStep: (input: {
    packId: PackId;
    dialogId: DialogId;
    buttonIndex: number;
    frames: StepFrame[];
    index: number;
    step: Step;
    lang: string;
  }) => void;
  moveDialogButtonStep: (input: {
    packId: PackId;
    dialogId: DialogId;
    buttonIndex: number;
    frames: StepFrame[];
    fromIndex: number;
    toIndex: number;
  }) => void;
  setDialogButtonStep: (input: {
    packId: PackId;
    dialogId: DialogId;
    buttonIndex: number;
    path: StepPath;
    step: Step;
    lang: string;
  }) => void;
  removeDialogButtonStep: (input: {
    packId: PackId;
    dialogId: DialogId;
    buttonIndex: number;
    path: StepPath;
  }) => void;
  addDialogButtonIfCase: (input: {
    packId: PackId;
    dialogId: DialogId;
    buttonIndex: number;
    frames: StepFrame[];
    ifStepIndex: number;
  }) => void;
  removeDialogButtonIfCase: (input: {
    packId: PackId;
    dialogId: DialogId;
    buttonIndex: number;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
  }) => void;
  setDialogButtonIfCaseConditions: (input: {
    packId: PackId;
    dialogId: DialogId;
    buttonIndex: number;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
    conditions: Condition[];
    op?: "and" | "or";
  }) => void;
  setDialogButtonIfCaseJoin: (input: {
    packId: PackId;
    dialogId: DialogId;
    buttonIndex: number;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
    joinIndex: number;
    op: "and" | "or";
  }) => void;
  toggleDialogButtonIfElse: (input: {
    packId: PackId;
    dialogId: DialogId;
    buttonIndex: number;
    frames: StepFrame[];
    ifStepIndex: number;
    lang: string;
    enabled: boolean;
  }) => void;
  removePack: (packId: PackId) => void;
  reorderPacks: (newOrder: PackId[]) => void;
  moveMenuToPack: (input: { menuId: MenuId; fromPackId: PackId; toPackId: PackId }) => void;
  setCanvasPosition: (input: { packId: PackId; nodeId: string; x: number; y: number }) => void;
  addToBoard: (input: { packId: PackId; nodeId: string; x: number; y: number }) => void;
  removeFromBoard: (input: { packId: PackId; nodeId: string }) => void;
  arrangeAllOnBoard: (input: { packId: PackId }) => void;
  /** Override one endpoint of a canvas edge ("source->target" id). */
  setEdgeAnchor: (input: {
    packId: PackId;
    edgeId: string;
    end: "from" | "to";
    anchor: EdgeAnchor;
  }) => void;
  /** Remove an endpoint override; drops the entry when both ends are auto again. */
  clearEdgeAnchor: (input: { packId: PackId; edgeId: string; end: "from" | "to" }) => void;
  deleteFromPack: (input: { packId: PackId; nodeIds: string[] }) => void;
  setPackField: (input: { packId: PackId; field: "name" | "description"; value: string }) => void;
  setMenuField: (input: {
    packId: PackId;
    menuId: MenuId;
    field: "permission" | "rows" | "inventoryType";
    value: string | MenuRows;
  }) => void;
  /** Update the menu's title in the given language. Writes into the first text layer (or prepends one). */
  setMenuTitle: (input: { packId: PackId; menuId: MenuId; lang: string; value: string }) => void;
  /** Replace the entire title layer array. */
  setMenuTitleLayers: (input: { packId: PackId; menuId: MenuId; layers: MenuTitleLayer[] }) => void;
  /** Patch a single title layer by index. */
  updateMenuTitleLayer: (input: {
    packId: PackId;
    menuId: MenuId;
    index: number;
    patch: Partial<MenuTitleLayer>;
  }) => void;
  /** Append a new title layer. */
  addMenuTitleLayer: (input: { packId: PackId; menuId: MenuId; layer: MenuTitleLayer }) => void;
  /** Remove the title layer at `index`. */
  removeMenuTitleLayer: (input: { packId: PackId; menuId: MenuId; index: number }) => void;
  /** Move a title layer from `fromIndex` to `toIndex`. */
  reorderMenuTitleLayers: (input: {
    packId: PackId;
    menuId: MenuId;
    fromIndex: number;
    toIndex: number;
  }) => void;
  setCommandField: (input: {
    packId: PackId;
    commandId: CommandId;
    field: "name" | "permission" | "description";
    value: string;
  }) => void;
  setCommandAliases: (input: { packId: PackId; commandId: CommandId; aliases: string[] }) => void;
  /** Replace an entire command object in place (whole-command update). */
  updateCommand: (input: { packId: PackId; command: Command }) => void;
  /** Replace an entire dialog object in place (whole-dialog update). */
  updateDialog: (input: { packId: PackId; dialog: Dialog }) => void;
  /** Append a new argument at the end of a command's argument list. */
  addCommandArg: (input: { packId: PackId; commandId: CommandId; arg?: CommandArg }) => void;
  /** Replace the argument at `index` (whole-arg replace; immer drafts handle the merge). */
  setCommandArg: (input: {
    packId: PackId;
    commandId: CommandId;
    index: number;
    arg: CommandArg;
  }) => void;
  removeCommandArg: (input: { packId: PackId; commandId: CommandId; index: number }) => void;
  /** Append a new context input to a menu (auto-named ctxN). */
  addMenuContextInput: (input: {
    packId: PackId;
    menuId: MenuId;
    kind?: "primitive" | "sourceRef";
  }) => void;
  setMenuContextInput: (input: {
    packId: PackId;
    menuId: MenuId;
    index: number;
    input: ContextInput;
  }) => void;
  removeMenuContextInput: (input: { packId: PackId; menuId: MenuId; index: number }) => void;
  /** Element iteration: bind this element's slots to a list source in the menu context. */
  setElementIterates: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    iterates: { source: string; alias: string } | undefined;
  }) => void;
  /**
   * Rename a menu's id. Rejects if newId already exists in the pack.
   * Atomically rewrites all `open_menu` refs in the pack and the
   * canvasLayout key. Cross-pack refs to this menu (which we don't track)
   * become dangling — runtime handles.
   */
  setMenuId: (input: { packId: PackId; oldId: MenuId; newId: MenuId }) => void;
  /** Rename a command's id. Rejects if newId already exists in the pack. */
  setCommandId: (input: { packId: PackId; oldId: CommandId; newId: CommandId }) => void;
  /** Rename an element's id. Rejects if newId already exists in the same menu. */
  setElementId: (input: {
    packId: PackId;
    menuId: MenuId;
    oldId: ElementId;
    newId: ElementId;
  }) => void;
  setSlotMaterial: (input: {
    packId: PackId;
    menuId: MenuId;
    position: number;
    material: string;
  }) => void;
  /** Removes the element at the given position from the menu's first layer. */
  clearSlot: (input: { packId: PackId; menuId: MenuId; position: number }) => void;
  /** Update a scalar field on the element's appearance at the given index (default 0). */
  setAppearanceField: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex?: number;
    field: "count" | "material" | "head";
    value: string | number;
  }) => void;
  /** Update an appearance title for the given language. Allocates the LText on first write. */
  setAppearanceTitle: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex?: number;
    lang: string;
    value: string;
  }) => void;
  /** Set the lore value (multi-line string, `\n`-separated lines) for an appearance. */
  setAppearanceLore: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex?: number;
    lang: string;
    value: string;
  }) => void;
  /**
   * Update the value of an i18n entry under `lang`. Used by every text
   * field whose component already holds the `LText` ref (menu title,
   * appearance title/lore lines, send_message text in actions). Path-
   * based step mutators handle structure; this handles content.
   */
  setI18nValue: (input: { packId: PackId; lt: LText; lang: string; value: string }) => void;
  /** Add a new language to the pack (clones empty entries from defaultLang for every existing key). */
  addLanguage: (input: { packId: PackId; lang: string }) => void;
  /** Remove a language and all its translations. No-op on `defaultLang`. */
  removeLanguage: (input: { packId: PackId; lang: string }) => void;
  /**
   * Drop every i18n key that's no longer referenced anywhere in the pack
   * (stale leftovers from deleted elements / re-imports). Returns nothing;
   * undoable. See {@link findUnusedI18nKeys}.
   */
  removeUnusedI18nKeys: (input: { packId: PackId }) => void;
  /** Change the pack's default language (the fallback when a key has no entry in the active lang). */
  setPackDefaultLang: (input: { packId: PackId; lang: string }) => void;
  /** Replace the element's positions string (e.g. "0-8,17,26"). */
  setElementPositions: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    positions: string;
  }) => void;
  /**
   * Move one position of an element to another slot — atomically replaces
   * `fromPosition` with `toPosition` in the element's positions list, and
   * removes `toPosition` from any other element that might have owned it
   * (positions are unique across elements within a menu).
   */
  moveElementPosition: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    fromPosition: number;
    toPosition: number;
  }) => void;
  /**
   * Add a position to an element's list (Alt+drag duplicate). If another
   * element already owns the position, it loses it.
   */
  addElementPosition: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    position: number;
  }) => void;
  /** Remove an element from its menu, regardless of how many positions it has. */
  deleteElement: (input: { packId: PackId; menuId: MenuId; elementId: ElementId }) => void;
  /** Replace one step inside a click handler's step tree at the given path. */
  setElementStep: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
    clickType: ClickType;
    path: StepPath;
    step: Step;
    lang: string;
  }) => void;
  /**
   * Insert a step into a click handler's step tree. `frames` describes how
   * to descend through if-steps; `index` is the position in the resolved
   * Step[] (negative or out-of-range → append).
   */
  addElementStep: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
    clickType: ClickType;
    frames: StepFrame[];
    index: number;
    step: Step;
    lang: string;
  }) => void;
  removeElementStep: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
    clickType: ClickType;
    path: StepPath;
  }) => void;
  /** Reorder steps within the same Step[] (same parent). */
  moveElementStep: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
    clickType: ClickType;
    frames: StepFrame[];
    fromIndex: number;
    toIndex: number;
  }) => void;
  /** Add a new case to an if-step. */
  addIfCase: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
    clickType: ClickType;
    frames: StepFrame[];
    ifStepIndex: number;
  }) => void;
  /** Remove a case from an if-step. */
  removeIfCase: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
    clickType: ClickType;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
  }) => void;
  /** Replace the conditions for one case of an if-step. */
  setIfCaseConditions: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
    clickType: ClickType;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
    conditions: Condition[];
  }) => void;
  /** Set the operator for one joiner inside a case (between conditions[i] and [i+1]). */
  setIfCaseJoin: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
    clickType: ClickType;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
    joinIndex: number;
    op: "and" | "or";
  }) => void;
  /** Toggle the else-branch of an if-step on or off. */
  toggleIfElse: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
    clickType: ClickType;
    frames: StepFrame[];
    ifStepIndex: number;
    enabled: boolean;
  }) => void;
  /**
   * Add an empty click handler at clickType on the given appearance. No-op
   * if a handler already exists there.
   */
  addElementClickHandler: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
    clickType: ClickType;
  }) => void;
  /** Remove the click handler at clickType (with its actions and fallback). */
  removeElementClickHandler: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
    clickType: ClickType;
  }) => void;
  /**
   * Append a new appearance to an element. Seeds with a placeholder permission
   * condition so the new state is clearly "conditional" and doesn't shadow the
   * default state (which has no `if`).
   */
  addAppearance: (input: { packId: PackId; menuId: MenuId; elementId: ElementId }) => void;
  /** Remove the appearance at the given index. The element must keep at least one. */
  removeAppearance: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
  }) => void;
  /** Reorder an element's appearances (priority = position in the array). */
  moveAppearance: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    fromIndex: number;
    toIndex: number;
  }) => void;
  /**
   * Replace the entire visibility condition list (`if`) for an appearance.
   * Empty list → unconditional (default state).
   */
  setAppearanceConditions: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
    conditions: Condition[];
  }) => void;
  /** Set the operator for one joiner between if-conditions on an appearance. */
  setAppearanceJoin: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
    joinIndex: number;
    op: "and" | "or";
  }) => void;
  /** Replace one step inside a command's step tree at the given path. */
  setCommandStep: (input: {
    packId: PackId;
    commandId: CommandId;
    path: StepPath;
    step: Step;
    lang: string;
  }) => void;
  /** Insert a step into a command's step tree. */
  addCommandStep: (input: {
    packId: PackId;
    commandId: CommandId;
    frames: StepFrame[];
    index: number;
    step: Step;
    lang: string;
  }) => void;
  removeCommandStep: (input: {
    packId: PackId;
    commandId: CommandId;
    path: StepPath;
  }) => void;
  moveCommandStep: (input: {
    packId: PackId;
    commandId: CommandId;
    frames: StepFrame[];
    fromIndex: number;
    toIndex: number;
  }) => void;
  addCommandIfCase: (input: {
    packId: PackId;
    commandId: CommandId;
    frames: StepFrame[];
    ifStepIndex: number;
  }) => void;
  removeCommandIfCase: (input: {
    packId: PackId;
    commandId: CommandId;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
  }) => void;
  setCommandIfCaseConditions: (input: {
    packId: PackId;
    commandId: CommandId;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
    conditions: Condition[];
  }) => void;
  setCommandIfCaseJoin: (input: {
    packId: PackId;
    commandId: CommandId;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
    joinIndex: number;
    op: "and" | "or";
  }) => void;
  toggleCommandIfElse: (input: {
    packId: PackId;
    commandId: CommandId;
    frames: StepFrame[];
    ifStepIndex: number;
    enabled: boolean;
  }) => void;
  /**
   * Insert a fully-formed element (already given a fresh id) into a menu's
   * first layer. Any positions claimed by the new element are stripped from
   * sibling elements (positions are unique within a menu).
   */
  addElement: (input: { packId: PackId; menuId: MenuId; element: Element }) => void;
  /**
   * Shift every position of every element in `elementIds` by (dCol, dRow)
   * within the menu's grid. Throws if any new position would fall outside
   * the menu. Positions claimed by the move are stripped from non-target
   * elements (takeover semantics, matching addElementPosition).
   */
  moveSelectionByDelta: (input: {
    packId: PackId;
    menuId: MenuId;
    elementIds: ElementId[];
    dCol: number;
    dRow: number;
  }) => void;
  /** Paste already-cloned-and-id-rewritten entities into a pack at an offset. */
  pasteEntities: (input: {
    packId: PackId;
    menus: Menu[];
    commands: Command[];
    offset: { x: number; y: number };
  }) => void;
  addPackDataSource: (args: { packId: PackId }) => void;
  removePackDataSource: (args: { packId: PackId; id: DataSourceId }) => void;
  renamePackDataSource: (args: { packId: PackId; id: DataSourceId; newName: string }) => void;
  setPackDataSourceYaml: (args: { packId: PackId; id: DataSourceId; yaml: string }) => void;
  addImportedConnector: (args: { packId: PackId; spec: ConnectorSpec }) => void;
  removeImportedConnector: (args: { packId: PackId; ref: string }) => void;
}

/**
 * Tiny helpers shared by the step-tree mutations. They walk the immer
 * draft and return live references so callers can splice in place.
 */
function findElementHandler(
  draft: AccountState,
  packId: PackId,
  menuId: MenuId,
  elementId: ElementId,
  appearanceIndex: number,
  clickType: ClickType,
) {
  const pack = draft.account.packs.find((p) => p.id === packId);
  if (!pack) return null;
  const menu = pack.menus.find((m) => m.id === menuId);
  if (!menu) return null;
  for (const layer of menu.layers) {
    for (const el of layer.elements) {
      if (el.id !== elementId) continue;
      const handler = el.appearances[appearanceIndex]?.click?.[clickType];
      return handler ?? null;
    }
  }
  return null;
}

function findCommand(draft: AccountState, packId: PackId, commandId: CommandId) {
  const pack = draft.account.packs.find((p) => p.id === packId);
  if (!pack) return null;
  return pack.commands.find((c) => c.id === commandId) ?? null;
}

function touch(draft: AccountState, packId: PackId) {
  const pack = draft.account.packs.find((p) => p.id === packId);
  if (pack) pack.updatedAt = new Date().toISOString();
}

/**
 * Per-mutation i18n key lifecycle, folded over the single pack traversal in
 * `@/domain/i18nSites`. `allocStepLTexts` mints canonical keys for any step
 * action still holding the unallocated sentinel (`key === ""`); the `gc*`
 * family releases the keys of a removed subtree. Signatures are preserved so
 * the mutation call sites stay put — only the traversal moved out.
 */
function allocStepLTexts(pack: Pack, steps: Step[], lang: string, keyPrefix: string): void {
  mintLTexts(pack, visitStepLTexts(steps, keyPrefix), lang);
}
function gcStepLTexts(pack: Pack, steps: Step[]): void {
  releaseLTexts(pack, visitStepLTexts(steps, ""));
}
function gcAppearanceLTexts(pack: Pack, appearance: Appearance): void {
  releaseLTexts(pack, visitAppearanceLTexts(appearance, ""));
}
function gcElementLTexts(pack: Pack, element: Element): void {
  releaseLTexts(pack, visitElementLTexts("", element));
}
function gcMenuLTexts(pack: Pack, menu: Menu): void {
  releaseLTexts(pack, visitMenuLTexts(menu));
}
function gcCommandLTexts(pack: Pack, command: Command): void {
  releaseLTexts(pack, visitCommandLTexts(command));
}
function gcDialogLTexts(pack: Pack, dialog: Dialog): void {
  releaseLTexts(pack, visitDialogLTexts(dialog));
}
/** Replace a single LText key inside a dialog (title/body/input/button label) — used by setDialogId. */
function updateDialogLTextKey(dialog: Dialog, oldKey: I18nKey, newKey: I18nKey): void {
  if (dialog.title.key === oldKey) {
    dialog.title.key = newKey;
    return;
  }
  for (const body of dialog.body) {
    if (body.type === "text" && body.text.key === oldKey) {
      body.text.key = newKey;
      return;
    }
  }
  for (const input of dialog.inputs) {
    if (input.label.key === oldKey) {
      input.label.key = newKey;
      return;
    }
    if (input.type === "single_option") {
      for (const opt of input.options) {
        if (opt.label.key === oldKey) {
          opt.label.key = newKey;
          return;
        }
      }
    }
  }
  for (const btn of dialog.buttons) {
    if (btn.label.key === oldKey) {
      btn.label.key = newKey;
      return;
    }
    for (const action of walkActions(btn.steps)) {
      if (
        (action.type === "send_message" || action.type === "broadcast") &&
        action.text.key === oldKey
      ) {
        action.text.key = newKey;
        return;
      }
      if (action.type === "show_title") {
        if (action.title.key === oldKey) {
          action.title.key = newKey;
          return;
        }
        if (action.subtitle?.key === oldKey) {
          action.subtitle.key = newKey;
          return;
        }
      }
    }
  }
}

function generateDataSourceId(): DataSourceId {
  return `ds_${Math.random().toString(36).slice(2, 10)}` as DataSourceId;
}

function nextElementIdForMaterial(pack: Pack, material: string | undefined): ElementId {
  const base = (material ?? "button").toLowerCase();
  const prefix = `${base}_`;
  let max = 0;
  for (const menu of pack.menus) {
    for (const layer of menu.layers) {
      for (const el of layer.elements) {
        if (el.id.startsWith(prefix)) {
          const n = Number.parseInt(el.id.slice(prefix.length), 10);
          if (Number.isFinite(n) && n > max) max = n;
        }
      }
    }
  }
  return `${base}_${max + 1}` as ElementId;
}

function nextAvailableName(existing: DataSource[], base: string): string {
  if (!existing.some((d) => d.name === base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}_${n}`;
    if (!existing.some((d) => d.name === candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
}

/** Throws if any required arg follows an optional one. */
function validateArgOrder(args: CommandArg[]): void {
  let seenOptional = false;
  for (const arg of args) {
    if (!arg.required) {
      seenOptional = true;
    } else if (seenOptional) {
      throw new Error(`required arg "${arg.name}" cannot follow an optional arg`);
    }
  }
}

/**
 * Middleware order: temporal(persist(stateCreator)).
 *
 * `temporal` wraps the persisted state creator so undo/redo replays the
 * `account` slice. Action functions are stable refs, so excluding them via
 * `partialize` keeps the diff narrow.
 *
 * Account-level mutations (createPack, reorderPacks) clear the temporal
 * stack themselves so they don't tangle with pack-internal edits in the
 * undo history. Pack-internal mutations (slot material, field edits, canvas
 * position, deleteFromPack, moveMenuToPack) are undoable.
 */
const clearTemporal = () => useAccountStore.temporal.getState().clear();

export const useAccountStore = create<AccountState>()(
  temporal(
    (set, get) => ({
      account: { id: "" as Account["id"], packs: [], packOrder: [] },
      setAccount: (account) => {
        clearTemporal();
        const migratedPacks = account.packs.map((p) => ({
          ...p,
          dialogs: p.dialogs ?? [],
          menus: p.menus.map((m) => ({ ...m, title: migrateTitle(m.title) })),
        }));
        set({ account: { ...account, packs: migratedPacks } });
      },
      createPack: ({ id: rawId }) => {
        const id = rawId as PackId;
        set(
          produce((draft: AccountState) => {
            draft.account.packs.push({
              id,
              name: rawId,
              source: "user_created",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              menus: [],
              commands: [],
              templates: [],
              assets: [],
              dataSources: [],
              dialogs: [],
              importedConnectors: [],
              i18nKeys: {},
              defaultLang: "en",
              canvasLayout: {},
            });
            draft.account.packOrder.push(id);
          }),
        );
        clearTemporal();
        return id;
      },
      importPack: ({ pack: incoming }) => {
        // Light shape check — the input came from a user-supplied file so
        // we don't fully trust it, but we don't deep-validate either.
        if (!incoming || typeof incoming !== "object") {
          throw new Error("invalid pack: not an object");
        }
        if (typeof incoming.name !== "string") throw new Error("invalid pack: missing name");
        if (!Array.isArray(incoming.menus)) throw new Error("invalid pack: missing menus");
        if (!Array.isArray(incoming.commands)) throw new Error("invalid pack: missing commands");

        const id = newPackId();
        set(
          produce((draft: AccountState) => {
            const next = {
              ...incoming,
              id,
              // Force fresh source/timestamps even if the file claimed otherwise.
              source: "imported" as const,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              // Retag children so their packId matches the new pack id.
              menus: incoming.menus.map((m) => ({ ...m, packId: id })),
              commands: incoming.commands.map((c) => ({ ...c, packId: id })),
              templates: (incoming.templates ?? []).map((t) => ({ ...t, packId: id })),
              assets: (incoming.assets ?? []).map((a) => ({ ...a, packId: id })),
              dialogs: (incoming.dialogs ?? []).map((d) => ({ ...d, packId: id })),
              i18nKeys: incoming.i18nKeys ?? {},
              defaultLang: incoming.defaultLang ?? "en",
              canvasLayout: incoming.canvasLayout ?? {},
            };
            // Imported pack may use the legacy plain-string shape — migrate
            // in place so it lines up with the current LText-based domain.
            migratePackToI18n(next, next.defaultLang);
            // Migrate menu titles from LText to MenuTitleLayer[].
            for (const menu of next.menus) {
              menu.title = migrateTitle(menu.title);
            }
            draft.account.packs.push(next);
            draft.account.packOrder.push(id);
          }),
        );
        clearTemporal();
        return id;
      },
      replacePack: (pack) => {
        clearTemporal();
        set(
          produce((draft: AccountState) => {
            const idx = draft.account.packs.findIndex((p) => p.id === pack.id);
            if (idx !== -1) {
              draft.account.packs[idx] = {
                ...pack,
                menus: pack.menus.map((m) => ({ ...m, title: migrateTitle(m.title) })),
              };
            }
          }),
        );
      },
      applyAssistantMenu: ({ packId: pId, menuV1, lang }) => {
        let unsupported: string[] = [];
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const converted = menuV1ToDomain(menuV1, { packId: pId, lang });
            const { menu, i18nKeys } = converted;
            unsupported = converted.unsupported;
            // The converter already stamps menu.packId from opts.packId; keep
            // this as a safety net so the domain Menu always carries the id.
            menu.packId = pId;
            for (const [key, langs] of Object.entries(i18nKeys)) {
              pack.i18nKeys[key as I18nKey] = {
                ...(pack.i18nKeys[key as I18nKey] ?? {}),
                ...langs,
              };
            }
            const idx = pack.menus.findIndex((m) => m.id === menu.id);
            if (idx >= 0) pack.menus[idx] = menu;
            else pack.menus.push(menu);
            pack.updatedAt = new Date().toISOString();
          }),
        );
        return unsupported;
      },
      applyAssistantCommand: ({ packId: pId, commandV1, lang }) => {
        let unsupported: string[] = [];
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const {
              command,
              i18nKeys,
              unsupported: u,
            } = commandV1ToDomain(commandV1, { packId: pId, lang });
            unsupported = u;
            command.packId = pId;
            for (const [key, langs] of Object.entries(i18nKeys)) {
              pack.i18nKeys[key as I18nKey] = {
                ...(pack.i18nKeys[key as I18nKey] ?? {}),
                ...langs,
              };
            }
            const idx = pack.commands.findIndex((c) => c.id === command.id);
            if (idx >= 0) pack.commands[idx] = command;
            else pack.commands.push(command);
            pack.updatedAt = new Date().toISOString();
          }),
        );
        return unsupported;
      },
      applyAssistantDialog: ({ packId: pId, dialogV1, lang }) => {
        let unsupported: string[] = [];
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const {
              dialog,
              i18nKeys,
              unsupported: u,
            } = dialogV1ToDomain(dialogV1, { packId: pId, lang });
            unsupported = u;
            dialog.packId = pId;
            for (const [key, langs] of Object.entries(i18nKeys)) {
              pack.i18nKeys[key as I18nKey] = {
                ...(pack.i18nKeys[key as I18nKey] ?? {}),
                ...langs,
              };
            }
            const idx = pack.dialogs.findIndex((d) => d.id === dialog.id);
            if (idx >= 0) pack.dialogs[idx] = dialog;
            else pack.dialogs.push(dialog);
            pack.updatedAt = new Date().toISOString();
          }),
        );
        return unsupported;
      },
      createMenu: ({ packId: pId, id: rawId, rows, position }) => {
        const id = rawId as MenuId;
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            pack.menus.push({
              id,
              packId: pId,
              // Default to a single Plain (vanilla) title layer. Vanilla mode
              // works without a resource pack and matches what new users expect
              // ("type a title, see a title"). The empty `key` is rekeyed to
              // `menus.{id}.title` at deploy time by rekeyPack.
              title: [{ kind: "plain", value: { key: "" as I18nKey } }],
              rows: rows ?? 3,
              layers: [{ id: newLayerId(), name: "default", elements: [] }],
            });
            if (position) {
              (pack.canvasLayout as Record<string, { x: number; y: number }>)[id] = position;
            }
            pack.updatedAt = new Date().toISOString();
          }),
        );
        return id;
      },
      createCommand: ({ packId: pId, id: explicitId, name, position }) => {
        const id = explicitId ? commandId(explicitId) : newCommandId();
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            pack.commands.push({
              id,
              packId: pId,
              name: name ?? "newcmd",
              arguments: [],
              steps: [],
            });
            if (position) {
              (pack.canvasLayout as Record<string, { x: number; y: number }>)[id] = position;
            }
            pack.updatedAt = new Date().toISOString();
          }),
        );
        return id;
      },
      createDialog: ({ packId: pId, id, position }) => {
        const dId = id as DialogId;
        const titleKey = dialogTitleKey(id);
        const btnLabelKey = dialogButtonLabelKey(id, "btn_confirm");
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            pack.i18nKeys[titleKey] = { [pack.defaultLang]: "" };
            pack.i18nKeys[btnLabelKey] = { [pack.defaultLang]: "Confirm" };
            pack.dialogs.push({
              id: dId,
              packId: pId,
              title: { key: titleKey },
              canCloseWithEscape: true,
              body: [],
              inputs: [],
              buttons: [{ id: "btn_confirm", label: { key: btnLabelKey }, steps: [] }],
            });
            if (position) {
              (pack.canvasLayout as Record<string, { x: number; y: number }>)[id] = position;
            }
            pack.updatedAt = new Date().toISOString();
          }),
        );
        return dId;
      },
      setDialogTitle: ({ packId: pId, dialogId: dId, lang, value }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const dialog = pack.dialogs.find((d) => d.id === dId);
            if (!dialog) return;
            if (!pack.i18nKeys[dialog.title.key]) pack.i18nKeys[dialog.title.key] = {};
            pack.i18nKeys[dialog.title.key]![lang] = value;
            touch(draft, pId);
          }),
        ),
      setDialogField: ({ packId: pId, dialogId: dId, field, value }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            const dialog = pack?.dialogs.find((d) => d.id === dId);
            if (!dialog) return;
            if (field === "canCloseWithEscape") dialog.canCloseWithEscape = value;
            touch(draft, pId);
          }),
        ),
      setDialogId: ({ packId: pId, oldId, newId }) => {
        if (oldId === newId) return;
        if (!newId) throw new Error("dialog id cannot be empty");
        const state = get();
        const pack = state.account.packs.find((p) => p.id === pId);
        if (!pack) throw new Error("pack not found");
        if (pack.dialogs.some((d) => d.id === newId))
          throw new Error(`dialog id "${newId}" already exists`);
        const next = produce(state.account, (draft) => {
          const p = draft.packs.find((p) => p.id === pId)!;
          const d = p.dialogs.find((d) => d.id === oldId)!;
          d.id = newId;
          const oldPrefix = `dialogs.${oldId}.`;
          const newPrefix = `dialogs.${newId}.`;
          for (const key of Object.keys(p.i18nKeys)) {
            if (key.startsWith(oldPrefix)) {
              const newKey = (newPrefix + key.slice(oldPrefix.length)) as I18nKey;
              p.i18nKeys[newKey] = p.i18nKeys[key as I18nKey]!;
              delete p.i18nKeys[key as I18nKey];
              updateDialogLTextKey(d, key as I18nKey, newKey);
            }
          }
          const layout = p.canvasLayout as Record<string, { x: number; y: number }>;
          if (layout[oldId as string]) {
            layout[newId as string] = layout[oldId as string]!;
            delete layout[oldId as string];
          }
          rewriteCanvasEdgeIds(p, oldId as string, newId as string);
          p.updatedAt = new Date().toISOString();
        });
        set({ account: next });
      },
      addDialogBody: ({ packId: pId, dialogId: dId, body }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            const dialog = pack?.dialogs.find((d) => d.id === dId);
            if (!dialog) return;
            if (body.type === "text") {
              const key = dialogBodyTextKey(dId, dialog.body.length);
              pack!.i18nKeys[key] = { [pack!.defaultLang]: "" };
              dialog.body.push({ type: "text", text: { key } });
            } else {
              dialog.body.push(body);
            }
            touch(draft, pId);
          }),
        ),
      removeDialogBody: ({ packId: pId, dialogId: dId, index }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            const dialog = pack?.dialogs.find((d) => d.id === dId);
            if (!dialog) return;
            const body = dialog.body[index];
            if (body?.type === "text") delete pack!.i18nKeys[body.text.key];
            dialog.body.splice(index, 1);
            touch(draft, pId);
          }),
        ),
      setDialogBodyText: ({ packId: pId, dialogId: dId, index, lang, value }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            const dialog = pack?.dialogs.find((d) => d.id === dId);
            const body = dialog?.body[index];
            if (!body || body.type !== "text") return;
            if (!pack!.i18nKeys[body.text.key]) pack!.i18nKeys[body.text.key] = {};
            pack!.i18nKeys[body.text.key]![lang] = value;
            touch(draft, pId);
          }),
        ),
      setDialogBodyMaterial: ({ packId: pId, dialogId: dId, index, material, count }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            const dialog = pack?.dialogs.find((d) => d.id === dId);
            const body = dialog?.body[index];
            if (!body || body.type !== "item") return;
            body.material = material;
            body.count = count;
            touch(draft, pId);
          }),
        ),
      addDialogInput: ({ packId: pId, dialogId: dId, inputType }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            const dialog = pack?.dialogs.find((d) => d.id === dId);
            if (!dialog) return;
            const inputId = `input_${dialog.inputs.length}`;
            const labelKey = dialogInputLabelKey(dId, inputId);
            pack!.i18nKeys[labelKey] = { [pack!.defaultLang]: "" };
            let newInput: DialogInput;
            if (inputType === "text") {
              newInput = {
                type: "text",
                id: inputId,
                label: { key: labelKey },
                default: "",
                maxLength: 32,
              };
            } else if (inputType === "bool") {
              newInput = {
                type: "bool",
                id: inputId,
                label: { key: labelKey },
                default: false,
              };
            } else if (inputType === "number_range") {
              newInput = {
                type: "number_range",
                id: inputId,
                label: { key: labelKey },
                min: 0,
                max: 100,
                default: 0,
              };
            } else {
              newInput = {
                type: "single_option",
                id: inputId,
                label: { key: labelKey },
                options: [],
                default: "",
              };
            }
            dialog.inputs.push(newInput);
            touch(draft, pId);
          }),
        ),
      removeDialogInput: ({ packId: pId, dialogId: dId, index }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            const dialog = pack?.dialogs.find((d) => d.id === dId);
            if (!dialog) return;
            const input = dialog.inputs[index];
            if (input) {
              delete pack!.i18nKeys[input.label.key];
              if (input.type === "single_option") {
                for (const opt of input.options) delete pack!.i18nKeys[opt.label.key];
              }
              dialog.inputs.splice(index, 1);
            }
            touch(draft, pId);
          }),
        ),
      setDialogInput: ({ packId: pId, dialogId: dId, index, patch }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            const dialog = pack?.dialogs.find((d) => d.id === dId);
            if (!dialog?.inputs[index]) return;
            Object.assign(dialog.inputs[index]!, patch);
            touch(draft, pId);
          }),
        ),
      addDialogButton: ({ packId: pId, dialogId: dId }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            const dialog = pack?.dialogs.find((d) => d.id === dId);
            if (!dialog) return;
            const btnId = `btn_${dialog.buttons.length}`;
            const labelKey = dialogButtonLabelKey(dId, btnId);
            pack!.i18nKeys[labelKey] = { [pack!.defaultLang]: "" };
            dialog.buttons.push({ id: btnId, label: { key: labelKey }, steps: [] });
            touch(draft, pId);
          }),
        ),
      removeDialogButton: ({ packId: pId, dialogId: dId, buttonIndex }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            const dialog = pack?.dialogs.find((d) => d.id === dId);
            if (!dialog) return;
            const btn = dialog.buttons[buttonIndex];
            if (btn) {
              delete pack!.i18nKeys[btn.label.key];
              for (const action of walkActions(btn.steps)) {
                if (action.type === "send_message" || action.type === "broadcast")
                  delete pack!.i18nKeys[action.text.key];
                else if (action.type === "show_title") {
                  delete pack!.i18nKeys[action.title.key];
                  if (action.subtitle) delete pack!.i18nKeys[action.subtitle.key];
                }
              }
              dialog.buttons.splice(buttonIndex, 1);
            }
            touch(draft, pId);
          }),
        ),
      setDialogButtonLabel: ({ packId: pId, dialogId: dId, buttonIndex, lang, value }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            const dialog = pack?.dialogs.find((d) => d.id === dId);
            const btn = dialog?.buttons[buttonIndex];
            if (!btn) return;
            if (!pack!.i18nKeys[btn.label.key]) pack!.i18nKeys[btn.label.key] = {};
            pack!.i18nKeys[btn.label.key]![lang] = value;
            touch(draft, pId);
          }),
        ),
      addDialogButtonStep: ({
        packId: pId,
        dialogId: dId,
        buttonIndex,
        frames,
        index,
        step,
        lang,
      }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            const dialog = pack?.dialogs.find((d) => d.id === dId);
            const btn = dialog?.buttons[buttonIndex];
            if (!pack || !btn) return;
            const parent = resolveParentMut(btn.steps, frames);
            if (!parent) return;
            const at = index < 0 || index > parent.length ? parent.length : index;
            parent.splice(at, 0, step);
            allocStepLTexts(pack, btn.steps, lang, dialogButtonKeyPrefix(dId, btn.id));
            touch(draft, pId);
          }),
        ),
      moveDialogButtonStep: ({
        packId: pId,
        dialogId: dId,
        buttonIndex,
        frames,
        fromIndex,
        toIndex,
      }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            const dialog = pack?.dialogs.find((d) => d.id === dId);
            const btn = dialog?.buttons[buttonIndex];
            if (!btn) return;
            const parent = resolveParentMut(btn.steps, frames);
            if (!parent) return;
            if (fromIndex < 0 || fromIndex >= parent.length) return;
            if (toIndex < 0 || toIndex >= parent.length) return;
            const [moved] = parent.splice(fromIndex, 1);
            if (moved) parent.splice(toIndex, 0, moved);
            touch(draft, pId);
          }),
        ),
      setDialogButtonStep: ({ packId: pId, dialogId: dId, buttonIndex, path, step, lang }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            const dialog = pack?.dialogs.find((d) => d.id === dId);
            const btn = dialog?.buttons[buttonIndex];
            if (!pack || !btn) return;
            const parent = resolveParentMut(btn.steps, path.frames);
            if (!parent || path.index < 0 || path.index >= parent.length) return;
            gcStepLTexts(pack, [parent[path.index]!]);
            parent[path.index] = step;
            allocStepLTexts(pack, btn.steps, lang, dialogButtonKeyPrefix(dId, btn.id));
            touch(draft, pId);
          }),
        ),
      removeDialogButtonStep: ({ packId: pId, dialogId: dId, buttonIndex, path }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            const dialog = pack?.dialogs.find((d) => d.id === dId);
            const btn = dialog?.buttons[buttonIndex];
            if (!pack || !btn) return;
            const parent = resolveParentMut(btn.steps, path.frames);
            if (!parent || path.index < 0 || path.index >= parent.length) return;
            gcStepLTexts(pack, [parent[path.index]!]);
            parent.splice(path.index, 1);
            touch(draft, pId);
          }),
        ),
      addDialogButtonIfCase: ({ packId: pId, dialogId: dId, buttonIndex, frames, ifStepIndex }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            const dialog = pack?.dialogs.find((d) => d.id === dId);
            const btn = dialog?.buttons[buttonIndex];
            if (!btn) return;
            const parent = resolveParentMut(btn.steps, frames);
            const ifStep = parent?.[ifStepIndex];
            if (!ifStep || ifStep.kind !== "if") return;
            ifStep.cases.push({ conditions: [], steps: [] });
            touch(draft, pId);
          }),
        ),
      removeDialogButtonIfCase: ({
        packId: pId,
        dialogId: dId,
        buttonIndex,
        frames,
        ifStepIndex,
        caseIndex,
      }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            const dialog = pack?.dialogs.find((d) => d.id === dId);
            const btn = dialog?.buttons[buttonIndex];
            if (!pack || !btn) return;
            const parent = resolveParentMut(btn.steps, frames);
            const ifStep = parent?.[ifStepIndex];
            if (!ifStep || ifStep.kind !== "if") return;
            if (caseIndex < 0 || caseIndex >= ifStep.cases.length) return;
            if (ifStep.cases.length > 1) {
              gcStepLTexts(pack, ifStep.cases[caseIndex]!.steps);
              ifStep.cases.splice(caseIndex, 1);
            }
            touch(draft, pId);
          }),
        ),
      setDialogButtonIfCaseConditions: ({
        packId: pId,
        dialogId: dId,
        buttonIndex,
        frames,
        ifStepIndex,
        caseIndex,
        conditions,
        op,
      }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            const dialog = pack?.dialogs.find((d) => d.id === dId);
            const btn = dialog?.buttons[buttonIndex];
            if (!btn) return;
            const parent = resolveParentMut(btn.steps, frames);
            const ifStep = parent?.[ifStepIndex];
            if (!ifStep || ifStep.kind !== "if") return;
            const c = ifStep.cases[caseIndex];
            if (!c) return;
            c.conditions = conditions;
            if (op !== undefined)
              c.joins = new Array(Math.max(0, conditions.length - 1)).fill(op) as ("and" | "or")[];
            touch(draft, pId);
          }),
        ),
      setDialogButtonIfCaseJoin: ({
        packId: pId,
        dialogId: dId,
        buttonIndex,
        frames,
        ifStepIndex,
        caseIndex,
        joinIndex,
        op,
      }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            const dialog = pack?.dialogs.find((d) => d.id === dId);
            const btn = dialog?.buttons[buttonIndex];
            if (!btn) return;
            const parent = resolveParentMut(btn.steps, frames);
            const ifStep = parent?.[ifStepIndex];
            if (!ifStep || ifStep.kind !== "if") return;
            const c = ifStep.cases[caseIndex];
            if (!c) return;
            if (!c.joins) c.joins = [];
            c.joins[joinIndex] = op;
            touch(draft, pId);
          }),
        ),
      toggleDialogButtonIfElse: ({
        packId: pId,
        dialogId: dId,
        buttonIndex,
        frames,
        ifStepIndex,
        lang: _lang,
        enabled,
      }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            const dialog = pack?.dialogs.find((d) => d.id === dId);
            const btn = dialog?.buttons[buttonIndex];
            if (!pack || !btn) return;
            const parent = resolveParentMut(btn.steps, frames);
            const ifStep = parent?.[ifStepIndex];
            if (!ifStep || ifStep.kind !== "if") return;
            if (enabled) {
              if (!ifStep.else) ifStep.else = [];
            } else {
              if (ifStep.else) {
                gcStepLTexts(pack, ifStep.else);
                ifStep.else = undefined;
              }
            }
            touch(draft, pId);
          }),
        ),
      removePack: (packId) => {
        set(
          produce((draft: AccountState) => {
            draft.account.packs = draft.account.packs.filter((p) => p.id !== packId);
            draft.account.packOrder = draft.account.packOrder.filter((id) => id !== packId);
          }),
        );
        clearTemporal();
      },
      reorderPacks: (newOrder) => {
        set(
          produce((draft: AccountState) => {
            draft.account.packOrder = [...newOrder];
          }),
        );
        clearTemporal();
      },
      moveMenuToPack: ({ menuId: mId, fromPackId, toPackId }) => {
        const next = produce(get().account, (draft) => {
          const from = draft.packs.find((p) => p.id === fromPackId);
          const to = draft.packs.find((p) => p.id === toPackId);
          if (!from || !to) throw new Error("pack not found");
          const idx = from.menus.findIndex((m) => m.id === mId);
          if (idx === -1) throw new Error("menu not found in source pack");
          const [moved] = from.menus.splice(idx, 1);
          if (!moved) return;
          moved.packId = toPackId;
          to.menus.push(moved);
        });
        set({ account: next });
      },
      setCanvasPosition: ({ packId: pId, nodeId, x, y }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            (pack.canvasLayout as Record<string, { x: number; y: number }>)[nodeId] = { x, y };
          }),
        ),
      // Board-membership entry point: puts an element ON the board at (x,y).
      // Same write as setCanvasPosition (drag-persist), but a distinct intent —
      // call sites read clearly as "add to board" vs. "node moved".
      addToBoard: ({ packId: pId, nodeId, x, y }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            (pack.canvasLayout as Record<string, { x: number; y: number }>)[nodeId] = { x, y };
          }),
        ),
      removeFromBoard: ({ packId: pId, nodeId }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            delete (pack.canvasLayout as Record<string, { x: number; y: number }>)[nodeId];
          }),
        ),
      arrangeAllOnBoard: ({ packId: pId }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const grid = gridArrange(current(pack));
            pack.canvasLayout = grid as typeof pack.canvasLayout;
          }),
        ),
      setEdgeAnchor: ({ packId: pId, edgeId, end, anchor }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            pack.canvasEdges ??= {};
            pack.canvasEdges[edgeId] = { ...pack.canvasEdges[edgeId], [end]: anchor };
          }),
        ),
      clearEdgeAnchor: ({ packId: pId, edgeId, end }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            const entry = pack?.canvasEdges?.[edgeId];
            if (!pack || !entry) return;
            delete entry[end];
            if (!entry.from && !entry.to) delete pack.canvasEdges![edgeId];
          }),
        ),
      setPackField: ({ packId: pId, field, value }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            if (field === "name") pack.name = value;
            else if (field === "description") pack.description = value || undefined;
            pack.updatedAt = new Date().toISOString();
          }),
        ),
      setI18nValue: ({ packId: pId, lt, lang, value }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            setLText(pack, lt, lang, value);
            pack.updatedAt = new Date().toISOString();
          }),
        ),
      addLanguage: ({ packId: pId, lang }) => {
        if (!lang) throw new Error("language code cannot be empty");
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            // Idempotent: re-adding an existing lang is a no-op. We
            // don't seed empty entries for every key — fallback to
            // defaultLang at read time covers untranslated keys. Just
            // touch one entry so future enumeration code can spot the
            // language. (If the pack has no keys at all, the language
            // doesn't need recording anywhere.)
            for (const entry of Object.values(pack.i18nKeys)) {
              if (!entry) continue;
              if (!(lang in entry)) entry[lang] = "";
              break;
            }
            pack.updatedAt = new Date().toISOString();
          }),
        );
      },
      removeLanguage: ({ packId: pId, lang }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            if (lang === pack.defaultLang) return; // refuse to drop the default
            for (const entry of Object.values(pack.i18nKeys)) {
              if (entry) delete entry[lang];
            }
            pack.updatedAt = new Date().toISOString();
          }),
        ),
      removeUnusedI18nKeys: ({ packId: pId }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            // Walk a plain snapshot (`current`) rather than the immer draft —
            // findKeyUsages only reads, and the proxy walk is needless overhead.
            const unused = findUnusedI18nKeys(current(pack));
            if (unused.length === 0) return;
            for (const key of unused) delete pack.i18nKeys[key];
            pack.updatedAt = new Date().toISOString();
          }),
        ),
      setPackDefaultLang: ({ packId: pId, lang }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            if (!lang) return;
            pack.defaultLang = lang;
            pack.updatedAt = new Date().toISOString();
          }),
        ),
      setMenuField: ({ packId: pId, menuId: mId, field, value }) => {
        const next = produce(get().account, (draft) => {
          const pack = draft.packs.find((p) => p.id === pId);
          if (!pack) return;
          const menu = pack.menus.find((m) => m.id === mId);
          if (!menu) return;
          if (field === "permission") {
            if (typeof value !== "string") return;
            menu.permission = value || undefined;
          } else if (field === "rows") {
            if (typeof value !== "number") return;
            const maxPos = slotCount(menu.inventoryType ?? "chest", value) - 1;
            const overflow = menu.layers.some((l) =>
              l.elements.some((el) => parsePositions(el.positions).some((p) => p > maxPos)),
            );
            if (overflow) {
              throw new Error(
                `cannot shrink to ${value} rows: elements exist past position ${maxPos}`,
              );
            }
            menu.rows = value;
          } else if (field === "inventoryType") {
            if (typeof value !== "string") return;
            // Keep+warn: never throw on out-of-range elements; the UI surfaces
            // a count and the canvas/export clamp to the new slotCount. Store
            // undefined for chest so "absent = chest" everywhere.
            menu.inventoryType = value === "chest" ? undefined : (value as InventoryType);
          }
          pack.updatedAt = new Date().toISOString();
        });
        set({ account: next });
      },
      setMenuTitle: ({ packId: pId, menuId: mId, lang, value }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            // menu.title is MenuTitleLayer[]. Write into the first text-bearing
            // layer (plain, text, or textarea) if present; otherwise prepend a
            // new text layer. Plain is the createMenu default (vanilla mode),
            // so the most common path is "write into the plain layer's LText".
            const first = menu.title[0];
            if (
              first &&
              (first.kind === "plain" || first.kind === "text" || first.kind === "textarea")
            ) {
              // Empty-key sentinel from createMenu default: allocate a canonical key.
              if (first.value.key === "") {
                const newLText = createLTextAt(pack, menuTitleKey(mId), value, lang);
                first.value = newLText;
              } else {
                setLText(pack, first.value, lang, value);
              }
            } else {
              const newLText = createLTextAt(pack, menuTitleKey(mId), value, lang);
              menu.title.unshift({ kind: "text", value: newLText, x: 8, y: 5 });
            }
            pack.updatedAt = new Date().toISOString();
          }),
        ),
      setMenuTitleLayers: ({ packId: pId, menuId: mId, layers }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            menu.title = layers;
            pack.updatedAt = new Date().toISOString();
          }),
        ),
      updateMenuTitleLayer: ({ packId: pId, menuId: mId, index, patch }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            const layer = menu.title[index];
            if (!layer) return;
            menu.title[index] = { ...layer, ...patch } as MenuTitleLayer;
            pack.updatedAt = new Date().toISOString();
          }),
        ),
      addMenuTitleLayer: ({ packId: pId, menuId: mId, layer }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            menu.title.push(layer);
            pack.updatedAt = new Date().toISOString();
          }),
        ),
      removeMenuTitleLayer: ({ packId: pId, menuId: mId, index }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            menu.title.splice(index, 1);
            pack.updatedAt = new Date().toISOString();
          }),
        ),
      reorderMenuTitleLayers: ({ packId: pId, menuId: mId, fromIndex, toIndex }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            const [moved] = menu.title.splice(fromIndex, 1);
            if (moved) menu.title.splice(toIndex, 0, moved);
            pack.updatedAt = new Date().toISOString();
          }),
        ),
      setCommandField: ({ packId: pId, commandId: cId, field, value }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const cmd = pack.commands.find((c) => c.id === cId);
            if (!cmd) return;
            if (field === "name") cmd.name = value;
            else if (field === "permission") cmd.permission = value || undefined;
            else if (field === "description") cmd.description = value || undefined;
            pack.updatedAt = new Date().toISOString();
          }),
        ),
      setCommandAliases: ({ packId: pId, commandId: cId, aliases }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const cmd = pack.commands.find((c) => c.id === cId);
            if (!cmd) return;
            cmd.aliases = aliases.length > 0 ? aliases : undefined;
            pack.updatedAt = new Date().toISOString();
          }),
        ),
      updateCommand: ({ packId: pId, command }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const idx = pack.commands.findIndex((c) => c.id === command.id);
            if (idx === -1) return;
            pack.commands[idx] = command;
            pack.updatedAt = new Date().toISOString();
          }),
        ),
      updateDialog: ({ packId: pId, dialog }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const idx = pack.dialogs.findIndex((d) => d.id === dialog.id);
            if (idx === -1) return;
            pack.dialogs[idx] = dialog;
            pack.updatedAt = new Date().toISOString();
          }),
        ),
      addCommandArg: ({ packId: pId, commandId: cId, arg }) => {
        const next = produce(get().account, (draft) => {
          const pack = draft.packs.find((p) => p.id === pId);
          if (!pack) return;
          const cmd = pack.commands.find((c) => c.id === cId);
          if (!cmd) return;
          const used = new Set(cmd.arguments.map((a) => a.name));
          const defaultName = (() => {
            for (let i = 1; ; i++) {
              const candidate = `arg${i}`;
              if (!used.has(candidate)) return candidate;
            }
          })();
          const newArg = arg ?? { name: defaultName, type: "string" as const, required: true };
          validateArgOrder([...cmd.arguments, newArg]);
          cmd.arguments.push(newArg);
          pack.updatedAt = new Date().toISOString();
        });
        set({ account: next });
      },
      setCommandArg: ({ packId: pId, commandId: cId, index, arg }) => {
        const next = produce(get().account, (draft) => {
          const pack = draft.packs.find((p) => p.id === pId);
          if (!pack) return;
          const cmd = pack.commands.find((c) => c.id === cId);
          if (!cmd || index < 0 || index >= cmd.arguments.length) return;
          const newArgs = [...cmd.arguments];
          newArgs[index] = arg;
          validateArgOrder(newArgs);
          cmd.arguments[index] = arg;
          pack.updatedAt = new Date().toISOString();
        });
        set({ account: next });
      },
      removeCommandArg: ({ packId: pId, commandId: cId, index }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const cmd = pack.commands.find((c) => c.id === cId);
            if (!cmd || index < 0 || index >= cmd.arguments.length) return;
            cmd.arguments.splice(index, 1);
            pack.updatedAt = new Date().toISOString();
          }),
        ),
      addMenuContextInput: ({ packId: pId, menuId: mId, kind }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            if (!menu.contextInputs) menu.contextInputs = [];
            const used = new Set(menu.contextInputs.map((c) => c.name));
            const defaultName = (() => {
              for (let i = 1; ; i++) {
                const candidate = `ctx${i}`;
                if (!used.has(candidate)) return candidate;
              }
            })();
            const newInput: ContextInput =
              kind === "sourceRef"
                ? { kind: "sourceRef", name: defaultName, ref: "" as SourceRef }
                : { kind: "primitive", name: defaultName, type: "string" };
            menu.contextInputs.push(newInput);
            pack.updatedAt = new Date().toISOString();
          }),
        ),
      setMenuContextInput: ({ packId: pId, menuId: mId, index, input }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu?.contextInputs) return;
            if (index < 0 || index >= menu.contextInputs.length) return;
            menu.contextInputs[index] = input;
            pack.updatedAt = new Date().toISOString();
          }),
        ),
      removeMenuContextInput: ({ packId: pId, menuId: mId, index }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu?.contextInputs) return;
            if (index < 0 || index >= menu.contextInputs.length) return;
            menu.contextInputs.splice(index, 1);
            if (menu.contextInputs.length === 0) menu.contextInputs = undefined;
            pack.updatedAt = new Date().toISOString();
          }),
        ),
      setElementIterates: ({ packId: pId, menuId: mId, elementId: eId, iterates }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            for (const layer of menu.layers) {
              const el = layer.elements.find((e) => e.id === eId);
              if (el) {
                el.iterates = iterates;
                pack.updatedAt = new Date().toISOString();
                return;
              }
            }
          }),
        ),
      setMenuId: ({ packId: pId, oldId, newId }) => {
        if (oldId === newId) return;
        if (!newId) throw new Error("menu id cannot be empty");
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            if (pack.menus.some((m) => m.id === newId)) {
              throw new Error(`menu id "${newId}" already exists in pack`);
            }
            const menu = pack.menus.find((m) => m.id === oldId);
            if (!menu) return;
            menu.id = newId;
            // Rewrite open_menu refs across the entire pack — both
            // element click handlers and command step trees.
            const rewrite = (action: Action) => {
              if (action.type === "open_menu" && action.menuId === oldId) {
                action.menuId = newId;
              }
            };
            for (const m of pack.menus) {
              for (const layer of m.layers) {
                for (const el of layer.elements) {
                  for (const appearance of el.appearances) {
                    if (!appearance.click) continue;
                    for (const handler of Object.values(appearance.click)) {
                      if (!handler) continue;
                      for (const a of walkActions(handler.steps)) rewrite(a);
                    }
                  }
                }
              }
            }
            for (const cmd of pack.commands) {
              for (const a of walkActions(cmd.steps)) rewrite(a);
            }
            const layout = pack.canvasLayout as Record<string, { x: number; y: number }>;
            if (oldId in layout) {
              layout[newId] = layout[oldId]!;
              delete layout[oldId];
            }
            rewriteCanvasEdgeIds(pack, oldId as string, newId as string);
            rekeyMenu(pack, menu);
            pack.updatedAt = new Date().toISOString();
          }),
        );
      },
      setCommandId: ({ packId: pId, oldId, newId }) => {
        if (oldId === newId) return;
        if (!newId) throw new Error("command id cannot be empty");
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            if (pack.commands.some((c) => c.id === newId)) {
              throw new Error(`command id "${newId}" already exists in pack`);
            }
            const cmd = pack.commands.find((c) => c.id === oldId);
            if (!cmd) return;
            cmd.id = newId;
            const layout = pack.canvasLayout as Record<string, { x: number; y: number }>;
            if (oldId in layout) {
              layout[newId] = layout[oldId]!;
              delete layout[oldId];
            }
            rewriteCanvasEdgeIds(pack, oldId as string, newId as string);
            rekeyCommand(pack, cmd);
            pack.updatedAt = new Date().toISOString();
          }),
        );
      },
      setElementId: ({ packId: pId, menuId: mId, oldId, newId }) => {
        if (oldId === newId) return;
        if (!newId) throw new Error("element id cannot be empty");
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            const allElements = menu.layers.flatMap((l) => l.elements);
            if (allElements.some((el) => el.id === newId)) {
              throw new Error(`element id "${newId}" already exists in menu`);
            }
            for (const layer of menu.layers) {
              const el = layer.elements.find((e) => e.id === oldId);
              if (el) {
                el.id = newId;
                rekeyMenu(pack, menu);
                pack.updatedAt = new Date().toISOString();
                return;
              }
            }
          }),
        );
      },
      setSlotMaterial: ({ packId: pId, menuId: mId, position, material }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            // Find the element that currently owns this position (single OR
            // multi-pos), update its material — preserves title/lore/count.
            for (const layer of menu.layers) {
              for (const el of layer.elements) {
                if (!positionsContains(el.positions, position)) continue;
                const appearance = el.appearances[0];
                if (appearance) appearance.material = material;
                pack.updatedAt = new Date().toISOString();
                return;
              }
            }
            let firstLayer: Layer | undefined = menu.layers[0];
            if (!firstLayer) {
              firstLayer = { id: newLayerId(), name: "default", elements: [] };
              menu.layers.push(firstLayer);
            }
            firstLayer.elements.push({
              id: nextElementIdForMaterial(pack, material),
              positions: String(position),
              appearances: [{ material }],
            });
            pack.updatedAt = new Date().toISOString();
          }),
        ),
      setAppearanceField: ({
        packId: pId,
        menuId: mId,
        elementId,
        appearanceIndex = 0,
        field,
        value,
      }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            for (const layer of menu.layers) {
              for (const el of layer.elements) {
                if (el.id !== elementId) continue;
                const appearance = el.appearances[appearanceIndex];
                if (!appearance) return;
                if (field === "count") {
                  const n = typeof value === "number" ? value : Number(value);
                  if (Number.isNaN(n) || n < 1 || n > 64) return;
                  appearance.count = n === 1 ? undefined : n;
                } else if (field === "material") {
                  if (typeof value !== "string") return;
                  appearance.material = value || undefined;
                } else if (field === "head") {
                  if (typeof value !== "string") return;
                  appearance.head = value || undefined;
                }
                pack.updatedAt = new Date().toISOString();
                return;
              }
            }
          }),
        ),
      setAppearanceTitle: ({
        packId: pId,
        menuId: mId,
        elementId,
        appearanceIndex = 0,
        lang,
        value,
      }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            for (const layer of menu.layers) {
              for (const el of layer.elements) {
                if (el.id !== elementId) continue;
                const appearance = el.appearances[appearanceIndex];
                if (!appearance) return;
                // Lazy-allocate: brand-new appearances start with no title
                // LText, so the first edit creates one. If the user clears
                // the field, we keep the LText (they may want to re-edit
                // or translate it later) but write "" into the active lang.
                if (!appearance.title)
                  appearance.title = createLTextAt(
                    pack,
                    elementTitleKey(mId, elementId, appearanceIndex),
                    value,
                    lang,
                  );
                else setLText(pack, appearance.title, lang, value);
                pack.updatedAt = new Date().toISOString();
                return;
              }
            }
          }),
        ),
      setElementPositions: ({ packId: pId, menuId: mId, elementId, positions }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            for (const layer of menu.layers) {
              for (const el of layer.elements) {
                if (el.id !== elementId) continue;
                el.positions = positions;
                pack.updatedAt = new Date().toISOString();
                return;
              }
            }
          }),
        ),
      moveElementPosition: ({ packId: pId, menuId: mId, elementId, fromPosition, toPosition }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            // First, strip toPosition from any element that owns it.
            for (const layer of menu.layers) {
              for (const otherEl of layer.elements) {
                if (otherEl.id === elementId) continue;
                if (positionsContains(otherEl.positions, toPosition)) {
                  otherEl.positions = removePosition(otherEl.positions, toPosition);
                }
              }
              layer.elements = layer.elements.filter((el) => el.positions !== "");
            }
            // Then update the source element: remove from, add to.
            for (const layer of menu.layers) {
              for (const el of layer.elements) {
                if (el.id !== elementId) continue;
                el.positions = addPosition(removePosition(el.positions, fromPosition), toPosition);
                pack.updatedAt = new Date().toISOString();
                return;
              }
            }
          }),
        ),
      addElementPosition: ({ packId: pId, menuId: mId, elementId, position }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            for (const layer of menu.layers) {
              for (const otherEl of layer.elements) {
                if (otherEl.id === elementId) continue;
                if (positionsContains(otherEl.positions, position)) {
                  otherEl.positions = removePosition(otherEl.positions, position);
                }
              }
              layer.elements = layer.elements.filter((el) => el.positions !== "");
            }
            for (const layer of menu.layers) {
              for (const el of layer.elements) {
                if (el.id !== elementId) continue;
                el.positions = addPosition(el.positions, position);
                pack.updatedAt = new Date().toISOString();
                return;
              }
            }
          }),
        ),
      deleteElement: ({ packId: pId, menuId: mId, elementId }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            for (const layer of menu.layers) {
              const idx = layer.elements.findIndex((el) => el.id === elementId);
              if (idx !== -1) {
                gcElementLTexts(pack, layer.elements[idx]!);
                layer.elements.splice(idx, 1);
                pack.updatedAt = new Date().toISOString();
                return;
              }
            }
          }),
        ),
      setElementStep: ({
        packId: pId,
        menuId: mId,
        elementId,
        appearanceIndex,
        clickType,
        path,
        step,
        lang,
      }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const handler = findElementHandler(
              draft,
              pId,
              mId,
              elementId,
              appearanceIndex,
              clickType,
            );
            if (!handler) return;
            const parent = resolveParentMut(handler.steps, path.frames);
            if (!parent || path.index < 0 || path.index >= parent.length) return;
            gcStepLTexts(pack, [parent[path.index]!]);
            parent[path.index] = step;
            allocStepLTexts(
              pack,
              handler.steps,
              lang,
              clickHandlerKeyPrefix(mId, elementId, appearanceIndex, clickType),
            );
            touch(draft, pId);
          }),
        ),
      addElementStep: ({
        packId: pId,
        menuId: mId,
        elementId,
        appearanceIndex,
        clickType,
        frames,
        index,
        step,
        lang,
      }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const handler = findElementHandler(
              draft,
              pId,
              mId,
              elementId,
              appearanceIndex,
              clickType,
            );
            if (!handler) return;
            const parent = resolveParentMut(handler.steps, frames);
            if (!parent) return;
            const at = index < 0 || index > parent.length ? parent.length : index;
            parent.splice(at, 0, step);
            allocStepLTexts(
              pack,
              handler.steps,
              lang,
              clickHandlerKeyPrefix(mId, elementId, appearanceIndex, clickType),
            );
            touch(draft, pId);
          }),
        ),
      removeElementStep: ({
        packId: pId,
        menuId: mId,
        elementId,
        appearanceIndex,
        clickType,
        path,
      }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const handler = findElementHandler(
              draft,
              pId,
              mId,
              elementId,
              appearanceIndex,
              clickType,
            );
            if (!handler) return;
            const parent = resolveParentMut(handler.steps, path.frames);
            if (!parent || path.index < 0 || path.index >= parent.length) return;
            gcStepLTexts(pack, [parent[path.index]!]);
            parent.splice(path.index, 1);
            touch(draft, pId);
          }),
        ),
      moveElementStep: ({
        packId: pId,
        menuId: mId,
        elementId,
        appearanceIndex,
        clickType,
        frames,
        fromIndex,
        toIndex,
      }) =>
        set(
          produce((draft: AccountState) => {
            const handler = findElementHandler(
              draft,
              pId,
              mId,
              elementId,
              appearanceIndex,
              clickType,
            );
            if (!handler) return;
            const parent = resolveParentMut(handler.steps, frames);
            if (!parent) return;
            if (fromIndex < 0 || fromIndex >= parent.length) return;
            if (toIndex < 0 || toIndex >= parent.length) return;
            const [moved] = parent.splice(fromIndex, 1);
            if (moved) parent.splice(toIndex, 0, moved);
            touch(draft, pId);
          }),
        ),
      addIfCase: ({
        packId: pId,
        menuId: mId,
        elementId,
        appearanceIndex,
        clickType,
        frames,
        ifStepIndex,
      }) =>
        set(
          produce((draft: AccountState) => {
            const handler = findElementHandler(
              draft,
              pId,
              mId,
              elementId,
              appearanceIndex,
              clickType,
            );
            if (!handler) return;
            const parent = resolveParentMut(handler.steps, frames);
            const ifStep = parent?.[ifStepIndex];
            if (!ifStep || ifStep.kind !== "if") return;
            ifStep.cases.push({ conditions: [], steps: [] });
            touch(draft, pId);
          }),
        ),
      removeIfCase: ({
        packId: pId,
        menuId: mId,
        elementId,
        appearanceIndex,
        clickType,
        frames,
        ifStepIndex,
        caseIndex,
      }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const handler = findElementHandler(
              draft,
              pId,
              mId,
              elementId,
              appearanceIndex,
              clickType,
            );
            if (!handler) return;
            const parent = resolveParentMut(handler.steps, frames);
            const ifStep = parent?.[ifStepIndex];
            if (!ifStep || ifStep.kind !== "if") return;
            if (caseIndex < 0 || caseIndex >= ifStep.cases.length) return;
            gcStepLTexts(pack, ifStep.cases[caseIndex]!.steps);
            ifStep.cases.splice(caseIndex, 1);
            touch(draft, pId);
          }),
        ),
      setIfCaseConditions: ({
        packId: pId,
        menuId: mId,
        elementId,
        appearanceIndex,
        clickType,
        frames,
        ifStepIndex,
        caseIndex,
        conditions,
      }) =>
        set(
          produce((draft: AccountState) => {
            const handler = findElementHandler(
              draft,
              pId,
              mId,
              elementId,
              appearanceIndex,
              clickType,
            );
            if (!handler) return;
            const parent = resolveParentMut(handler.steps, frames);
            const ifStep = parent?.[ifStepIndex];
            if (!ifStep || ifStep.kind !== "if") return;
            const c = ifStep.cases[caseIndex];
            if (!c) return;
            c.conditions = conditions;
            touch(draft, pId);
          }),
        ),
      setIfCaseJoin: ({
        packId: pId,
        menuId: mId,
        elementId,
        appearanceIndex,
        clickType,
        frames,
        ifStepIndex,
        caseIndex,
        joinIndex,
        op,
      }) =>
        set(
          produce((draft: AccountState) => {
            const handler = findElementHandler(
              draft,
              pId,
              mId,
              elementId,
              appearanceIndex,
              clickType,
            );
            if (!handler) return;
            const parent = resolveParentMut(handler.steps, frames);
            const ifStep = parent?.[ifStepIndex];
            if (!ifStep || ifStep.kind !== "if") return;
            const c = ifStep.cases[caseIndex];
            if (!c) return;
            const max = Math.max(0, c.conditions.length - 1);
            if (joinIndex < 0 || joinIndex >= max) return;
            if (!c.joins) c.joins = Array(max).fill("and");
            while (c.joins.length < max) c.joins.push("and");
            c.joins[joinIndex] = op;
            touch(draft, pId);
          }),
        ),
      toggleIfElse: ({
        packId: pId,
        menuId: mId,
        elementId,
        appearanceIndex,
        clickType,
        frames,
        ifStepIndex,
        enabled,
      }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const handler = findElementHandler(
              draft,
              pId,
              mId,
              elementId,
              appearanceIndex,
              clickType,
            );
            if (!handler) return;
            const parent = resolveParentMut(handler.steps, frames);
            const ifStep = parent?.[ifStepIndex];
            if (!ifStep || ifStep.kind !== "if") return;
            if (enabled) {
              if (!ifStep.else) ifStep.else = [];
            } else {
              if (ifStep.else) gcStepLTexts(pack, ifStep.else);
              ifStep.else = undefined;
            }
            touch(draft, pId);
          }),
        ),
      addElementClickHandler: ({
        packId: pId,
        menuId: mId,
        elementId,
        appearanceIndex,
        clickType,
      }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            for (const layer of menu.layers) {
              for (const el of layer.elements) {
                if (el.id !== elementId) continue;
                const appearance = el.appearances[appearanceIndex];
                if (!appearance) return;
                if (!appearance.click) appearance.click = {};
                if (!appearance.click[clickType]) {
                  appearance.click[clickType] = { steps: [] };
                  pack.updatedAt = new Date().toISOString();
                }
                return;
              }
            }
          }),
        ),
      removeElementClickHandler: ({
        packId: pId,
        menuId: mId,
        elementId,
        appearanceIndex,
        clickType,
      }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            for (const layer of menu.layers) {
              for (const el of layer.elements) {
                if (el.id !== elementId) continue;
                const appearance = el.appearances[appearanceIndex];
                if (!appearance?.click) return;
                const handler = appearance.click[clickType];
                if (handler) gcStepLTexts(pack, handler.steps);
                delete appearance.click[clickType];
                pack.updatedAt = new Date().toISOString();
                return;
              }
            }
          }),
        ),
      addAppearance: ({ packId: pId, menuId: mId, elementId }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            for (const layer of menu.layers) {
              for (const el of layer.elements) {
                if (el.id !== elementId) continue;
                // Seed with a placeholder permission condition so the new
                // state is clearly conditional and doesn't shadow the
                // default state (which is the one with no `if`).
                el.appearances.push({ if: [{ type: "has_permission", perm: "" }] });
                pack.updatedAt = new Date().toISOString();
                return;
              }
            }
          }),
        ),
      removeAppearance: ({ packId: pId, menuId: mId, elementId, appearanceIndex }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            for (const layer of menu.layers) {
              for (const el of layer.elements) {
                if (el.id !== elementId) continue;
                if (el.appearances.length <= 1) return; // keep at least one
                if (appearanceIndex < 0 || appearanceIndex >= el.appearances.length) return;
                gcAppearanceLTexts(pack, el.appearances[appearanceIndex]!);
                el.appearances.splice(appearanceIndex, 1);
                pack.updatedAt = new Date().toISOString();
                return;
              }
            }
          }),
        ),
      moveAppearance: ({ packId: pId, menuId: mId, elementId, fromIndex, toIndex }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            for (const layer of menu.layers) {
              for (const el of layer.elements) {
                if (el.id !== elementId) continue;
                if (
                  fromIndex < 0 ||
                  fromIndex >= el.appearances.length ||
                  toIndex < 0 ||
                  toIndex >= el.appearances.length
                )
                  return;
                const [moved] = el.appearances.splice(fromIndex, 1);
                if (moved) el.appearances.splice(toIndex, 0, moved);
                pack.updatedAt = new Date().toISOString();
                return;
              }
            }
          }),
        ),
      setAppearanceConditions: ({
        packId: pId,
        menuId: mId,
        elementId,
        appearanceIndex,
        conditions,
      }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            for (const layer of menu.layers) {
              for (const el of layer.elements) {
                if (el.id !== elementId) continue;
                const appearance = el.appearances[appearanceIndex];
                if (!appearance) return;
                appearance.if = conditions.length > 0 ? conditions : undefined;
                // Trim joins past the new conditions length so the array
                // doesn't carry stale entries when conditions shrink.
                const maxJoins = Math.max(0, conditions.length - 1);
                if (appearance.ifJoins) {
                  if (maxJoins === 0) appearance.ifJoins = undefined;
                  else if (appearance.ifJoins.length > maxJoins)
                    appearance.ifJoins.length = maxJoins;
                }
                pack.updatedAt = new Date().toISOString();
                return;
              }
            }
          }),
        ),
      setAppearanceJoin: ({
        packId: pId,
        menuId: mId,
        elementId,
        appearanceIndex,
        joinIndex,
        op,
      }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            for (const layer of menu.layers) {
              for (const el of layer.elements) {
                if (el.id !== elementId) continue;
                const appearance = el.appearances[appearanceIndex];
                if (!appearance) return;
                const max = Math.max(0, (appearance.if?.length ?? 0) - 1);
                if (joinIndex < 0 || joinIndex >= max) return;
                if (!appearance.ifJoins) appearance.ifJoins = Array(max).fill("and");
                while (appearance.ifJoins.length < max) appearance.ifJoins.push("and");
                appearance.ifJoins[joinIndex] = op;
                pack.updatedAt = new Date().toISOString();
                return;
              }
            }
          }),
        ),
      setCommandStep: ({ packId: pId, commandId: cId, path, step, lang }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const cmd = findCommand(draft, pId, cId);
            if (!cmd) return;
            const parent = resolveParentMut(cmd.steps, path.frames);
            if (!parent || path.index < 0 || path.index >= parent.length) return;
            gcStepLTexts(pack, [parent[path.index]!]);
            parent[path.index] = step;
            allocStepLTexts(pack, cmd.steps, lang, commandKeyPrefix(cId));
            touch(draft, pId);
          }),
        ),
      addCommandStep: ({ packId: pId, commandId: cId, frames, index, step, lang }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const cmd = findCommand(draft, pId, cId);
            if (!cmd) return;
            const parent = resolveParentMut(cmd.steps, frames);
            if (!parent) return;
            const at = index < 0 || index > parent.length ? parent.length : index;
            parent.splice(at, 0, step);
            allocStepLTexts(pack, cmd.steps, lang, commandKeyPrefix(cId));
            touch(draft, pId);
          }),
        ),
      removeCommandStep: ({ packId: pId, commandId: cId, path }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const cmd = findCommand(draft, pId, cId);
            if (!cmd) return;
            const parent = resolveParentMut(cmd.steps, path.frames);
            if (!parent || path.index < 0 || path.index >= parent.length) return;
            gcStepLTexts(pack, [parent[path.index]!]);
            parent.splice(path.index, 1);
            touch(draft, pId);
          }),
        ),
      moveCommandStep: ({ packId: pId, commandId: cId, frames, fromIndex, toIndex }) =>
        set(
          produce((draft: AccountState) => {
            const cmd = findCommand(draft, pId, cId);
            if (!cmd) return;
            const parent = resolveParentMut(cmd.steps, frames);
            if (!parent) return;
            if (fromIndex < 0 || fromIndex >= parent.length) return;
            if (toIndex < 0 || toIndex >= parent.length) return;
            const [moved] = parent.splice(fromIndex, 1);
            if (moved) parent.splice(toIndex, 0, moved);
            touch(draft, pId);
          }),
        ),
      addCommandIfCase: ({ packId: pId, commandId: cId, frames, ifStepIndex }) =>
        set(
          produce((draft: AccountState) => {
            const cmd = findCommand(draft, pId, cId);
            if (!cmd) return;
            const parent = resolveParentMut(cmd.steps, frames);
            const ifStep = parent?.[ifStepIndex];
            if (!ifStep || ifStep.kind !== "if") return;
            ifStep.cases.push({ conditions: [], steps: [] });
            touch(draft, pId);
          }),
        ),
      removeCommandIfCase: ({ packId: pId, commandId: cId, frames, ifStepIndex, caseIndex }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const cmd = findCommand(draft, pId, cId);
            if (!cmd) return;
            const parent = resolveParentMut(cmd.steps, frames);
            const ifStep = parent?.[ifStepIndex];
            if (!ifStep || ifStep.kind !== "if") return;
            if (caseIndex < 0 || caseIndex >= ifStep.cases.length) return;
            gcStepLTexts(pack, ifStep.cases[caseIndex]!.steps);
            ifStep.cases.splice(caseIndex, 1);
            touch(draft, pId);
          }),
        ),
      setCommandIfCaseConditions: ({
        packId: pId,
        commandId: cId,
        frames,
        ifStepIndex,
        caseIndex,
        conditions,
      }) =>
        set(
          produce((draft: AccountState) => {
            const cmd = findCommand(draft, pId, cId);
            if (!cmd) return;
            const parent = resolveParentMut(cmd.steps, frames);
            const ifStep = parent?.[ifStepIndex];
            if (!ifStep || ifStep.kind !== "if") return;
            const c = ifStep.cases[caseIndex];
            if (!c) return;
            c.conditions = conditions;
            touch(draft, pId);
          }),
        ),
      setCommandIfCaseJoin: ({
        packId: pId,
        commandId: cId,
        frames,
        ifStepIndex,
        caseIndex,
        joinIndex,
        op,
      }) =>
        set(
          produce((draft: AccountState) => {
            const cmd = findCommand(draft, pId, cId);
            if (!cmd) return;
            const parent = resolveParentMut(cmd.steps, frames);
            const ifStep = parent?.[ifStepIndex];
            if (!ifStep || ifStep.kind !== "if") return;
            const c = ifStep.cases[caseIndex];
            if (!c) return;
            const max = Math.max(0, c.conditions.length - 1);
            if (joinIndex < 0 || joinIndex >= max) return;
            if (!c.joins) c.joins = Array(max).fill("and");
            while (c.joins.length < max) c.joins.push("and");
            c.joins[joinIndex] = op;
            touch(draft, pId);
          }),
        ),
      toggleCommandIfElse: ({ packId: pId, commandId: cId, frames, ifStepIndex, enabled }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const cmd = findCommand(draft, pId, cId);
            if (!cmd) return;
            const parent = resolveParentMut(cmd.steps, frames);
            const ifStep = parent?.[ifStepIndex];
            if (!ifStep || ifStep.kind !== "if") return;
            if (enabled) {
              if (!ifStep.else) ifStep.else = [];
            } else {
              if (ifStep.else) gcStepLTexts(pack, ifStep.else);
              ifStep.else = undefined;
            }
            touch(draft, pId);
          }),
        ),
      addElement: ({ packId: pId, menuId: mId, element }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            const newPositions = parsePositions(element.positions);
            for (const layer of menu.layers) {
              for (const otherEl of layer.elements) {
                for (const p of newPositions) {
                  if (positionsContains(otherEl.positions, p)) {
                    otherEl.positions = removePosition(otherEl.positions, p);
                  }
                }
              }
              layer.elements = layer.elements.filter((el) => el.positions !== "");
            }
            let firstLayer: Layer | undefined = menu.layers[0];
            if (!firstLayer) {
              firstLayer = { id: newLayerId(), name: "default", elements: [] };
              menu.layers.push(firstLayer);
            }
            // Renumber the id following the material_N scheme so paste/duplicate
            // doesn't leak the random `el_<n>_<ts>` id from the clipboard. The
            // raw nanoid would surface in YAML files and breaks the visual
            // grouping admins rely on (`diamond_sword_1`, `_2`, …).
            const materialForId = element.appearances[0]?.material ?? undefined;
            const renumberedId = nextElementIdForMaterial(pack, materialForId);
            // Clone LText keys so the added element never shares keys with its source.
            // Without this, rekeyPack at deploy time would delete the shared key,
            // breaking the original element's translations.
            const elementToAdd: Element = {
              ...element,
              id: renumberedId,
              positions: formatPositions(newPositions),
              appearances: element.appearances.map((a) => {
                const cloned = { ...a };
                if (a.title) {
                  const src = pack.i18nKeys[a.title.key];
                  cloned.title = createLText(pack, "", pack.defaultLang);
                  if (src) pack.i18nKeys[cloned.title.key] = { ...src };
                }
                if (a.lore) {
                  const src = pack.i18nKeys[a.lore.key];
                  cloned.lore = createLText(pack, "", pack.defaultLang);
                  if (src) pack.i18nKeys[cloned.lore.key] = { ...src };
                }
                if (a.click) {
                  const click = { ...a.click };
                  for (const handler of Object.values(click)) {
                    if (!handler) continue;
                    for (const action of walkActions(handler.steps)) {
                      if (action.type === "send_message" || action.type === "broadcast") {
                        const src = pack.i18nKeys[action.text.key];
                        action.text = createLText(pack, "", pack.defaultLang);
                        if (src) pack.i18nKeys[action.text.key] = { ...src };
                      } else if (action.type === "show_title") {
                        const srcT = pack.i18nKeys[action.title.key];
                        action.title = createLText(pack, "", pack.defaultLang);
                        if (srcT) pack.i18nKeys[action.title.key] = { ...srcT };
                        if (action.subtitle) {
                          const srcS = pack.i18nKeys[action.subtitle.key];
                          action.subtitle = createLText(pack, "", pack.defaultLang);
                          if (srcS) pack.i18nKeys[action.subtitle.key] = { ...srcS };
                        }
                      }
                    }
                  }
                  cloned.click = click;
                }
                return cloned;
              }),
            };
            firstLayer.elements.push(elementToAdd);
            pack.updatedAt = new Date().toISOString();
          }),
        ),
      moveSelectionByDelta: ({ packId: pId, menuId: mId, elementIds, dCol, dRow }) => {
        const next = produce(get().account, (draft) => {
          const pack = draft.packs.find((p) => p.id === pId);
          if (!pack) return;
          const menu = pack.menus.find((m) => m.id === mId);
          if (!menu) return;
          const targetSet = new Set(elementIds);
          // Grid is type-dependent: chest 9×rows, hopper 5×1, dropper 3×3.
          const type = menu.inventoryType ?? "chest";
          const cols = colsFor(type);
          const rows = rowsFor(type, menu.rows);
          // First pass: compute new positions and validate bounds.
          const plans = new Map<ElementId, number[]>();
          for (const layer of menu.layers) {
            for (const el of layer.elements) {
              if (!targetSet.has(el.id)) continue;
              const newPositions: number[] = [];
              for (const p of parsePositions(el.positions)) {
                const newCol = (p % cols) + dCol;
                const newRow = Math.floor(p / cols) + dRow;
                if (newCol < 0 || newCol >= cols || newRow < 0 || newRow >= rows) {
                  throw new Error("selection drag would land outside the menu");
                }
                newPositions.push(newRow * cols + newCol);
              }
              plans.set(el.id, newPositions);
            }
          }
          if (plans.size === 0) return;
          // Strip new positions from non-target elements (takeover).
          const claimed = new Set<number>();
          for (const ps of plans.values()) for (const p of ps) claimed.add(p);
          for (const layer of menu.layers) {
            for (const otherEl of layer.elements) {
              if (targetSet.has(otherEl.id)) continue;
              const filtered = parsePositions(otherEl.positions).filter((p) => !claimed.has(p));
              otherEl.positions = formatPositions(filtered);
            }
            layer.elements = layer.elements.filter((el) => el.positions !== "");
          }
          // Apply new positions to target elements.
          for (const layer of menu.layers) {
            for (const el of layer.elements) {
              const plan = plans.get(el.id);
              if (plan) el.positions = formatPositions(plan);
            }
          }
          pack.updatedAt = new Date().toISOString();
        });
        set({ account: next });
      },
      setAppearanceLore: ({
        packId: pId,
        menuId: mId,
        elementId,
        appearanceIndex = 0,
        lang,
        value,
      }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            for (const layer of menu.layers) {
              for (const el of layer.elements) {
                if (el.id !== elementId) continue;
                const appearance = el.appearances[appearanceIndex];
                if (!appearance) return;
                if (!appearance.lore) {
                  appearance.lore = value
                    ? createLTextAt(
                        pack,
                        elementLoreKey(mId, elementId, appearanceIndex),
                        value,
                        lang,
                      )
                    : undefined;
                } else if (value) {
                  setLText(pack, appearance.lore, lang, value);
                } else {
                  deleteLText(pack, appearance.lore);
                  appearance.lore = undefined;
                }
                pack.updatedAt = new Date().toISOString();
                return;
              }
            }
          }),
        ),
      clearSlot: ({ packId: pId, menuId: mId, position }) =>
        set(
          produce((draft: AccountState) => {
            const pack = draft.account.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            for (const layer of menu.layers) {
              const idx = layer.elements.findIndex((el) =>
                positionsContains(el.positions, position),
              );
              if (idx === -1) continue;
              const el = layer.elements[idx]!;
              const remaining = removePosition(el.positions, position);
              if (remaining === "") {
                // Last position — drop the element entirely.
                gcElementLTexts(pack, el);
                layer.elements.splice(idx, 1);
              } else {
                el.positions = remaining;
              }
              pack.updatedAt = new Date().toISOString();
              return;
            }
          }),
        ),
      pasteEntities: ({ packId: pId, menus, commands, offset }) => {
        const next = produce(get().account, (draft) => {
          const pack = draft.packs.find((p) => p.id === pId);
          if (!pack) return;
          // Clone every LText held by the pasted entities under fresh
          // keys, copying the value map from the source. Otherwise the
          // copies would share keys with the originals — editing one
          // would silently alter the other.
          const cloneAppearanceLTexts = (a: Appearance) => {
            if (a.title) {
              const src = pack.i18nKeys[a.title.key];
              a.title = createLText(pack, "", pack.defaultLang);
              if (src) pack.i18nKeys[a.title.key] = { ...src };
            }
            if (a.lore) {
              const src = pack.i18nKeys[a.lore.key];
              a.lore = createLText(pack, "", pack.defaultLang);
              if (src) pack.i18nKeys[a.lore.key] = { ...src };
            }
            if (a.click) {
              for (const handler of Object.values(a.click)) {
                if (!handler) continue;
                for (const action of walkActions(handler.steps)) {
                  if (action.type === "send_message" || action.type === "broadcast") {
                    const src = pack.i18nKeys[action.text.key];
                    action.text = createLText(pack, "", pack.defaultLang);
                    if (src) pack.i18nKeys[action.text.key] = { ...src };
                  } else if (action.type === "show_title") {
                    const srcT = pack.i18nKeys[action.title.key];
                    action.title = createLText(pack, "", pack.defaultLang);
                    if (srcT) pack.i18nKeys[action.title.key] = { ...srcT };
                    if (action.subtitle) {
                      const srcS = pack.i18nKeys[action.subtitle.key];
                      action.subtitle = createLText(pack, "", pack.defaultLang);
                      if (srcS) pack.i18nKeys[action.subtitle.key] = { ...srcS };
                    }
                  }
                }
              }
            }
          };
          for (const m of menus) {
            const stamped: Menu = { ...m, packId: pId };
            // Clone each text layer's LText under a fresh key, copying the
            // value map so the pasted copy doesn't share keys with the original.
            stamped.title = stamped.title.map((titleLayer) => {
              if (titleLayer.kind !== "text") return titleLayer;
              const src = pack.i18nKeys[titleLayer.value.key];
              const cloned = createLText(pack, "", pack.defaultLang);
              if (src) pack.i18nKeys[cloned.key] = { ...src };
              return { ...titleLayer, value: cloned };
            });
            for (const layer of stamped.layers) {
              for (const el of layer.elements) {
                for (const a of el.appearances) cloneAppearanceLTexts(a);
              }
            }
            pack.menus.push(stamped);
            rekeyMenu(pack, stamped);
            (pack.canvasLayout as Record<string, { x: number; y: number }>)[stamped.id] = {
              x: offset.x,
              y: offset.y,
            };
            offset.x += 24;
            offset.y += 24;
          }
          for (const c of commands) {
            const stamped: Command = { ...c, packId: pId };
            for (const action of walkActions(stamped.steps)) {
              if (action.type === "send_message" || action.type === "broadcast") {
                const src = pack.i18nKeys[action.text.key];
                action.text = createLText(pack, "", pack.defaultLang);
                if (src) pack.i18nKeys[action.text.key] = { ...src };
              } else if (action.type === "show_title") {
                const srcT = pack.i18nKeys[action.title.key];
                action.title = createLText(pack, "", pack.defaultLang);
                if (srcT) pack.i18nKeys[action.title.key] = { ...srcT };
                if (action.subtitle) {
                  const srcS = pack.i18nKeys[action.subtitle.key];
                  action.subtitle = createLText(pack, "", pack.defaultLang);
                  if (srcS) pack.i18nKeys[action.subtitle.key] = { ...srcS };
                }
              }
            }
            pack.commands.push(stamped);
            rekeyCommand(pack, stamped);
            (pack.canvasLayout as Record<string, { x: number; y: number }>)[stamped.id] = {
              x: offset.x,
              y: offset.y,
            };
            offset.x += 24;
            offset.y += 24;
          }
        });
        set({ account: next });
      },
      addPackDataSource: ({ packId }) =>
        set((state) =>
          produce(state, (draft) => {
            const pack = draft.account.packs.find((p) => p.id === packId);
            if (!pack) return;
            if (!pack.dataSources) pack.dataSources = [];
            const id = generateDataSourceId();
            const name = nextAvailableName(pack.dataSources, "new_source");
            const value: unknown[] = [];
            const type: FieldType = { kind: "list", of: { kind: "string" } };
            pack.dataSources.push({ id, name, type, value });
          }),
        ),
      removePackDataSource: ({ packId, id }) =>
        set((state) =>
          produce(state, (draft) => {
            const pack = draft.account.packs.find((p) => p.id === packId);
            if (!pack) return;
            pack.dataSources = pack.dataSources.filter((d) => d.id !== id);
          }),
        ),
      renamePackDataSource: ({ packId, id, newName }) =>
        set((state) =>
          produce(state, (draft) => {
            const pack = draft.account.packs.find((p) => p.id === packId);
            if (!pack) return;
            const ds = pack.dataSources.find((d) => d.id === id);
            if (ds) ds.name = newName;
          }),
        ),
      setPackDataSourceYaml: ({ packId, id, yaml }) =>
        set((state) =>
          produce(state, (draft) => {
            const pack = draft.account.packs.find((p) => p.id === packId);
            if (!pack) return;
            const ds = pack.dataSources.find((d) => d.id === id);
            if (!ds) return;
            const parsed = parseYaml(yaml);
            ds.value = parsed ?? [];
            ds.type = inferFieldTypeFromValue(ds.value);
          }),
        ),
      addImportedConnector: ({ packId, spec }) =>
        set((state) =>
          produce(state, (draft) => {
            const pack = draft.account.packs.find((p) => p.id === packId);
            if (!pack) return;
            pack.importedConnectors ??= [];
            const idx = pack.importedConnectors.findIndex((c) => c.ref === spec.ref);
            if (idx >= 0) pack.importedConnectors[idx] = spec;
            else pack.importedConnectors.push(spec);
          }),
        ),
      removeImportedConnector: ({ packId, ref }) =>
        set((state) =>
          produce(state, (draft) => {
            const pack = draft.account.packs.find((p) => p.id === packId);
            if (!pack) return;
            pack.importedConnectors = pack.importedConnectors.filter((c) => c.ref !== ref);
          }),
        ),
      deleteFromPack: ({ packId: pId, nodeIds }) => {
        const ids = new Set(nodeIds);
        const next = produce(get().account, (draft) => {
          const pack = draft.packs.find((p) => p.id === pId);
          if (!pack) return;
          for (const m of pack.menus) {
            if (ids.has(m.id)) gcMenuLTexts(pack, m);
          }
          for (const c of pack.commands) {
            if (ids.has(c.id)) gcCommandLTexts(pack, c);
          }
          for (const d of pack.dialogs) {
            if (ids.has(d.id)) gcDialogLTexts(pack, d);
          }
          pack.menus = pack.menus.filter((m) => !ids.has(m.id));
          pack.commands = pack.commands.filter((c) => !ids.has(c.id));
          pack.dialogs = pack.dialogs.filter((d) => !ids.has(d.id));
          for (const id of ids) {
            delete (pack.canvasLayout as Record<string, { x: number; y: number }>)[id];
          }
          if (pack.canvasEdges) {
            for (const key of Object.keys(pack.canvasEdges)) {
              const [src, tgt] = key.split("->") as [string, string];
              if (ids.has(src) || ids.has(tgt)) delete pack.canvasEdges[key];
            }
          }
        });
        set({ account: next });
      },
    }),
    {
      // Track only the account slice so action references aren't diffed.
      partialize: (state) => ({ account: state.account }),
      // Drop the very-frequent canvasPosition writes from history when the
      // user is just dragging menus around (otherwise undo replays each px).
      // Equality lets temporal collapse identical states.
      equality: (a, b) => a.account === b.account,
      limit: 100,
    },
  ),
);

/** Rekey canvasEdges entries when a node id changes ("a->b" keys embed node ids). */
function rewriteCanvasEdgeIds(pack: Pack, oldId: string, newId: string) {
  if (!pack.canvasEdges) return;
  for (const key of Object.keys(pack.canvasEdges)) {
    const [src, tgt] = key.split("->") as [string, string];
    if (src !== oldId && tgt !== oldId) continue;
    const newKey = `${src === oldId ? newId : src}->${tgt === oldId ? newId : tgt}`;
    pack.canvasEdges[newKey] = pack.canvasEdges[key]!;
    delete pack.canvasEdges[key];
  }
}

// ────────────────────────────────────────────────────────────────────────────
// v1 → v2 migration. v1 had ClickHandler.{requirements?, actions, fallback?}
// and Command.actions; v2 has ClickHandler.steps and Command.steps with the
// recursive Step tree. Wrap the old flat lists; if requirements/fallback are
// present, fold them into a single outer if-step.
//
// We accept `unknown` because zustand's migrate only knows the shape from the
// schema version stored in localStorage — not the current types.
// ────────────────────────────────────────────────────────────────────────────
type V1Action = { type: string; [k: string]: unknown };
type V1ClickHandler = {
  requirements?: unknown[];
  actions: V1Action[];
  fallback?: V1Action[];
};
type V1Command = { actions: V1Action[]; steps?: never; [k: string]: unknown };

const wrapV1Actions = (actions: V1Action[]) =>
  actions.map((action) => ({ kind: "action" as const, action }));

const migrateClickHandler = (h: V1ClickHandler) => {
  const wrappedActions = wrapV1Actions(h.actions ?? []);
  const wrappedFallback = h.fallback ? wrapV1Actions(h.fallback) : undefined;
  const conditions = (h.requirements ?? []) as Condition[];
  if (conditions.length === 0 && !wrappedFallback) {
    return { steps: wrappedActions };
  }
  // Fold gate + chain + fallback into a single outer if-step.
  const ifStep = {
    kind: "if" as const,
    cases: [{ conditions, steps: wrappedActions }],
    else: wrappedFallback,
  };
  return { steps: [ifStep] };
};

/**
 * v3 → v4: collapse `lore: LText[]` (one key per line) into a single
 * `lore: LText` whose i18n value is the lines joined by `\n`. Old
 * per-line keys are GC'd. Each language gets its own joined string so
 * FR and EN can have different line counts going forward.
 */
// biome-ignore lint/suspicious/noExplicitAny: legacy shape — migration only
// @ts-ignore — kept as dead code; was used by persist middleware
const migrateV3ToV4 = (persisted: unknown): unknown => {
  if (!persisted || typeof persisted !== "object") return persisted;
  // biome-ignore lint/suspicious/noExplicitAny: legacy shape
  const account = (persisted as any).account;
  if (!account) return persisted;

  // biome-ignore lint/suspicious/noExplicitAny: legacy shape
  const migrateAppearance = (appearance: any, i18nKeys: any) => {
    if (!Array.isArray(appearance.lore)) return;
    const arr: Array<{ key: string }> = appearance.lore;
    if (arr.length === 0) {
      appearance.lore = undefined;
      return;
    }
    // Collect every language present across all old keys
    const langs = new Set<string>();
    for (const lt of arr) {
      const entry = i18nKeys[lt.key];
      if (entry && typeof entry === "object") {
        for (const lang of Object.keys(entry)) langs.add(lang);
      }
    }
    // Build new key
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let newKey: string;
    do {
      newKey = `lt_${Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")}`;
    } while (i18nKeys[newKey]);
    i18nKeys[newKey] = {};
    for (const lang of langs) {
      const lines = arr.map((lt) => i18nKeys[lt.key]?.[lang] ?? "");
      i18nKeys[newKey][lang] = lines.join("\n");
    }
    // GC old per-line keys
    for (const lt of arr) delete i18nKeys[lt.key];
    appearance.lore = { key: newKey };
  };

  for (const pack of account.packs ?? []) {
    const i18nKeys = pack.i18nKeys ?? {};
    for (const menu of pack.menus ?? []) {
      for (const layer of menu.layers ?? []) {
        for (const el of layer.elements ?? []) {
          for (const appearance of el.appearances ?? []) {
            migrateAppearance(appearance, i18nKeys);
          }
        }
      }
    }
    for (const tpl of pack.templates ?? []) {
      for (const appearance of tpl.appearances ?? []) {
        migrateAppearance(appearance, i18nKeys);
      }
    }
  }
  return persisted;
};

/**
 * v4 → v5: convert opaque `lt_xxx` i18n keys to semantic dotted-path keys
 * (e.g. `menus.shop_main.title`). Uses `rekeyPack` from `@/domain/i18nSites`
 * to canonicalize every LText key in each pack.
 */
// biome-ignore lint/suspicious/noExplicitAny: legacy shape — migration only
// @ts-ignore — kept as dead code; was used by persist middleware
const migrateV4ToV5 = (persisted: unknown): unknown => {
  if (!persisted || typeof persisted !== "object") return persisted;
  // biome-ignore lint/suspicious/noExplicitAny: legacy shape
  const account = (persisted as any).account;
  if (!account) return persisted;
  for (const pack of account.packs ?? []) rekeyPack(pack);
  return persisted;
};

/**
 * v2 → v3: lift every plain user-facing string (menu/appearance titles,
 * lore lines, send_message text) into an `LText` ref, populating
 * `pack.i18nKeys[key][pack.defaultLang]` with the original value. The
 * actual walker lives in `lib/i18nMigration` so it can be reused for
 * imported packs at runtime.
 */
// @ts-ignore — kept as dead code; was used by persist middleware
const migrateV2ToV3 = (persisted: unknown): unknown => {
  if (!persisted || typeof persisted !== "object") return persisted;
  // biome-ignore lint/suspicious/noExplicitAny: legacy shape
  const account = (persisted as any).account;
  if (!account) return persisted;
  for (const pack of account.packs ?? []) {
    migratePackToI18n(pack, pack.defaultLang ?? "en");
  }
  return persisted;
};

// @ts-ignore — kept as dead code; was used by persist middleware
const migrateV1ToV2 = (persisted: unknown): unknown => {
  if (!persisted || typeof persisted !== "object") return persisted;
  // biome-ignore lint/suspicious/noExplicitAny: legacy v1 shape — we don't model it in TS
  const account = (persisted as any).account;
  if (!account) return persisted;
  for (const pack of account.packs ?? []) {
    for (const menu of pack.menus ?? []) {
      for (const layer of menu.layers ?? []) {
        for (const el of layer.elements ?? []) {
          for (const appearance of el.appearances ?? []) {
            const clickMap = appearance.click;
            if (!clickMap) continue;
            for (const key of Object.keys(clickMap)) {
              const handler = clickMap[key];
              if (handler && "actions" in handler) {
                clickMap[key] = migrateClickHandler(handler);
              }
            }
          }
        }
      }
    }
    for (const cmd of pack.commands ?? []) {
      const v1 = cmd as V1Command;
      if (Array.isArray(v1.actions)) {
        cmd.steps = wrapV1Actions(v1.actions);
        cmd.actions = undefined;
      }
    }
  }
  return persisted;
};
