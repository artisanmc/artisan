import {
  type FieldEdit,
  type FieldEditTarget,
  applyFieldEdit,
  defaultValueForModelType,
  isDataModelReferenced,
  normalizeDataSourceName,
  releaseValueLTexts,
  sourceRootFields,
  sourceTypeAtPath,
  wouldTypeCreateModelCycle,
} from "@/domain/dataModels";
import { nextAvailableSourceRowKey, validateSourceRowKey } from "@/domain/dataSourceRowKeys";
import { addressedAppearances, appearanceAt } from "@/domain/element";
import {
  mintLTexts,
  rekeyCommand,
  rekeyDataSource,
  rekeyMenu,
  rekeyProject,
  releaseLTexts,
  visitAppearanceLTexts,
  visitCommandLTexts,
  visitDataSourceLTexts,
  visitDialogLTexts,
  visitElementLTexts,
  visitMenuLTexts,
  visitStepLTexts,
} from "@/domain/i18nSites";
import {
  commandId,
  newCommandId,
  newDataModelId,
  newElementId,
  newLayerId,
  newProjectId,
} from "@/domain/ids";
import type { AdvancedFields } from "@/domain/itemAdvanced";
import { migrateTitle } from "@/domain/migrateTitle";
import { type StepFrame, type StepPath, resolveParentMut, walkActions } from "@/domain/stepPath";
import type {
  Account,
  Action,
  Appearance,
  CapturedItem,
  CapturedItemId,
  ClickType,
  Command,
  CommandArg,
  CommandId,
  Condition,
  ContextInput,
  DataModelId,
  DataSource,
  DataSourceId,
  Dialog,
  DialogBody,
  DialogId,
  DialogInput,
  EdgeAnchor,
  Element,
  ElementId,
  I18nKey,
  InventoryType,
  LText,
  Layer,
  Menu,
  MenuId,
  MenuTitleLayer,
  Placement,
  Project,
  ProjectId,
  SourceRef,
  Step,
} from "@/domain/types";
import { gridArrange } from "@/features/canvas/autoLayout";
import { colsFor, rowsFor, slotCount } from "@/features/canvas/inventoryTypes";
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
import { migrateProjectToI18n } from "@/lib/i18nMigration";
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
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { current, produce } from "immer";
import { temporal } from "zundo";
import { create } from "zustand";

type MenuRows = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Where an appearance lives — always a menu element. Kept as a named type
 * because the appearance/click/step reducers and the editing UI (state cards,
 * pseudocode click editor) all address appearances through it.
 */
export type AppearanceTarget = { menuId: MenuId; elementId: ElementId };

export type SourceValueUpdateResult =
  | { ok: true }
  | { ok: false; reason: "required_row_key" | "duplicate_row_key" };

interface AccountState {
  account: Account;
  setAccount: (account: Account) => void;
  createProject: (input: { id: string }) => ProjectId;
  /**
   * Import a project object as a *new* project: assigns a fresh ProjectId, marks
   * source=imported, retags every contained menu/command with the new
   * projectId. Throws on malformed input.
   */
  importProject: (input: { project: Project }) => ProjectId;
  replaceProject: (project: Project) => void;
  /**
   * Write a module's namespace in Project.moduleData, replacing its prior
   * value wholesale. Other modules' namespaces are preserved.
   */
  setModuleData: (projectId: ProjectId, moduleId: string, data: unknown) => void;
  /**
   * Apply an AI-generated menu/v1: convert to domain, insert/replace in the
   * project, merge i18n. Returns the constructs dropped during conversion (no
   * domain equivalent) so the caller can warn instead of losing them silently.
   */
  applyAssistantMenu: (input: {
    projectId: ProjectId;
    menuV1: Record<string, unknown>;
    lang: string;
  }) => string[];
  /** Apply an AI-generated command/v1: convert + insert/replace + merge i18n. Returns dropped constructs. */
  applyAssistantCommand: (input: {
    projectId: ProjectId;
    commandV1: Record<string, unknown>;
    lang: string;
  }) => string[];
  /** Apply an AI-generated dialog/v1: convert + insert/replace + merge i18n. Returns dropped constructs. */
  applyAssistantDialog: (input: {
    projectId: ProjectId;
    dialogV1: Record<string, unknown>;
    lang: string;
  }) => string[];
  /**
   * Apply an AI `write_translations` event: merge per-key/per-lang values into
   * `i18nKeys`. Only the listed pairs change — other languages of the same key
   * are preserved.
   */
  applyAssistantTranslations: (input: {
    projectId: ProjectId;
    entries: Record<string, Record<string, string>>;
  }) => void;
  /**
   * Create a new menu in `projectId` with sensible defaults (rows=3, single
   * default layer, no elements). Optional canvas position; falls back to
   * autoLayout's grid if omitted. Returns the new id so callers can route
   * to it.
   */
  createMenu: (input: {
    projectId: ProjectId;
    id: string;
    rows?: MenuRows;
    position?: { x: number; y: number };
  }) => MenuId;
  /**
   * Create a new command in `projectId` with sensible defaults (no args, no
   * steps). Returns the new id.
   */
  createCommand: (input: {
    projectId: ProjectId;
    id?: string;
    name?: string;
    position?: { x: number; y: number };
  }) => CommandId;
  createDialog: (input: {
    projectId: ProjectId;
    id: string;
    position?: { x: number; y: number };
  }) => DialogId;
  setDialogTitle: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    lang: string;
    value: string;
  }) => void;
  setDialogField: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    field: "canCloseWithEscape";
    value: boolean;
  }) => void;
  setDialogId: (input: { projectId: ProjectId; oldId: DialogId; newId: DialogId }) => void;
  addDialogBody: (input: { projectId: ProjectId; dialogId: DialogId; body: DialogBody }) => void;
  removeDialogBody: (input: { projectId: ProjectId; dialogId: DialogId; index: number }) => void;
  setDialogBodyText: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    index: number;
    lang: string;
    value: string;
  }) => void;
  setDialogBodyMaterial: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    index: number;
    material: string;
    count: number;
  }) => void;
  addDialogInput: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    inputType: DialogInput["type"];
  }) => void;
  removeDialogInput: (input: { projectId: ProjectId; dialogId: DialogId; index: number }) => void;
  setDialogInput: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    index: number;
    patch: Partial<DialogInput>;
  }) => void;
  addDialogButton: (input: { projectId: ProjectId; dialogId: DialogId }) => void;
  removeDialogButton: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    buttonIndex: number;
  }) => void;
  setDialogButtonLabel: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    buttonIndex: number;
    lang: string;
    value: string;
  }) => void;
  addDialogButtonStep: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    buttonIndex: number;
    frames: StepFrame[];
    index: number;
    step: Step;
    lang: string;
  }) => void;
  moveDialogButtonStep: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    buttonIndex: number;
    frames: StepFrame[];
    fromIndex: number;
    toIndex: number;
  }) => void;
  setDialogButtonStep: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    buttonIndex: number;
    path: StepPath;
    step: Step;
    lang: string;
  }) => void;
  removeDialogButtonStep: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    buttonIndex: number;
    path: StepPath;
  }) => void;
  addDialogButtonIfCase: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    buttonIndex: number;
    frames: StepFrame[];
    ifStepIndex: number;
  }) => void;
  removeDialogButtonIfCase: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    buttonIndex: number;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
  }) => void;
  setDialogButtonIfCaseConditions: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    buttonIndex: number;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
    conditions: Condition[];
    op?: "and" | "or";
  }) => void;
  setDialogButtonIfCaseJoin: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    buttonIndex: number;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
    joinIndex: number;
    op: "and" | "or";
  }) => void;
  toggleDialogButtonIfElse: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    buttonIndex: number;
    frames: StepFrame[];
    ifStepIndex: number;
    lang: string;
    enabled: boolean;
  }) => void;
  removeProject: (projectId: ProjectId) => void;
  /** Insert/replace a Config-screen scratch working copy (never persisted — ADR module-config-screens). */
  upsertScratchProject: (project: Project) => void;
  reorderProjects: (newOrder: ProjectId[]) => void;
  moveMenuToProject: (input: {
    menuId: MenuId;
    fromProjectId: ProjectId;
    toProjectId: ProjectId;
  }) => void;
  setCanvasPosition: (input: {
    projectId: ProjectId;
    nodeId: string;
    x: number;
    y: number;
  }) => void;
  addToBoard: (input: { projectId: ProjectId; nodeId: string; x: number; y: number }) => void;
  removeFromBoard: (input: { projectId: ProjectId; nodeId: string }) => void;
  arrangeAllOnBoard: (input: { projectId: ProjectId }) => void;
  /** Override one endpoint of a canvas edge ("source->target" id). */
  setEdgeAnchor: (input: {
    projectId: ProjectId;
    edgeId: string;
    end: "from" | "to";
    anchor: EdgeAnchor;
  }) => void;
  /** Remove an endpoint override; drops the entry when both ends are auto again. */
  clearEdgeAnchor: (input: { projectId: ProjectId; edgeId: string; end: "from" | "to" }) => void;
  deleteFromProject: (input: { projectId: ProjectId; nodeIds: string[] }) => void;
  setProjectField: (input: {
    projectId: ProjectId;
    field: "name" | "description";
    value: string;
  }) => void;
  setMenuField: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    field: "permission" | "rows" | "inventoryType";
    value: string | MenuRows;
  }) => void;
  /** Update the menu's title in the given language. Writes into the first text layer (or prepends one). */
  setMenuTitle: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    lang: string;
    value: string;
  }) => void;
  /** Replace the entire title layer array. */
  setMenuTitleLayers: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    layers: MenuTitleLayer[];
  }) => void;
  /** Patch a single title layer by index. */
  updateMenuTitleLayer: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    index: number;
    patch: Partial<MenuTitleLayer>;
  }) => void;
  /** Append a new title layer. */
  addMenuTitleLayer: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    layer: MenuTitleLayer;
  }) => void;
  /** Remove the title layer at `index`. */
  removeMenuTitleLayer: (input: { projectId: ProjectId; menuId: MenuId; index: number }) => void;
  /** Move a title layer from `fromIndex` to `toIndex`. */
  reorderMenuTitleLayers: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    fromIndex: number;
    toIndex: number;
  }) => void;
  setCommandField: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    field: "name" | "permission" | "description";
    value: string;
  }) => void;
  setCommandAliases: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    aliases: string[];
  }) => void;
  /** Replace an entire command object in place (whole-command update). */
  updateCommand: (input: { projectId: ProjectId; command: Command }) => void;
  /** Replace an entire dialog object in place (whole-dialog update). */
  updateDialog: (input: { projectId: ProjectId; dialog: Dialog }) => void;
  /** Append a new argument at the end of a command's argument list. */
  addCommandArg: (input: { projectId: ProjectId; commandId: CommandId; arg?: CommandArg }) => void;
  /** Replace the argument at `index` (whole-arg replace; immer drafts handle the merge). */
  setCommandArg: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    index: number;
    arg: CommandArg;
  }) => void;
  removeCommandArg: (input: { projectId: ProjectId; commandId: CommandId; index: number }) => void;
  /** Append a new context input to a menu (auto-named ctxN). */
  addMenuContextInput: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    kind?: "primitive" | "sourceRef";
  }) => void;
  setMenuContextInput: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    index: number;
    input: ContextInput;
  }) => void;
  removeMenuContextInput: (input: { projectId: ProjectId; menuId: MenuId; index: number }) => void;
  /** Element iteration: bind this element's slots to a list source in the menu context. */
  setElementIterates: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    elementId: ElementId;
    iterates: { source: string; alias: string } | undefined;
  }) => void;
  /**
   * Placement mode: set (or clear with `undefined`) this element's `places` binding.
   * Mutually exclusive with iteration — setting it clears `iterates`.
   */
  setElementPlaces: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    elementId: ElementId;
    places: Element["places"] | undefined;
  }) => void;
  /** Upsert a single Placement (matched by `key`) into an element's `places`. No-op if not in placement mode. */
  setElementPlacement: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    elementId: ElementId;
    placement: Placement;
  }) => void;
  /** Remove the Placement with the given `key` from an element's `places`. */
  removeElementPlacement: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    elementId: ElementId;
    key: string;
  }) => void;
  /** Captured items — upsert by id (a re-capture replaces the entry). */
  addCapturedItem: (input: { projectId: ProjectId; item: CapturedItem }) => void;
  removeCapturedItem: (input: { projectId: ProjectId; itemId: CapturedItemId }) => void;
  /**
   * Create THE set d'items of one menu list (Données du menu) — a
   * SELF-CONTAINED element (no Item template): appearances seeded from the
   * source's schema heuristics (icon/name/price), i18n minted canonically.
   * `iterates` auto-fills a slot range; `places` starts empty and is fed by
   * the contextual placement panel. One set per (menu, list).
   */
  createMenuSet: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    inputName: string;
    mode: "iterates" | "places";
    keyField?: string;
    alias?: string;
    schema: { name: string }[];
    positions?: string;
  }) => { ok: true; elementId: string } | { ok: false; reason: "not_found" | "already_exists" };
  /**
   * Rename a menu's id. Rejects if newId already exists in the project.
   * Atomically rewrites all `open_menu` refs in the project and the
   * canvasLayout key. Cross-project refs to this menu (which we don't track)
   * become dangling — runtime handles.
   */
  setMenuId: (input: { projectId: ProjectId; oldId: MenuId; newId: MenuId }) => void;
  /** Rename a command's id. Rejects if newId already exists in the project. */
  setCommandId: (input: { projectId: ProjectId; oldId: CommandId; newId: CommandId }) => void;
  /** Rename an element's id. Rejects if newId already exists in the same menu. */
  setElementId: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    oldId: ElementId;
    newId: ElementId;
  }) => void;
  setSlotMaterial: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    position: number;
    material: string;
  }) => void;
  /** Removes the element at the given position from the menu's first layer. */
  clearSlot: (input: { projectId: ProjectId; menuId: MenuId; position: number }) => void;
  /** Update a scalar field on the element's appearance at the given index (default 0). */
  setAppearanceField: (
    input: {
      projectId: ProjectId;
      appearanceIndex?: number;
      field: "count" | "material" | "head";
      value: string | number;
    } & AppearanceTarget,
  ) => void;
  /**
   * Patch the advanced detail fields of an appearance (enchants, glint, custom
   * model data, unbreakable, hide flags, tint, raw NBT). A key set to
   * `undefined` clears that field; keys absent from the patch are left alone.
   */
  setAppearanceAdvanced: (
    input: {
      projectId: ProjectId;
      appearanceIndex?: number;
      patch: AdvancedFields;
    } & AppearanceTarget,
  ) => void;
  /** Update an appearance title for the given language. Allocates the LText on first write. */
  setAppearanceTitle: (
    input: {
      projectId: ProjectId;
      appearanceIndex?: number;
      lang: string;
      value: string;
    } & AppearanceTarget,
  ) => void;
  /** Set the lore value (multi-line string, `\n`-separated lines) for an appearance. */
  setAppearanceLore: (
    input: {
      projectId: ProjectId;
      appearanceIndex?: number;
      lang: string;
      value: string;
    } & AppearanceTarget,
  ) => void;
  /**
   * Update the value of an i18n entry under `lang`. Used by every text
   * field whose component already holds the `LText` ref (menu title,
   * appearance title/lore lines, send_message text in actions). Path-
   * based step mutators handle structure; this handles content.
   */
  setI18nValue: (input: { projectId: ProjectId; lt: LText; lang: string; value: string }) => void;
  /** Add a new language to the project (clones empty entries from defaultLang for every existing key). */
  addLanguage: (input: { projectId: ProjectId; lang: string }) => void;
  /** Remove a language and all its translations. No-op on `defaultLang`. */
  removeLanguage: (input: { projectId: ProjectId; lang: string }) => void;
  /**
   * Choose how texts are written on disk: `inline` (the document carries the
   * default language's literal, other languages travel in `lang/` by address)
   * or `extract` (`{i18n:key}` refs everywhere). Pure file shape — no
   * translation is touched. Cf. ADR `files-first-source-of-truth` §4.
   */
  setProjectI18nMode: (input: { projectId: ProjectId; mode: "extract" | "inline" }) => void;
  /**
   * Drop every i18n key that's no longer referenced anywhere in the project
   * (stale leftovers from deleted elements / re-imports). Returns nothing;
   * undoable. See {@link findUnusedI18nKeys}.
   */
  removeUnusedI18nKeys: (input: { projectId: ProjectId }) => void;
  /** Change the project's default language (the fallback when a key has no entry in the active lang). */
  setProjectDefaultLang: (input: { projectId: ProjectId; lang: string }) => void;
  /** Replace the element's positions string (e.g. "0-8,17,26"). */
  setElementPositions: (input: {
    projectId: ProjectId;
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
    projectId: ProjectId;
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
    projectId: ProjectId;
    menuId: MenuId;
    elementId: ElementId;
    position: number;
  }) => void;
  /** Remove an element from its menu, regardless of how many positions it has. */
  deleteElement: (input: { projectId: ProjectId; menuId: MenuId; elementId: ElementId }) => void;
  /** Replace one step inside a click handler's step tree at the given path. */
  setElementStep: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
      clickType: ClickType;
      path: StepPath;
      step: Step;
      lang: string;
    } & AppearanceTarget,
  ) => void;
  /**
   * Insert a step into a click handler's step tree. `frames` describes how
   * to descend through if-steps; `index` is the position in the resolved
   * Step[] (negative or out-of-range → append).
   */
  addElementStep: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
      clickType: ClickType;
      frames: StepFrame[];
      index: number;
      step: Step;
      lang: string;
    } & AppearanceTarget,
  ) => void;
  removeElementStep: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
      clickType: ClickType;
      path: StepPath;
    } & AppearanceTarget,
  ) => void;
  /** Reorder steps within the same Step[] (same parent). */
  moveElementStep: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
      clickType: ClickType;
      frames: StepFrame[];
      fromIndex: number;
      toIndex: number;
    } & AppearanceTarget,
  ) => void;
  /** Add a new case to an if-step. */
  addIfCase: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
      clickType: ClickType;
      frames: StepFrame[];
      ifStepIndex: number;
    } & AppearanceTarget,
  ) => void;
  /** Remove a case from an if-step. */
  removeIfCase: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
      clickType: ClickType;
      frames: StepFrame[];
      ifStepIndex: number;
      caseIndex: number;
    } & AppearanceTarget,
  ) => void;
  /** Replace the conditions for one case of an if-step. */
  setIfCaseConditions: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
      clickType: ClickType;
      frames: StepFrame[];
      ifStepIndex: number;
      caseIndex: number;
      conditions: Condition[];
    } & AppearanceTarget,
  ) => void;
  /** Set the operator for one joiner inside a case (between conditions[i] and [i+1]). */
  setIfCaseJoin: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
      clickType: ClickType;
      frames: StepFrame[];
      ifStepIndex: number;
      caseIndex: number;
      joinIndex: number;
      op: "and" | "or";
    } & AppearanceTarget,
  ) => void;
  /** Toggle the else-branch of an if-step on or off. */
  toggleIfElse: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
      clickType: ClickType;
      frames: StepFrame[];
      ifStepIndex: number;
      enabled: boolean;
    } & AppearanceTarget,
  ) => void;
  /**
   * Add an empty click handler at clickType on the given appearance. No-op
   * if a handler already exists there.
   */
  addElementClickHandler: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
      clickType: ClickType;
    } & AppearanceTarget,
  ) => void;
  /** Remove the click handler at clickType (with its actions and fallback). */
  removeElementClickHandler: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
      clickType: ClickType;
    } & AppearanceTarget,
  ) => void;
  /**
   * Append an EMPTY state to an element. A state is a whole appearance, not a
   * patch on the display — starting empty is what makes that visible (the slot
   * renders a bare stone block until it is filled in). Use
   * {@link duplicateAppearance} to start from an existing one instead. Seeded
   * with a placeholder condition so it doesn't match, and so doesn't shadow the
   * display. Cf. ADR `element-display-and-states`.
   */
  addAppearance: (input: { projectId: ProjectId } & AppearanceTarget) => void;
  /**
   * Append a state that copies the appearance at `appearanceIndex` (its LTexts
   * cloned, so the two never share translation keys).
   */
  duplicateAppearance: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
    } & AppearanceTarget,
  ) => void;
  /** Remove the state at the given index. Index 0 is the display and never goes. */
  removeAppearance: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
    } & AppearanceTarget,
  ) => void;
  /** Reorder an element's states (priority = position in the list). */
  moveAppearance: (
    input: {
      projectId: ProjectId;
      fromIndex: number;
      toIndex: number;
    } & AppearanceTarget,
  ) => void;
  /**
   * Replace the entire visibility condition list (`if`) for an appearance.
   * Empty list → unconditional (default state).
   */
  setAppearanceConditions: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
      conditions: Condition[];
    } & AppearanceTarget,
  ) => void;
  /** Set the operator for one joiner between if-conditions on an appearance. */
  setAppearanceJoin: (
    input: {
      projectId: ProjectId;
      appearanceIndex: number;
      joinIndex: number;
      op: "and" | "or";
    } & AppearanceTarget,
  ) => void;
  /** Replace one step inside a command's step tree at the given path. */
  setCommandStep: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    path: StepPath;
    step: Step;
    lang: string;
  }) => void;
  /** Insert a step into a command's step tree. */
  addCommandStep: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    frames: StepFrame[];
    index: number;
    step: Step;
    lang: string;
  }) => void;
  removeCommandStep: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    path: StepPath;
  }) => void;
  moveCommandStep: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    frames: StepFrame[];
    fromIndex: number;
    toIndex: number;
  }) => void;
  addCommandIfCase: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    frames: StepFrame[];
    ifStepIndex: number;
  }) => void;
  removeCommandIfCase: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
  }) => void;
  setCommandIfCaseConditions: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
    conditions: Condition[];
  }) => void;
  setCommandIfCaseJoin: (input: {
    projectId: ProjectId;
    commandId: CommandId;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
    joinIndex: number;
    op: "and" | "or";
  }) => void;
  toggleCommandIfElse: (input: {
    projectId: ProjectId;
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
  addElement: (input: { projectId: ProjectId; menuId: MenuId; element: Element }) => void;
  /**
   * Shift every position of every element in `elementIds` by (dCol, dRow)
   * within the menu's grid. Throws if any new position would fall outside
   * the menu. Positions claimed by the move are stripped from non-target
   * elements (takeover semantics, matching addElementPosition).
   */
  moveSelectionByDelta: (input: {
    projectId: ProjectId;
    menuId: MenuId;
    elementIds: ElementId[];
    dCol: number;
    dRow: number;
  }) => void;
  /** Paste already-cloned-and-id-rewritten entities into a project at an offset. */
  pasteEntities: (input: {
    projectId: ProjectId;
    menus: Menu[];
    commands: Command[];
    offset: { x: number; y: number };
  }) => void;
  addProjectDataSource: (args: { projectId: ProjectId; shape?: "table" | "config" }) => void;
  removeProjectDataSource: (args: { projectId: ProjectId; id: DataSourceId }) => void;
  renameProjectDataSource: (args: {
    projectId: ProjectId;
    id: DataSourceId;
    newName: string;
  }) => boolean;
  /** One Data-model/config field edit: schema + synchronous value migration (ADR project-sources-and-data-models). */
  editSourceField: (args: {
    projectId: ProjectId;
    target: FieldEditTarget;
    edit: FieldEdit;
  }) => void;
  renameDataModel: (args: { projectId: ProjectId; modelId: DataModelId; newName: string }) => void;
  setModelKeyField: (args: {
    projectId: ProjectId;
    modelId: DataModelId;
    keyField: string;
  }) => void;
  /** Table file granularity: one source file, or one file per row (ADR composable-data-models §2). */
  setSourceGranularity: (args: {
    projectId: ProjectId;
    sourceId: DataSourceId;
    granularity: "row" | null;
  }) => void;
  addSourceRow: (args: { projectId: ProjectId; sourceId: DataSourceId }) => void;
  removeSourceRow: (args: { projectId: ProjectId; sourceId: DataSourceId; index: number }) => void;
  /** Set a scalar/item cell. `row: null` targets a config source's value object. */
  setSourceValue: (args: {
    projectId: ProjectId;
    sourceId: DataSourceId;
    row: number | null;
    path: (string | number)[];
    value: unknown;
  }) => SourceValueUpdateResult;
  addSourceListItem: (args: {
    projectId: ProjectId;
    sourceId: DataSourceId;
    row: number | null;
    path: (string | number)[];
  }) => void;
  removeSourceListItem: (args: {
    projectId: ProjectId;
    sourceId: DataSourceId;
    row: number | null;
    path: (string | number)[];
    index: number;
  }) => void;
  /**
   * Replace the whole value at a path, releasing the old value's ltext keys
   * first (typed via sourceTypeAtPath) and minting the new ones. Used by the
   * union variant switch and map entry add/remove (ADR composable-data-models).
   */
  replaceSourceValueTyped: (args: {
    projectId: ProjectId;
    sourceId: DataSourceId;
    row: number | null;
    path: (string | number)[];
    value: unknown;
  }) => void;
}

/**
 * Tiny helpers shared by the step-tree mutations. They walk the immer
 * draft and return live references so callers can splice in place.
 */
/**
 * Resolve an AppearanceTarget to its owning element inside the given project
 * draft. Null when the target doesn't exist.
 */
/**
 * Re-key every LText an appearance holds, copying the source values — so a copy
 * never shares translation keys with its original (editing one would silently
 * change the other).
 */
function cloneAppearanceLTextsInto(project: Project, a: Appearance): void {
  if (a.title) {
    const src = project.i18nKeys[a.title.key];
    a.title = createLText(project, "", project.defaultLang);
    if (src) project.i18nKeys[a.title.key] = { ...src };
  }
  if (a.lore) {
    const src = project.i18nKeys[a.lore.key];
    a.lore = createLText(project, "", project.defaultLang);
    if (src) project.i18nKeys[a.lore.key] = { ...src };
  }
  if (a.click) {
    for (const handler of Object.values(a.click)) {
      if (!handler) continue;
      for (const action of walkActions(handler.steps)) {
        if (action.type === "send_message" || action.type === "broadcast") {
          const src = project.i18nKeys[action.text.key];
          action.text = createLText(project, "", project.defaultLang);
          if (src) project.i18nKeys[action.text.key] = { ...src };
        } else if (action.type === "show_title") {
          const srcT = project.i18nKeys[action.title.key];
          action.title = createLText(project, "", project.defaultLang);
          if (srcT) project.i18nKeys[action.title.key] = { ...srcT };
          if (action.subtitle) {
            const srcS = project.i18nKeys[action.subtitle.key];
            action.subtitle = createLText(project, "", project.defaultLang);
            if (srcS) project.i18nKeys[action.subtitle.key] = { ...srcS };
          }
        }
      }
    }
  }
}

function findAppearanceOwner(project: Project, target: AppearanceTarget): Element | null {
  const menu = project.menus.find((m) => m.id === target.menuId);
  if (!menu) return null;
  for (const layer of menu.layers) {
    for (const el of layer.elements) {
      if (el.id === target.elementId) return el;
    }
  }
  return null;
}

/** The appearance an {@link AppearanceTarget} + index addresses: 0 is the
 *  element's display, N is its `states[N - 1]`. */
function findAddressedAppearance(
  project: Project,
  target: AppearanceTarget,
  index: number,
): Appearance | undefined {
  const owner = findAppearanceOwner(project, target);
  return owner ? appearanceAt(owner, index) : undefined;
}

function findElementHandler(
  draft: AccountState,
  projectId: ProjectId,
  target: AppearanceTarget,
  appearanceIndex: number,
  clickType: ClickType,
) {
  const project = draft.account.projects.find((p) => p.id === projectId);
  if (!project) return null;
  const owner = findAppearanceOwner(project, target);
  return (owner ? appearanceAt(owner, appearanceIndex) : undefined)?.click?.[clickType] ?? null;
}

/** Canonical i18n key/prefix for an appearance site. */
const appearanceTitleKeyFor = (target: AppearanceTarget, appIdx: number) =>
  elementTitleKey(target.menuId as string, target.elementId as string, appIdx);
const appearanceLoreKeyFor = (target: AppearanceTarget, appIdx: number) =>
  elementLoreKey(target.menuId as string, target.elementId as string, appIdx);
const appearanceClickPrefixFor = (target: AppearanceTarget, appIdx: number, clickType: ClickType) =>
  clickHandlerKeyPrefix(target.menuId as string, target.elementId as string, appIdx, clickType);

function findCommand(draft: AccountState, projectId: ProjectId, commandId: CommandId) {
  const project = draft.account.projects.find((p) => p.id === projectId);
  if (!project) return null;
  return project.commands.find((c) => c.id === commandId) ?? null;
}

function touch(draft: AccountState, projectId: ProjectId) {
  const project = draft.account.projects.find((p) => p.id === projectId);
  if (project) project.updatedAt = new Date().toISOString();
}

/**
 * Per-mutation i18n key lifecycle, folded over the single project traversal in
 * `@/domain/i18nSites`. `allocStepLTexts` mints canonical keys for any step
 * action still holding the unallocated sentinel (`key === ""`); the `gc*`
 * family releases the keys of a removed subtree. Signatures are preserved so
 * the mutation call sites stay put — only the traversal moved out.
 */
function allocStepLTexts(project: Project, steps: Step[], lang: string, keyPrefix: string): void {
  mintLTexts(project, visitStepLTexts(steps, keyPrefix), lang);
}
function gcStepLTexts(project: Project, steps: Step[]): void {
  releaseLTexts(project, visitStepLTexts(steps, ""));
}
function gcAppearanceLTexts(project: Project, appearance: Appearance): void {
  releaseLTexts(project, visitAppearanceLTexts(appearance, ""));
}
function gcElementLTexts(project: Project, element: Element): void {
  releaseLTexts(project, visitElementLTexts("", element));
}
function gcMenuLTexts(project: Project, menu: Menu): void {
  releaseLTexts(project, visitMenuLTexts(menu));
}
function gcCommandLTexts(project: Project, command: Command): void {
  releaseLTexts(project, visitCommandLTexts(command));
}
function gcDialogLTexts(project: Project, dialog: Dialog): void {
  releaseLTexts(project, visitDialogLTexts(dialog));
}

/** Auto slot range for a dropped paginated block: skip the first/last menu row when roomy. */
function defaultIterateRange(menu: Menu): string {
  const total = slotCount(menu.inventoryType ?? "chest", menu.rows);
  if (total <= 18) return `0-${total - 1}`;
  return `9-${total - 10}`;
}

/** i18n keys held by the text-bearing title layers (text/plain/textarea) in a set. */
function titleLayerKeys(layers: MenuTitleLayer[]): Set<I18nKey> {
  const keys = new Set<I18nKey>();
  for (const l of layers) {
    if ((l.kind === "text" || l.kind === "plain" || l.kind === "textarea") && l.value?.key) {
      keys.add(l.value.key);
    }
  }
  return keys;
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

/** Mint sentinels and canonicalize every ltext across the project's Project sources. */
function mintSourceLTexts(project: Project): void {
  for (const ds of project.dataSources ?? []) {
    mintLTexts(project, visitDataSourceLTexts(project, ds), project.defaultLang);
    rekeyDataSource(project, ds);
  }
}

/** Navigate a source's row (or config value) to the container at `path`. */
function sourceValueContainer(
  ds: DataSource,
  row: number | null,
  path: (string | number)[],
): unknown {
  let current: unknown =
    ds.shape === "table" ? (row === null ? undefined : ds.rows[row]) : ds.value;
  for (const seg of path) {
    if (current === undefined || current === null) return undefined;
    current = (current as Record<string | number, unknown>)[seg];
  }
  return current;
}

function nextElementIdForMaterial(project: Project, material: string | undefined): ElementId {
  const base = (material ?? "button").toLowerCase();
  const prefix = `${base}_`;
  let max = 0;
  for (const menu of project.menus) {
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
  const normalizedBase = normalizeDataSourceName(base);
  if (!existing.some((d) => normalizeDataSourceName(d.name) === normalizedBase))
    return normalizedBase;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${normalizedBase}_${n}`;
    if (!existing.some((d) => normalizeDataSourceName(d.name) === candidate)) return candidate;
  }
  return `${normalizedBase}_${Date.now()}`;
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
 * Middleware: `temporal(stateCreator)` — undo/redo seulement.
 *
 * Ce store n'est **pas** persisté : le contenu d'un Project vient du serveur
 * (ADR `server-disk-only-storage`), et le travail non enregistré vit dans
 * `projectDraftStore`, qui est explicitement daté et proposé plutôt qu'appliqué.
 * Ce commentaire décrivait un `persist` retiré depuis — le genre de phrase qui
 * fait conclure à tort que l'état est sauvegardé.
 *
 * Action functions are stable refs, so excluding them via `partialize` keeps the
 * temporal diff narrow.
 *
 * Account-level mutations (createProject, reorderProjects) clear the temporal
 * stack themselves so they don't tangle with project-internal edits in the
 * undo history. Project-internal mutations (slot material, field edits, canvas
 * position, deleteFromProject, moveMenuToProject) are undoable.
 */
const clearTemporal = () => useAccountStore.temporal.getState().clear();

export const useAccountStore = create<AccountState>()(
  temporal(
    (set, get) => ({
      account: { id: "" as Account["id"], projects: [], projectOrder: [] },
      setAccount: (account) => {
        clearTemporal();
        const migratedProjects = account.projects.map((p) => ({
          ...p,
          dialogs: p.dialogs ?? [],
          menus: p.menus.map((m) => ({ ...m, title: migrateTitle(m.title) })),
        }));
        const migratedAccount = produce({ ...account, projects: migratedProjects }, (draft) => {
          for (const project of draft.projects) mintSourceLTexts(project);
        });
        set({ account: migratedAccount });
      },
      createProject: ({ id: rawId }) => {
        const id = rawId as ProjectId;
        set(
          produce((draft: AccountState) => {
            draft.account.projects.push({
              id,
              name: rawId,
              source: "user_created",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              menus: [],
              commands: [],
              assets: [],
              dataSources: [],
              dialogs: [],
              i18nKeys: {},
              defaultLang: "en",
              canvasLayout: {},
            });
            draft.account.projectOrder.push(id);
          }),
        );
        clearTemporal();
        return id;
      },
      importProject: ({ project: incoming }) => {
        // Light shape check — the input came from a user-supplied file so
        // we don't fully trust it, but we don't deep-validate either.
        if (!incoming || typeof incoming !== "object") {
          throw new Error("invalid project: not an object");
        }
        if (typeof incoming.name !== "string") throw new Error("invalid project: missing name");
        if (!Array.isArray(incoming.menus)) throw new Error("invalid project: missing menus");
        if (!Array.isArray(incoming.commands)) throw new Error("invalid project: missing commands");

        const id = newProjectId();
        set(
          produce((draft: AccountState) => {
            const next = {
              ...incoming,
              id,
              // Force fresh source/timestamps even if the file claimed otherwise.
              source: "imported" as const,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              // Retag children so their projectId matches the new project id.
              menus: incoming.menus.map((m) => ({ ...m, projectId: id })),
              commands: incoming.commands.map((c) => ({ ...c, projectId: id })),
              assets: (incoming.assets ?? []).map((a) => ({ ...a, projectId: id })),
              dialogs: (incoming.dialogs ?? []).map((d) => ({ ...d, projectId: id })),
              i18nKeys: incoming.i18nKeys ?? {},
              defaultLang: incoming.defaultLang ?? "en",
              canvasLayout: incoming.canvasLayout ?? {},
            };
            // Imported project may use the legacy plain-string shape — migrate
            // in place so it lines up with the current LText-based domain.
            migrateProjectToI18n(next, next.defaultLang);
            // Migrate menu titles from LText to MenuTitleLayer[].
            for (const menu of next.menus) {
              menu.title = migrateTitle(menu.title);
            }
            draft.account.projects.push(next);
            draft.account.projectOrder.push(id);
          }),
        );
        clearTemporal();
        return id;
      },
      replaceProject: (project) => {
        clearTemporal();
        set(
          produce((draft: AccountState) => {
            const idx = draft.account.projects.findIndex((p) => p.id === project.id);
            if (idx !== -1) {
              draft.account.projects[idx] = {
                ...project,
                menus: project.menus.map((m) => ({ ...m, title: migrateTitle(m.title) })),
              };
            }
          }),
        );
      },
      setModuleData: (projectId, moduleId, data) => {
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === projectId);
            if (!project) return;
            project.moduleData = { ...(project.moduleData ?? {}), [moduleId]: data };
            project.updatedAt = new Date().toISOString();
          }),
        );
      },
      applyAssistantMenu: ({ projectId: pId, menuV1, lang }) => {
        let unsupported: string[] = [];
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const converted = menuV1ToDomain(menuV1, { projectId: pId, lang });
            const { menu, i18nKeys } = converted;
            unsupported = converted.unsupported;
            // The converter already stamps menu.projectId from opts.projectId; keep
            // this as a safety net so the domain Menu always carries the id.
            menu.projectId = pId;
            for (const [key, langs] of Object.entries(i18nKeys)) {
              project.i18nKeys[key as I18nKey] = {
                ...(project.i18nKeys[key as I18nKey] ?? {}),
                ...langs,
              };
            }
            const idx = project.menus.findIndex((m) => m.id === menu.id);
            if (idx >= 0) project.menus[idx] = menu;
            else project.menus.push(menu);
            project.updatedAt = new Date().toISOString();
          }),
        );
        return unsupported;
      },
      applyAssistantTranslations: ({ projectId: pId, entries }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            for (const [key, langs] of Object.entries(entries)) {
              project.i18nKeys[key as I18nKey] = {
                ...(project.i18nKeys[key as I18nKey] ?? {}),
                ...langs,
              };
            }
            project.updatedAt = new Date().toISOString();
          }),
        ),
      applyAssistantCommand: ({ projectId: pId, commandV1, lang }) => {
        let unsupported: string[] = [];
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const {
              command,
              i18nKeys,
              unsupported: u,
            } = commandV1ToDomain(commandV1, { projectId: pId, lang });
            unsupported = u;
            command.projectId = pId;
            for (const [key, langs] of Object.entries(i18nKeys)) {
              project.i18nKeys[key as I18nKey] = {
                ...(project.i18nKeys[key as I18nKey] ?? {}),
                ...langs,
              };
            }
            const idx = project.commands.findIndex((c) => c.id === command.id);
            if (idx >= 0) project.commands[idx] = command;
            else project.commands.push(command);
            project.updatedAt = new Date().toISOString();
          }),
        );
        return unsupported;
      },
      applyAssistantDialog: ({ projectId: pId, dialogV1, lang }) => {
        let unsupported: string[] = [];
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const {
              dialog,
              i18nKeys,
              unsupported: u,
            } = dialogV1ToDomain(dialogV1, { projectId: pId, lang });
            unsupported = u;
            dialog.projectId = pId;
            for (const [key, langs] of Object.entries(i18nKeys)) {
              project.i18nKeys[key as I18nKey] = {
                ...(project.i18nKeys[key as I18nKey] ?? {}),
                ...langs,
              };
            }
            const idx = project.dialogs.findIndex((d) => d.id === dialog.id);
            if (idx >= 0) project.dialogs[idx] = dialog;
            else project.dialogs.push(dialog);
            project.updatedAt = new Date().toISOString();
          }),
        );
        return unsupported;
      },
      createMenu: ({ projectId: pId, id: rawId, rows, position }) => {
        const id = rawId as MenuId;
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            project.menus.push({
              id,
              projectId: pId,
              // Default to a single Plain (vanilla) title layer. Vanilla mode
              // works without a resource project and matches what new users expect
              // ("type a title, see a title"). The empty `key` is rekeyed to
              // `menus.{id}.title` at deploy time by rekeyProject.
              title: [{ kind: "plain", value: { key: "" as I18nKey } }],
              rows: rows ?? 3,
              layers: [{ id: newLayerId(), name: "default", elements: [] }],
            });
            if (position) {
              (project.canvasLayout as Record<string, { x: number; y: number }>)[id] = position;
            }
            project.updatedAt = new Date().toISOString();
          }),
        );
        return id;
      },
      createCommand: ({ projectId: pId, id: explicitId, name, position }) => {
        const id = explicitId ? commandId(explicitId) : newCommandId();
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            project.commands.push({
              id,
              projectId: pId,
              name: name ?? "newcmd",
              arguments: [],
              steps: [],
            });
            if (position) {
              (project.canvasLayout as Record<string, { x: number; y: number }>)[id] = position;
            }
            project.updatedAt = new Date().toISOString();
          }),
        );
        return id;
      },
      createDialog: ({ projectId: pId, id, position }) => {
        const dId = id as DialogId;
        const titleKey = dialogTitleKey(id);
        const btnLabelKey = dialogButtonLabelKey(id, "btn_confirm");
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            project.i18nKeys[titleKey] = { [project.defaultLang]: "" };
            project.i18nKeys[btnLabelKey] = { [project.defaultLang]: "Confirm" };
            project.dialogs.push({
              id: dId,
              projectId: pId,
              title: { key: titleKey },
              canCloseWithEscape: true,
              body: [],
              inputs: [],
              buttons: [{ id: "btn_confirm", label: { key: btnLabelKey }, steps: [] }],
            });
            if (position) {
              (project.canvasLayout as Record<string, { x: number; y: number }>)[id] = position;
            }
            project.updatedAt = new Date().toISOString();
          }),
        );
        return dId;
      },
      setDialogTitle: ({ projectId: pId, dialogId: dId, lang, value }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const dialog = project.dialogs.find((d) => d.id === dId);
            if (!dialog) return;
            if (!project.i18nKeys[dialog.title.key]) project.i18nKeys[dialog.title.key] = {};
            project.i18nKeys[dialog.title.key]![lang] = value;
            touch(draft, pId);
          }),
        ),
      setDialogField: ({ projectId: pId, dialogId: dId, field, value }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            const dialog = project?.dialogs.find((d) => d.id === dId);
            if (!dialog) return;
            if (field === "canCloseWithEscape") dialog.canCloseWithEscape = value;
            touch(draft, pId);
          }),
        ),
      setDialogId: ({ projectId: pId, oldId, newId }) => {
        if (oldId === newId) return;
        // Renommer est un DÉPLACEMENT, et seul l'éditeur le sait : l'arbre seul
        // ne montrerait qu'une disparition et une apparition. Sans cette
        // intention, la corbeille archive une suppression qui n'en est pas une
        // et l'historique du fichier devient orphelin de son nouveau nom.
        useProjectDraftStore
          .getState()
          .recordRename(pId, `dialogs/${oldId}.yaml`, `dialogs/${newId}.yaml`);
        if (!newId) throw new Error("dialog id cannot be empty");
        const state = get();
        const project = state.account.projects.find((p) => p.id === pId);
        if (!project) throw new Error("project not found");
        if (project.dialogs.some((d) => d.id === newId))
          throw new Error(`dialog id "${newId}" already exists`);
        const next = produce(state.account, (draft) => {
          const p = draft.projects.find((p) => p.id === pId)!;
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
      addDialogBody: ({ projectId: pId, dialogId: dId, body }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            const dialog = project?.dialogs.find((d) => d.id === dId);
            if (!dialog) return;
            if (body.type === "text") {
              const key = dialogBodyTextKey(dId, dialog.body.length);
              project!.i18nKeys[key] = { [project!.defaultLang]: "" };
              dialog.body.push({ type: "text", text: { key } });
            } else {
              dialog.body.push(body);
            }
            touch(draft, pId);
          }),
        ),
      removeDialogBody: ({ projectId: pId, dialogId: dId, index }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            const dialog = project?.dialogs.find((d) => d.id === dId);
            if (!dialog) return;
            const body = dialog.body[index];
            if (body?.type === "text") delete project!.i18nKeys[body.text.key];
            dialog.body.splice(index, 1);
            touch(draft, pId);
          }),
        ),
      setDialogBodyText: ({ projectId: pId, dialogId: dId, index, lang, value }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            const dialog = project?.dialogs.find((d) => d.id === dId);
            const body = dialog?.body[index];
            if (!body || body.type !== "text") return;
            if (!project!.i18nKeys[body.text.key]) project!.i18nKeys[body.text.key] = {};
            project!.i18nKeys[body.text.key]![lang] = value;
            touch(draft, pId);
          }),
        ),
      setDialogBodyMaterial: ({ projectId: pId, dialogId: dId, index, material, count }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            const dialog = project?.dialogs.find((d) => d.id === dId);
            const body = dialog?.body[index];
            if (!body || body.type !== "item") return;
            body.material = material;
            body.count = count;
            touch(draft, pId);
          }),
        ),
      addDialogInput: ({ projectId: pId, dialogId: dId, inputType }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            const dialog = project?.dialogs.find((d) => d.id === dId);
            if (!dialog) return;
            const inputId = `input_${dialog.inputs.length}`;
            const labelKey = dialogInputLabelKey(dId, inputId);
            project!.i18nKeys[labelKey] = { [project!.defaultLang]: "" };
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
      removeDialogInput: ({ projectId: pId, dialogId: dId, index }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            const dialog = project?.dialogs.find((d) => d.id === dId);
            if (!dialog) return;
            const input = dialog.inputs[index];
            if (input) {
              delete project!.i18nKeys[input.label.key];
              if (input.type === "single_option") {
                for (const opt of input.options) delete project!.i18nKeys[opt.label.key];
              }
              dialog.inputs.splice(index, 1);
            }
            touch(draft, pId);
          }),
        ),
      setDialogInput: ({ projectId: pId, dialogId: dId, index, patch }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            const dialog = project?.dialogs.find((d) => d.id === dId);
            if (!dialog?.inputs[index]) return;
            Object.assign(dialog.inputs[index]!, patch);
            touch(draft, pId);
          }),
        ),
      addDialogButton: ({ projectId: pId, dialogId: dId }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            const dialog = project?.dialogs.find((d) => d.id === dId);
            if (!dialog) return;
            const btnId = `btn_${dialog.buttons.length}`;
            const labelKey = dialogButtonLabelKey(dId, btnId);
            project!.i18nKeys[labelKey] = { [project!.defaultLang]: "" };
            dialog.buttons.push({ id: btnId, label: { key: labelKey }, steps: [] });
            touch(draft, pId);
          }),
        ),
      removeDialogButton: ({ projectId: pId, dialogId: dId, buttonIndex }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            const dialog = project?.dialogs.find((d) => d.id === dId);
            if (!dialog) return;
            const btn = dialog.buttons[buttonIndex];
            if (btn) {
              delete project!.i18nKeys[btn.label.key];
              for (const action of walkActions(btn.steps)) {
                if (action.type === "send_message" || action.type === "broadcast")
                  delete project!.i18nKeys[action.text.key];
                else if (action.type === "show_title") {
                  delete project!.i18nKeys[action.title.key];
                  if (action.subtitle) delete project!.i18nKeys[action.subtitle.key];
                }
              }
              dialog.buttons.splice(buttonIndex, 1);
            }
            touch(draft, pId);
          }),
        ),
      setDialogButtonLabel: ({ projectId: pId, dialogId: dId, buttonIndex, lang, value }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            const dialog = project?.dialogs.find((d) => d.id === dId);
            const btn = dialog?.buttons[buttonIndex];
            if (!btn) return;
            if (!project!.i18nKeys[btn.label.key]) project!.i18nKeys[btn.label.key] = {};
            project!.i18nKeys[btn.label.key]![lang] = value;
            touch(draft, pId);
          }),
        ),
      addDialogButtonStep: ({
        projectId: pId,
        dialogId: dId,
        buttonIndex,
        frames,
        index,
        step,
        lang,
      }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            const dialog = project?.dialogs.find((d) => d.id === dId);
            const btn = dialog?.buttons[buttonIndex];
            if (!project || !btn) return;
            const parent = resolveParentMut(btn.steps, frames);
            if (!parent) return;
            const at = index < 0 || index > parent.length ? parent.length : index;
            parent.splice(at, 0, step);
            allocStepLTexts(project, btn.steps, lang, dialogButtonKeyPrefix(dId, btn.id));
            touch(draft, pId);
          }),
        ),
      moveDialogButtonStep: ({
        projectId: pId,
        dialogId: dId,
        buttonIndex,
        frames,
        fromIndex,
        toIndex,
      }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            const dialog = project?.dialogs.find((d) => d.id === dId);
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
      setDialogButtonStep: ({ projectId: pId, dialogId: dId, buttonIndex, path, step, lang }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            const dialog = project?.dialogs.find((d) => d.id === dId);
            const btn = dialog?.buttons[buttonIndex];
            if (!project || !btn) return;
            const parent = resolveParentMut(btn.steps, path.frames);
            if (!parent || path.index < 0 || path.index >= parent.length) return;
            gcStepLTexts(project, [parent[path.index]!]);
            parent[path.index] = step;
            allocStepLTexts(project, btn.steps, lang, dialogButtonKeyPrefix(dId, btn.id));
            touch(draft, pId);
          }),
        ),
      removeDialogButtonStep: ({ projectId: pId, dialogId: dId, buttonIndex, path }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            const dialog = project?.dialogs.find((d) => d.id === dId);
            const btn = dialog?.buttons[buttonIndex];
            if (!project || !btn) return;
            const parent = resolveParentMut(btn.steps, path.frames);
            if (!parent || path.index < 0 || path.index >= parent.length) return;
            gcStepLTexts(project, [parent[path.index]!]);
            parent.splice(path.index, 1);
            touch(draft, pId);
          }),
        ),
      addDialogButtonIfCase: ({
        projectId: pId,
        dialogId: dId,
        buttonIndex,
        frames,
        ifStepIndex,
      }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            const dialog = project?.dialogs.find((d) => d.id === dId);
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
        projectId: pId,
        dialogId: dId,
        buttonIndex,
        frames,
        ifStepIndex,
        caseIndex,
      }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            const dialog = project?.dialogs.find((d) => d.id === dId);
            const btn = dialog?.buttons[buttonIndex];
            if (!project || !btn) return;
            const parent = resolveParentMut(btn.steps, frames);
            const ifStep = parent?.[ifStepIndex];
            if (!ifStep || ifStep.kind !== "if") return;
            if (caseIndex < 0 || caseIndex >= ifStep.cases.length) return;
            if (ifStep.cases.length > 1) {
              gcStepLTexts(project, ifStep.cases[caseIndex]!.steps);
              ifStep.cases.splice(caseIndex, 1);
            }
            touch(draft, pId);
          }),
        ),
      setDialogButtonIfCaseConditions: ({
        projectId: pId,
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
            const project = draft.account.projects.find((p) => p.id === pId);
            const dialog = project?.dialogs.find((d) => d.id === dId);
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
        projectId: pId,
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
            const project = draft.account.projects.find((p) => p.id === pId);
            const dialog = project?.dialogs.find((d) => d.id === dId);
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
        projectId: pId,
        dialogId: dId,
        buttonIndex,
        frames,
        ifStepIndex,
        lang: _lang,
        enabled,
      }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            const dialog = project?.dialogs.find((d) => d.id === dId);
            const btn = dialog?.buttons[buttonIndex];
            if (!project || !btn) return;
            const parent = resolveParentMut(btn.steps, frames);
            const ifStep = parent?.[ifStepIndex];
            if (!ifStep || ifStep.kind !== "if") return;
            if (enabled) {
              if (!ifStep.else) ifStep.else = [];
            } else {
              if (ifStep.else) {
                gcStepLTexts(project, ifStep.else);
                ifStep.else = undefined;
              }
            }
            touch(draft, pId);
          }),
        ),
      removeProject: (projectId) => {
        set(
          produce((draft: AccountState) => {
            draft.account.projects = draft.account.projects.filter((p) => p.id !== projectId);
            draft.account.projectOrder = draft.account.projectOrder.filter(
              (id) => id !== projectId,
            );
          }),
        );
        clearTemporal();
      },
      upsertScratchProject: (project) => {
        set(
          produce((draft: AccountState) => {
            const idx = draft.account.projects.findIndex((p) => p.id === project.id);
            if (idx === -1) draft.account.projects.push(project);
            else draft.account.projects[idx] = project;
          }),
        );
        clearTemporal();
      },
      reorderProjects: (newOrder) => {
        set(
          produce((draft: AccountState) => {
            draft.account.projectOrder = [...newOrder];
          }),
        );
        clearTemporal();
      },
      moveMenuToProject: ({ menuId: mId, fromProjectId, toProjectId }) => {
        const next = produce(get().account, (draft) => {
          const from = draft.projects.find((p) => p.id === fromProjectId);
          const to = draft.projects.find((p) => p.id === toProjectId);
          if (!from || !to) throw new Error("project not found");
          const idx = from.menus.findIndex((m) => m.id === mId);
          if (idx === -1) throw new Error("menu not found in source project");
          const [moved] = from.menus.splice(idx, 1);
          if (!moved) return;
          moved.projectId = toProjectId;
          to.menus.push(moved);
        });
        set({ account: next });
      },
      setCanvasPosition: ({ projectId: pId, nodeId, x, y }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            (project.canvasLayout as Record<string, { x: number; y: number }>)[nodeId] = { x, y };
          }),
        ),
      // Board-membership entry point: puts an element ON the board at (x,y).
      // Same write as setCanvasPosition (drag-persist), but a distinct intent —
      // call sites read clearly as "add to board" vs. "node moved".
      addToBoard: ({ projectId: pId, nodeId, x, y }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            (project.canvasLayout as Record<string, { x: number; y: number }>)[nodeId] = { x, y };
          }),
        ),
      removeFromBoard: ({ projectId: pId, nodeId }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            delete (project.canvasLayout as Record<string, { x: number; y: number }>)[nodeId];
          }),
        ),
      arrangeAllOnBoard: ({ projectId: pId }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const grid = gridArrange(current(project));
            project.canvasLayout = grid as typeof project.canvasLayout;
          }),
        ),
      setEdgeAnchor: ({ projectId: pId, edgeId, end, anchor }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            project.canvasEdges ??= {};
            project.canvasEdges[edgeId] = { ...project.canvasEdges[edgeId], [end]: anchor };
          }),
        ),
      clearEdgeAnchor: ({ projectId: pId, edgeId, end }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            const entry = project?.canvasEdges?.[edgeId];
            if (!project || !entry) return;
            delete entry[end];
            if (!entry.from && !entry.to) delete project.canvasEdges![edgeId];
          }),
        ),
      setProjectField: ({ projectId: pId, field, value }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            if (field === "name") project.name = value;
            else if (field === "description") project.description = value || undefined;
            project.updatedAt = new Date().toISOString();
          }),
        ),
      setI18nValue: ({ projectId: pId, lt, lang, value }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            setLText(project, lt, lang, value);
            project.updatedAt = new Date().toISOString();
          }),
        ),
      addLanguage: ({ projectId: pId, lang }) => {
        if (!lang) throw new Error("language code cannot be empty");
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            // Idempotent: re-adding an existing lang is a no-op. We
            // don't seed empty entries for every key — fallback to
            // defaultLang at read time covers untranslated keys. Just
            // touch one entry so future enumeration code can spot the
            // language. (If the project has no keys at all, the language
            // doesn't need recording anywhere.)
            for (const entry of Object.values(project.i18nKeys)) {
              if (!entry) continue;
              if (!(lang in entry)) entry[lang] = "";
              break;
            }
            project.updatedAt = new Date().toISOString();
          }),
        );
      },
      setProjectI18nMode: ({ projectId: pId, mode }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            // `extract` is the default and leaves no marker — on disk as here,
            // so a project that never touched the toggle stays clean.
            if (mode === "inline") project.i18nMode = "inline";
            else delete project.i18nMode;
            project.updatedAt = new Date().toISOString();
          }),
        ),
      removeLanguage: ({ projectId: pId, lang }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            if (lang === project.defaultLang) return; // refuse to drop the default
            for (const entry of Object.values(project.i18nKeys)) {
              if (entry) delete entry[lang];
            }
            project.updatedAt = new Date().toISOString();
          }),
        ),
      removeUnusedI18nKeys: ({ projectId: pId }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            // Walk a plain snapshot (`current`) rather than the immer draft —
            // findKeyUsages only reads, and the proxy walk is needless overhead.
            const unused = findUnusedI18nKeys(current(project));
            if (unused.length === 0) return;
            for (const key of unused) delete project.i18nKeys[key];
            project.updatedAt = new Date().toISOString();
          }),
        ),
      setProjectDefaultLang: ({ projectId: pId, lang }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            if (!lang) return;
            project.defaultLang = lang;
            project.updatedAt = new Date().toISOString();
          }),
        ),
      setMenuField: ({ projectId: pId, menuId: mId, field, value }) => {
        const next = produce(get().account, (draft) => {
          const project = draft.projects.find((p) => p.id === pId);
          if (!project) return;
          const menu = project.menus.find((m) => m.id === mId);
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
          project.updatedAt = new Date().toISOString();
        });
        set({ account: next });
      },
      setMenuTitle: ({ projectId: pId, menuId: mId, lang, value }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const menu = project.menus.find((m) => m.id === mId);
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
                const newLText = createLTextAt(project, menuTitleKey(mId), value, lang);
                first.value = newLText;
              } else {
                setLText(project, first.value, lang, value);
              }
            } else {
              const newLText = createLTextAt(project, menuTitleKey(mId), value, lang);
              menu.title.unshift({ kind: "text", value: newLText, x: 8, y: 5 });
            }
            project.updatedAt = new Date().toISOString();
          }),
        ),
      setMenuTitleLayers: ({ projectId: pId, menuId: mId, layers }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const menu = project.menus.find((m) => m.id === mId);
            if (!menu) return;
            // Release the i18n keys of text-bearing layers that the new layer
            // set drops, so switching title modes (composé ↔ vanilla) doesn't
            // leak orphaned "(unused)" keys. Keys kept in `layers` (e.g. a
            // migrated title) are preserved.
            const keptKeys = titleLayerKeys(layers);
            for (const key of titleLayerKeys(menu.title)) {
              if (!keptKeys.has(key)) deleteLText(project, { key });
            }
            menu.title = layers;
            project.updatedAt = new Date().toISOString();
          }),
        ),
      updateMenuTitleLayer: ({ projectId: pId, menuId: mId, index, patch }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const menu = project.menus.find((m) => m.id === mId);
            if (!menu) return;
            const layer = menu.title[index];
            if (!layer) return;
            menu.title[index] = { ...layer, ...patch } as MenuTitleLayer;
            project.updatedAt = new Date().toISOString();
          }),
        ),
      addMenuTitleLayer: ({ projectId: pId, menuId: mId, layer }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const menu = project.menus.find((m) => m.id === mId);
            if (!menu) return;
            menu.title.push(layer);
            project.updatedAt = new Date().toISOString();
          }),
        ),
      removeMenuTitleLayer: ({ projectId: pId, menuId: mId, index }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const menu = project.menus.find((m) => m.id === mId);
            if (!menu) return;
            const [removed] = menu.title.splice(index, 1);
            // GC the removed layer's i18n key (text-bearing layers only) so a
            // deleted title layer doesn't leave an orphaned "(unused)" key.
            if (removed) {
              for (const key of titleLayerKeys([removed])) deleteLText(project, { key });
            }
            project.updatedAt = new Date().toISOString();
          }),
        ),
      reorderMenuTitleLayers: ({ projectId: pId, menuId: mId, fromIndex, toIndex }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const menu = project.menus.find((m) => m.id === mId);
            if (!menu) return;
            const [moved] = menu.title.splice(fromIndex, 1);
            if (moved) menu.title.splice(toIndex, 0, moved);
            project.updatedAt = new Date().toISOString();
          }),
        ),
      setCommandField: ({ projectId: pId, commandId: cId, field, value }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const cmd = project.commands.find((c) => c.id === cId);
            if (!cmd) return;
            if (field === "name") cmd.name = value;
            else if (field === "permission") cmd.permission = value || undefined;
            else if (field === "description") cmd.description = value || undefined;
            project.updatedAt = new Date().toISOString();
          }),
        ),
      setCommandAliases: ({ projectId: pId, commandId: cId, aliases }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const cmd = project.commands.find((c) => c.id === cId);
            if (!cmd) return;
            cmd.aliases = aliases.length > 0 ? aliases : undefined;
            project.updatedAt = new Date().toISOString();
          }),
        ),
      updateCommand: ({ projectId: pId, command }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const idx = project.commands.findIndex((c) => c.id === command.id);
            if (idx === -1) return;
            project.commands[idx] = command;
            project.updatedAt = new Date().toISOString();
          }),
        ),
      updateDialog: ({ projectId: pId, dialog }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const idx = project.dialogs.findIndex((d) => d.id === dialog.id);
            if (idx === -1) return;
            project.dialogs[idx] = dialog;
            project.updatedAt = new Date().toISOString();
          }),
        ),
      addCommandArg: ({ projectId: pId, commandId: cId, arg }) => {
        const next = produce(get().account, (draft) => {
          const project = draft.projects.find((p) => p.id === pId);
          if (!project) return;
          const cmd = project.commands.find((c) => c.id === cId);
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
          project.updatedAt = new Date().toISOString();
        });
        set({ account: next });
      },
      setCommandArg: ({ projectId: pId, commandId: cId, index, arg }) => {
        const next = produce(get().account, (draft) => {
          const project = draft.projects.find((p) => p.id === pId);
          if (!project) return;
          const cmd = project.commands.find((c) => c.id === cId);
          if (!cmd || index < 0 || index >= cmd.arguments.length) return;
          const newArgs = [...cmd.arguments];
          newArgs[index] = arg;
          validateArgOrder(newArgs);
          cmd.arguments[index] = arg;
          project.updatedAt = new Date().toISOString();
        });
        set({ account: next });
      },
      removeCommandArg: ({ projectId: pId, commandId: cId, index }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const cmd = project.commands.find((c) => c.id === cId);
            if (!cmd || index < 0 || index >= cmd.arguments.length) return;
            cmd.arguments.splice(index, 1);
            project.updatedAt = new Date().toISOString();
          }),
        ),
      addMenuContextInput: ({ projectId: pId, menuId: mId, kind }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const menu = project.menus.find((m) => m.id === mId);
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
            project.updatedAt = new Date().toISOString();
          }),
        ),
      setMenuContextInput: ({ projectId: pId, menuId: mId, index, input }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const menu = project.menus.find((m) => m.id === mId);
            if (!menu?.contextInputs) return;
            if (index < 0 || index >= menu.contextInputs.length) return;
            menu.contextInputs[index] = input;
            project.updatedAt = new Date().toISOString();
          }),
        ),
      removeMenuContextInput: ({ projectId: pId, menuId: mId, index }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const menu = project.menus.find((m) => m.id === mId);
            if (!menu?.contextInputs) return;
            if (index < 0 || index >= menu.contextInputs.length) return;
            menu.contextInputs.splice(index, 1);
            if (menu.contextInputs.length === 0) menu.contextInputs = undefined;
            project.updatedAt = new Date().toISOString();
          }),
        ),
      setElementIterates: ({ projectId: pId, menuId: mId, elementId: eId, iterates }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const menu = project.menus.find((m) => m.id === mId);
            if (!menu) return;
            for (const layer of menu.layers) {
              const el = layer.elements.find((e) => e.id === eId);
              if (el) {
                el.iterates = iterates;
                if (iterates) el.places = undefined; // XOR: iterates and places are exclusive
                project.updatedAt = new Date().toISOString();
                return;
              }
            }
          }),
        ),
      setElementPlaces: ({ projectId: pId, menuId: mId, elementId: eId, places }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            const menu = project?.menus.find((m) => m.id === mId);
            if (!project || !menu) return;
            for (const layer of menu.layers) {
              const el = layer.elements.find((e) => e.id === eId);
              if (el) {
                el.places = places;
                if (places) el.iterates = undefined; // XOR: exclusive with iteration
                project.updatedAt = new Date().toISOString();
                return;
              }
            }
          }),
        ),
      setElementPlacement: ({ projectId: pId, menuId: mId, elementId: eId, placement }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            const menu = project?.menus.find((m) => m.id === mId);
            if (!project || !menu) return;
            for (const layer of menu.layers) {
              const el = layer.elements.find((e) => e.id === eId);
              if (el?.places) {
                const list = el.places.placements;
                const i = list.findIndex((p) => p.key === placement.key);
                if (i >= 0) list[i] = placement;
                else list.push(placement);
                project.updatedAt = new Date().toISOString();
                return;
              }
            }
          }),
        ),
      removeElementPlacement: ({ projectId: pId, menuId: mId, elementId: eId, key }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            const menu = project?.menus.find((m) => m.id === mId);
            if (!project || !menu) return;
            for (const layer of menu.layers) {
              const el = layer.elements.find((e) => e.id === eId);
              if (el?.places) {
                el.places.placements = el.places.placements.filter((p) => p.key !== key);
                project.updatedAt = new Date().toISOString();
                return;
              }
            }
          }),
        ),
      addCapturedItem: ({ projectId: pId, item }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            if (!project.capturedItems) project.capturedItems = [];
            const i = project.capturedItems.findIndex((c) => c.id === item.id);
            if (i >= 0) project.capturedItems[i] = item;
            else project.capturedItems.push(item);
            project.updatedAt = new Date().toISOString();
          }),
        ),
      removeCapturedItem: ({ projectId: pId, itemId }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project?.capturedItems) return;
            project.capturedItems = project.capturedItems.filter((c) => c.id !== itemId);
            project.updatedAt = new Date().toISOString();
          }),
        ),
      createMenuSet: ({
        projectId: pId,
        menuId: mId,
        inputName,
        mode,
        keyField,
        alias: aliasIn,
        schema,
        positions,
      }) => {
        let result: ReturnType<AccountState["createMenuSet"]> = { ok: false, reason: "not_found" };
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            const menu = project?.menus.find((m) => m.id === mId);
            // `inputName` may be a DOTTED PATH into an object param (e.g.
            // `category.items`) — the guard checks the ROOT input exists.
            const rootName = inputName.split(".")[0]!;
            const input = menu?.contextInputs?.find((c) => c.name === rootName);
            if (!project || !menu || !input) return;
            const consumed = menu.layers
              .flatMap((l) => l.elements)
              .some((e) => e.iterates?.source === inputName || e.places?.source === inputName);
            if (consumed) {
              result = { ok: false, reason: "already_exists" };
              return;
            }
            const alias = aliasIn ?? "item";
            const has = (names: string[]) => names.find((n) => schema.some((f) => f.name === n));
            const iconField = has(["icon", "material"]);
            const nameField = has(["name", "title", "label"]) ?? keyField ?? schema[0]?.name;
            const loreField = has(["final_price", "price", "description", "lore"]);

            const elId = newElementId();
            // Canonical element key sites from the start — no later rekey churn.
            const titleKey = `menus.${mId}.elements.${elId}.default.title` as I18nKey;
            const loreKey = `menus.${mId}.elements.${elId}.default.lore` as I18nKey;
            project.i18nKeys[titleKey] = {
              [project.defaultLang]: nameField ? `{${alias}.${nameField}}` : "",
            };
            if (loreField)
              project.i18nKeys[loreKey] = { [project.defaultLang]: `{${alias}.${loreField}}` };

            if (menu.layers.length === 0)
              menu.layers.push({ id: newLayerId(), name: "default", elements: [] });
            menu.layers[0]!.elements.push({
              id: elId,
              positions: mode === "iterates" ? (positions ?? defaultIterateRange(menu)) : "",
              display: {
                material: iconField ? `{${alias}.${iconField}}` : "CHEST",
                title: { key: titleKey },
                ...(loreField ? { lore: { key: loreKey } } : {}),
              },
              states: [],
              ...(mode === "iterates"
                ? { iterates: { source: inputName, alias } }
                : {
                    places: {
                      source: inputName,
                      alias,
                      keyField: keyField ?? "id",
                      placements: [],
                    },
                  }),
            });
            result = { ok: true, elementId: elId };
          }),
        );
        return result;
      },
      setMenuId: ({ projectId: pId, oldId, newId }) => {
        if (oldId === newId) return;
        // Renommer est un DÉPLACEMENT, et seul l'éditeur le sait : l'arbre seul
        // ne montrerait qu'une disparition et une apparition. Sans cette
        // intention, la corbeille archive une suppression qui n'en est pas une
        // et l'historique du fichier devient orphelin de son nouveau nom.
        useProjectDraftStore
          .getState()
          .recordRename(pId, `menus/${oldId}.yaml`, `menus/${newId}.yaml`);
        if (!newId) throw new Error("menu id cannot be empty");
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            if (project.menus.some((m) => m.id === newId)) {
              throw new Error(`menu id "${newId}" already exists in project`);
            }
            const menu = project.menus.find((m) => m.id === oldId);
            if (!menu) return;
            menu.id = newId;
            // Rewrite open_menu refs across the entire project — both
            // element click handlers and command step trees.
            const rewrite = (action: Action) => {
              if (action.type === "open_menu" && action.menuId === oldId) {
                action.menuId = newId;
              }
            };
            for (const m of project.menus) {
              for (const layer of m.layers) {
                for (const el of layer.elements) {
                  for (const appearance of addressedAppearances(el)) {
                    if (!appearance.click) continue;
                    for (const handler of Object.values(appearance.click)) {
                      if (!handler) continue;
                      for (const a of walkActions(handler.steps)) rewrite(a);
                    }
                  }
                }
              }
            }
            for (const cmd of project.commands) {
              for (const a of walkActions(cmd.steps)) rewrite(a);
            }
            const layout = project.canvasLayout as Record<string, { x: number; y: number }>;
            if (oldId in layout) {
              layout[newId] = layout[oldId]!;
              delete layout[oldId];
            }
            rewriteCanvasEdgeIds(project, oldId as string, newId as string);
            rekeyMenu(project, menu);
            project.updatedAt = new Date().toISOString();
          }),
        );
      },
      setCommandId: ({ projectId: pId, oldId, newId }) => {
        if (oldId === newId) return;
        // Renommer est un DÉPLACEMENT, et seul l'éditeur le sait : l'arbre seul
        // ne montrerait qu'une disparition et une apparition. Sans cette
        // intention, la corbeille archive une suppression qui n'en est pas une
        // et l'historique du fichier devient orphelin de son nouveau nom.
        useProjectDraftStore
          .getState()
          .recordRename(pId, `commands/${oldId}.yaml`, `commands/${newId}.yaml`);
        if (!newId) throw new Error("command id cannot be empty");
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            if (project.commands.some((c) => c.id === newId)) {
              throw new Error(`command id "${newId}" already exists in project`);
            }
            const cmd = project.commands.find((c) => c.id === oldId);
            if (!cmd) return;
            cmd.id = newId;
            const layout = project.canvasLayout as Record<string, { x: number; y: number }>;
            if (oldId in layout) {
              layout[newId] = layout[oldId]!;
              delete layout[oldId];
            }
            rewriteCanvasEdgeIds(project, oldId as string, newId as string);
            rekeyCommand(project, cmd);
            project.updatedAt = new Date().toISOString();
          }),
        );
      },
      setElementId: ({ projectId: pId, menuId: mId, oldId, newId }) => {
        if (oldId === newId) return;
        if (!newId) throw new Error("element id cannot be empty");
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const menu = project.menus.find((m) => m.id === mId);
            if (!menu) return;
            const allElements = menu.layers.flatMap((l) => l.elements);
            if (allElements.some((el) => el.id === newId)) {
              throw new Error(`element id "${newId}" already exists in menu`);
            }
            for (const layer of menu.layers) {
              const el = layer.elements.find((e) => e.id === oldId);
              if (el) {
                el.id = newId;
                rekeyMenu(project, menu);
                project.updatedAt = new Date().toISOString();
                return;
              }
            }
          }),
        );
      },
      setSlotMaterial: ({ projectId: pId, menuId: mId, position, material }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const menu = project.menus.find((m) => m.id === mId);
            if (!menu) return;
            // Find the element that currently owns this position (single OR
            // multi-pos), update its material — preserves title/lore/count.
            for (const layer of menu.layers) {
              for (const el of layer.elements) {
                if (!positionsContains(el.positions, position)) continue;
                const appearance = el.display;
                if (appearance) appearance.material = material;
                project.updatedAt = new Date().toISOString();
                return;
              }
            }
            let firstLayer: Layer | undefined = menu.layers[0];
            if (!firstLayer) {
              firstLayer = { id: newLayerId(), name: "default", elements: [] };
              menu.layers.push(firstLayer);
            }
            firstLayer.elements.push({
              id: nextElementIdForMaterial(project, material),
              positions: String(position),
              display: { material },
              states: [],
            });
            project.updatedAt = new Date().toISOString();
          }),
        ),
      setAppearanceField: (input) =>
        set(
          produce((draft: AccountState) => {
            const { projectId: pId, appearanceIndex = 0, field, value } = input;
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const appearance = findAddressedAppearance(project, input, appearanceIndex);
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
            project.updatedAt = new Date().toISOString();
          }),
        ),
      setAppearanceAdvanced: (input) =>
        set(
          produce((draft: AccountState) => {
            const { projectId: pId, appearanceIndex = 0, patch } = input;
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const appearance = findAddressedAppearance(project, input, appearanceIndex);
            if (!appearance) return;
            for (const [key, value] of Object.entries(patch)) {
              // An explicit `undefined` clears the field rather than storing a hole.
              if (value === undefined) delete (appearance as Record<string, unknown>)[key];
              else (appearance as Record<string, unknown>)[key] = value;
            }
            project.updatedAt = new Date().toISOString();
          }),
        ),
      setAppearanceTitle: (input) =>
        set(
          produce((draft: AccountState) => {
            const { projectId: pId, appearanceIndex = 0, lang, value } = input;
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const appearance = findAddressedAppearance(project, input, appearanceIndex);
            if (!appearance) return;
            // Lazy-allocate: brand-new appearances start with no title
            // LText, so the first edit creates one. If the user clears
            // the field, we keep the LText (they may want to re-edit
            // or translate it later) but write "" into the active lang.
            if (!appearance.title)
              appearance.title = createLTextAt(
                project,
                appearanceTitleKeyFor(input, appearanceIndex),
                value,
                lang,
              );
            else setLText(project, appearance.title, lang, value);
            project.updatedAt = new Date().toISOString();
          }),
        ),
      setElementPositions: ({ projectId: pId, menuId: mId, elementId, positions }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const menu = project.menus.find((m) => m.id === mId);
            if (!menu) return;
            for (const layer of menu.layers) {
              for (const el of layer.elements) {
                if (el.id !== elementId) continue;
                el.positions = positions;
                project.updatedAt = new Date().toISOString();
                return;
              }
            }
          }),
        ),
      moveElementPosition: ({ projectId: pId, menuId: mId, elementId, fromPosition, toPosition }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const menu = project.menus.find((m) => m.id === mId);
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
                project.updatedAt = new Date().toISOString();
                return;
              }
            }
          }),
        ),
      addElementPosition: ({ projectId: pId, menuId: mId, elementId, position }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const menu = project.menus.find((m) => m.id === mId);
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
                project.updatedAt = new Date().toISOString();
                return;
              }
            }
          }),
        ),
      deleteElement: ({ projectId: pId, menuId: mId, elementId }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const menu = project.menus.find((m) => m.id === mId);
            if (!menu) return;
            for (const layer of menu.layers) {
              const idx = layer.elements.findIndex((el) => el.id === elementId);
              if (idx !== -1) {
                gcElementLTexts(project, layer.elements[idx]!);
                layer.elements.splice(idx, 1);
                project.updatedAt = new Date().toISOString();
                return;
              }
            }
          }),
        ),
      setElementStep: (input) =>
        set(
          produce((draft: AccountState) => {
            const { projectId: pId, appearanceIndex, clickType, path, step, lang } = input;
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const handler = findElementHandler(draft, pId, input, appearanceIndex, clickType);
            if (!handler) return;
            const parent = resolveParentMut(handler.steps, path.frames);
            if (!parent || path.index < 0 || path.index >= parent.length) return;
            gcStepLTexts(project, [parent[path.index]!]);
            parent[path.index] = step;
            allocStepLTexts(
              project,
              handler.steps,
              lang,
              appearanceClickPrefixFor(input, appearanceIndex, clickType),
            );
            touch(draft, pId);
          }),
        ),
      addElementStep: (input) =>
        set(
          produce((draft: AccountState) => {
            const { projectId: pId, appearanceIndex, clickType, frames, index, step, lang } = input;
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const handler = findElementHandler(draft, pId, input, appearanceIndex, clickType);
            if (!handler) return;
            const parent = resolveParentMut(handler.steps, frames);
            if (!parent) return;
            const at = index < 0 || index > parent.length ? parent.length : index;
            parent.splice(at, 0, step);
            allocStepLTexts(
              project,
              handler.steps,
              lang,
              appearanceClickPrefixFor(input, appearanceIndex, clickType),
            );
            touch(draft, pId);
          }),
        ),
      removeElementStep: (input) =>
        set(
          produce((draft: AccountState) => {
            const { projectId: pId, appearanceIndex, clickType, path } = input;
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const handler = findElementHandler(draft, pId, input, appearanceIndex, clickType);
            if (!handler) return;
            const parent = resolveParentMut(handler.steps, path.frames);
            if (!parent || path.index < 0 || path.index >= parent.length) return;
            gcStepLTexts(project, [parent[path.index]!]);
            parent.splice(path.index, 1);
            touch(draft, pId);
          }),
        ),
      moveElementStep: (input) =>
        set(
          produce((draft: AccountState) => {
            const {
              projectId: pId,
              appearanceIndex,
              clickType,
              frames,
              fromIndex,
              toIndex,
            } = input;
            const handler = findElementHandler(draft, pId, input, appearanceIndex, clickType);
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
      addIfCase: (input) =>
        set(
          produce((draft: AccountState) => {
            const { projectId: pId, appearanceIndex, clickType, frames, ifStepIndex } = input;
            const handler = findElementHandler(draft, pId, input, appearanceIndex, clickType);
            if (!handler) return;
            const parent = resolveParentMut(handler.steps, frames);
            const ifStep = parent?.[ifStepIndex];
            if (!ifStep || ifStep.kind !== "if") return;
            ifStep.cases.push({ conditions: [], steps: [] });
            touch(draft, pId);
          }),
        ),
      removeIfCase: (input) =>
        set(
          produce((draft: AccountState) => {
            const {
              projectId: pId,
              appearanceIndex,
              clickType,
              frames,
              ifStepIndex,
              caseIndex,
            } = input;
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const handler = findElementHandler(draft, pId, input, appearanceIndex, clickType);
            if (!handler) return;
            const parent = resolveParentMut(handler.steps, frames);
            const ifStep = parent?.[ifStepIndex];
            if (!ifStep || ifStep.kind !== "if") return;
            if (caseIndex < 0 || caseIndex >= ifStep.cases.length) return;
            gcStepLTexts(project, ifStep.cases[caseIndex]!.steps);
            ifStep.cases.splice(caseIndex, 1);
            touch(draft, pId);
          }),
        ),
      setIfCaseConditions: (input) =>
        set(
          produce((draft: AccountState) => {
            const {
              projectId: pId,
              appearanceIndex,
              clickType,
              frames,
              ifStepIndex,
              caseIndex,
              conditions,
            } = input;
            const handler = findElementHandler(draft, pId, input, appearanceIndex, clickType);
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
      setIfCaseJoin: (input) =>
        set(
          produce((draft: AccountState) => {
            const {
              projectId: pId,
              appearanceIndex,
              clickType,
              frames,
              ifStepIndex,
              caseIndex,
              joinIndex,
              op,
            } = input;
            const handler = findElementHandler(draft, pId, input, appearanceIndex, clickType);
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
      toggleIfElse: (input) =>
        set(
          produce((draft: AccountState) => {
            const {
              projectId: pId,
              appearanceIndex,
              clickType,
              frames,
              ifStepIndex,
              enabled,
            } = input;
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const handler = findElementHandler(draft, pId, input, appearanceIndex, clickType);
            if (!handler) return;
            const parent = resolveParentMut(handler.steps, frames);
            const ifStep = parent?.[ifStepIndex];
            if (!ifStep || ifStep.kind !== "if") return;
            if (enabled) {
              if (!ifStep.else) ifStep.else = [];
            } else {
              if (ifStep.else) gcStepLTexts(project, ifStep.else);
              ifStep.else = undefined;
            }
            touch(draft, pId);
          }),
        ),
      addElementClickHandler: (input) =>
        set(
          produce((draft: AccountState) => {
            const { projectId: pId, appearanceIndex, clickType } = input;
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const appearance = findAddressedAppearance(project, input, appearanceIndex);
            if (!appearance) return;
            if (!appearance.click) appearance.click = {};
            if (!appearance.click[clickType]) {
              appearance.click[clickType] = { steps: [] };
              project.updatedAt = new Date().toISOString();
            }
          }),
        ),
      removeElementClickHandler: (input) =>
        set(
          produce((draft: AccountState) => {
            const { projectId: pId, appearanceIndex, clickType } = input;
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const appearance = findAddressedAppearance(project, input, appearanceIndex);
            if (!appearance?.click) return;
            const handler = appearance.click[clickType];
            if (handler) gcStepLTexts(project, handler.steps);
            delete appearance.click[clickType];
            project.updatedAt = new Date().toISOString();
          }),
        ),
      addAppearance: (input) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === input.projectId);
            if (!project) return;
            const owner = findAppearanceOwner(project, input);
            if (!owner) return;
            // A new state starts EMPTY — it is a whole appearance, not a patch,
            // and the bare stone block it renders says so at a glance (ADR
            // `element-display-and-states`). Duplicating the display is the
            // separate "duplicate" affordance. The placeholder condition keeps
            // it from matching, and so from shadowing the display.
            owner.states.push({ if: [{ type: "has_permission", perm: "" }] });
            project.updatedAt = new Date().toISOString();
          }),
        ),
      duplicateAppearance: (input) =>
        set(
          produce((draft: AccountState) => {
            const { projectId: pId, appearanceIndex } = input;
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const owner = findAppearanceOwner(project, input);
            const source = owner ? appearanceAt(owner, appearanceIndex) : undefined;
            if (!owner || !source) return;
            const copy = structuredClone(current(source)) as Appearance;
            cloneAppearanceLTextsInto(project, copy);
            // A duplicate of the display would match always and shadow it, so
            // it carries the same placeholder guard a fresh state gets.
            if (!copy.if || copy.if.length === 0) {
              copy.if = [{ type: "has_permission", perm: "" }];
            }
            owner.states.push(copy);
            project.updatedAt = new Date().toISOString();
          }),
        ),
      removeAppearance: (input) =>
        set(
          produce((draft: AccountState) => {
            const { projectId: pId, appearanceIndex } = input;
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const owner = findAppearanceOwner(project, input);
            if (!owner) return;
            // Index 0 is the display — an Element always has one, so only
            // states are removable.
            if (appearanceIndex < 1 || appearanceIndex > owner.states.length) return;
            gcAppearanceLTexts(project, owner.states[appearanceIndex - 1]!);
            owner.states.splice(appearanceIndex - 1, 1);
            project.updatedAt = new Date().toISOString();
          }),
        ),
      moveAppearance: (input) =>
        set(
          produce((draft: AccountState) => {
            const { projectId: pId, fromIndex, toIndex } = input;
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const owner = findAppearanceOwner(project, input);
            if (!owner) return;
            // Only states reorder: the display is neither first nor last in
            // resolution order, it is the fallback.
            if (
              fromIndex < 1 ||
              fromIndex > owner.states.length ||
              toIndex < 1 ||
              toIndex > owner.states.length
            )
              return;
            const [moved] = owner.states.splice(fromIndex - 1, 1);
            if (moved) owner.states.splice(toIndex - 1, 0, moved);
            project.updatedAt = new Date().toISOString();
          }),
        ),
      setAppearanceConditions: (input) =>
        set(
          produce((draft: AccountState) => {
            const { projectId: pId, appearanceIndex, conditions } = input;
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const appearance = findAddressedAppearance(project, input, appearanceIndex);
            if (!appearance) return;
            appearance.if = conditions.length > 0 ? conditions : undefined;
            // Trim joins past the new conditions length so the array
            // doesn't carry stale entries when conditions shrink.
            const maxJoins = Math.max(0, conditions.length - 1);
            if (appearance.ifJoins) {
              if (maxJoins === 0) appearance.ifJoins = undefined;
              else if (appearance.ifJoins.length > maxJoins) appearance.ifJoins.length = maxJoins;
            }
            project.updatedAt = new Date().toISOString();
          }),
        ),
      setAppearanceJoin: (input) =>
        set(
          produce((draft: AccountState) => {
            const { projectId: pId, appearanceIndex, joinIndex, op } = input;
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const appearance = findAddressedAppearance(project, input, appearanceIndex);
            if (!appearance) return;
            const max = Math.max(0, (appearance.if?.length ?? 0) - 1);
            if (joinIndex < 0 || joinIndex >= max) return;
            if (!appearance.ifJoins) appearance.ifJoins = Array(max).fill("and");
            while (appearance.ifJoins.length < max) appearance.ifJoins.push("and");
            appearance.ifJoins[joinIndex] = op;
            project.updatedAt = new Date().toISOString();
          }),
        ),
      setCommandStep: ({ projectId: pId, commandId: cId, path, step, lang }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const cmd = findCommand(draft, pId, cId);
            if (!cmd) return;
            const parent = resolveParentMut(cmd.steps, path.frames);
            if (!parent || path.index < 0 || path.index >= parent.length) return;
            gcStepLTexts(project, [parent[path.index]!]);
            parent[path.index] = step;
            allocStepLTexts(project, cmd.steps, lang, commandKeyPrefix(cId));
            touch(draft, pId);
          }),
        ),
      addCommandStep: ({ projectId: pId, commandId: cId, frames, index, step, lang }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const cmd = findCommand(draft, pId, cId);
            if (!cmd) return;
            const parent = resolveParentMut(cmd.steps, frames);
            if (!parent) return;
            const at = index < 0 || index > parent.length ? parent.length : index;
            parent.splice(at, 0, step);
            allocStepLTexts(project, cmd.steps, lang, commandKeyPrefix(cId));
            touch(draft, pId);
          }),
        ),
      removeCommandStep: ({ projectId: pId, commandId: cId, path }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const cmd = findCommand(draft, pId, cId);
            if (!cmd) return;
            const parent = resolveParentMut(cmd.steps, path.frames);
            if (!parent || path.index < 0 || path.index >= parent.length) return;
            gcStepLTexts(project, [parent[path.index]!]);
            parent.splice(path.index, 1);
            touch(draft, pId);
          }),
        ),
      moveCommandStep: ({ projectId: pId, commandId: cId, frames, fromIndex, toIndex }) =>
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
      addCommandIfCase: ({ projectId: pId, commandId: cId, frames, ifStepIndex }) =>
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
      removeCommandIfCase: ({ projectId: pId, commandId: cId, frames, ifStepIndex, caseIndex }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const cmd = findCommand(draft, pId, cId);
            if (!cmd) return;
            const parent = resolveParentMut(cmd.steps, frames);
            const ifStep = parent?.[ifStepIndex];
            if (!ifStep || ifStep.kind !== "if") return;
            if (caseIndex < 0 || caseIndex >= ifStep.cases.length) return;
            gcStepLTexts(project, ifStep.cases[caseIndex]!.steps);
            ifStep.cases.splice(caseIndex, 1);
            touch(draft, pId);
          }),
        ),
      setCommandIfCaseConditions: ({
        projectId: pId,
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
        projectId: pId,
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
      toggleCommandIfElse: ({ projectId: pId, commandId: cId, frames, ifStepIndex, enabled }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const cmd = findCommand(draft, pId, cId);
            if (!cmd) return;
            const parent = resolveParentMut(cmd.steps, frames);
            const ifStep = parent?.[ifStepIndex];
            if (!ifStep || ifStep.kind !== "if") return;
            if (enabled) {
              if (!ifStep.else) ifStep.else = [];
            } else {
              if (ifStep.else) gcStepLTexts(project, ifStep.else);
              ifStep.else = undefined;
            }
            touch(draft, pId);
          }),
        ),
      addElement: ({ projectId: pId, menuId: mId, element }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const menu = project.menus.find((m) => m.id === mId);
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
            const materialForId = element.display.material ?? undefined;
            const renumberedId = nextElementIdForMaterial(project, materialForId);
            // Clone LText keys so the added element never shares keys with its source.
            // Without this, rekeyProject at deploy time would delete the shared key,
            // breaking the original element's translations.
            const elementToAdd: Element = {
              ...element,
              id: renumberedId,
              positions: formatPositions(newPositions),
              ...(() => {
                const cloneAppearance = (a: Appearance): Appearance => {
                  const cloned = { ...a };
                  if (a.title) {
                    const src = project.i18nKeys[a.title.key];
                    cloned.title = createLText(project, "", project.defaultLang);
                    if (src) project.i18nKeys[cloned.title.key] = { ...src };
                  }
                  if (a.lore) {
                    const src = project.i18nKeys[a.lore.key];
                    cloned.lore = createLText(project, "", project.defaultLang);
                    if (src) project.i18nKeys[cloned.lore.key] = { ...src };
                  }
                  if (a.click) {
                    const click = { ...a.click };
                    for (const handler of Object.values(click)) {
                      if (!handler) continue;
                      for (const action of walkActions(handler.steps)) {
                        if (action.type === "send_message" || action.type === "broadcast") {
                          const src = project.i18nKeys[action.text.key];
                          action.text = createLText(project, "", project.defaultLang);
                          if (src) project.i18nKeys[action.text.key] = { ...src };
                        } else if (action.type === "show_title") {
                          const srcT = project.i18nKeys[action.title.key];
                          action.title = createLText(project, "", project.defaultLang);
                          if (srcT) project.i18nKeys[action.title.key] = { ...srcT };
                          if (action.subtitle) {
                            const srcS = project.i18nKeys[action.subtitle.key];
                            action.subtitle = createLText(project, "", project.defaultLang);
                            if (srcS) project.i18nKeys[action.subtitle.key] = { ...srcS };
                          }
                        }
                      }
                    }
                    cloned.click = click;
                  }
                  return cloned;
                };
                return {
                  display: cloneAppearance(element.display),
                  states: element.states.map(cloneAppearance),
                };
              })(),
            };
            firstLayer.elements.push(elementToAdd);
            project.updatedAt = new Date().toISOString();
          }),
        ),
      moveSelectionByDelta: ({ projectId: pId, menuId: mId, elementIds, dCol, dRow }) => {
        const next = produce(get().account, (draft) => {
          const project = draft.projects.find((p) => p.id === pId);
          if (!project) return;
          const menu = project.menus.find((m) => m.id === mId);
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
          project.updatedAt = new Date().toISOString();
        });
        set({ account: next });
      },
      setAppearanceLore: (input) =>
        set(
          produce((draft: AccountState) => {
            const { projectId: pId, appearanceIndex = 0, lang, value } = input;
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const appearance = findAddressedAppearance(project, input, appearanceIndex);
            if (!appearance) return;
            if (!appearance.lore) {
              appearance.lore = value
                ? createLTextAt(project, appearanceLoreKeyFor(input, appearanceIndex), value, lang)
                : undefined;
            } else if (value) {
              setLText(project, appearance.lore, lang, value);
            } else {
              deleteLText(project, appearance.lore);
              appearance.lore = undefined;
            }
            project.updatedAt = new Date().toISOString();
          }),
        ),
      clearSlot: ({ projectId: pId, menuId: mId, position }) =>
        set(
          produce((draft: AccountState) => {
            const project = draft.account.projects.find((p) => p.id === pId);
            if (!project) return;
            const menu = project.menus.find((m) => m.id === mId);
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
                gcElementLTexts(project, el);
                layer.elements.splice(idx, 1);
              } else {
                el.positions = remaining;
              }
              project.updatedAt = new Date().toISOString();
              return;
            }
          }),
        ),
      pasteEntities: ({ projectId: pId, menus, commands, offset }) => {
        const next = produce(get().account, (draft) => {
          const project = draft.projects.find((p) => p.id === pId);
          if (!project) return;
          // Clone every LText held by the pasted entities under fresh
          // keys, copying the value map from the source. Otherwise the
          // copies would share keys with the originals — editing one
          // would silently alter the other.
          const cloneAppearanceLTexts = (a: Appearance) => cloneAppearanceLTextsInto(project, a);
          for (const m of menus) {
            const stamped: Menu = { ...m, projectId: pId };
            // Clone each text layer's LText under a fresh key, copying the
            // value map so the pasted copy doesn't share keys with the original.
            stamped.title = stamped.title.map((titleLayer) => {
              if (titleLayer.kind !== "text") return titleLayer;
              const src = project.i18nKeys[titleLayer.value.key];
              const cloned = createLText(project, "", project.defaultLang);
              if (src) project.i18nKeys[cloned.key] = { ...src };
              return { ...titleLayer, value: cloned };
            });
            for (const layer of stamped.layers) {
              for (const el of layer.elements) {
                for (const a of addressedAppearances(el)) cloneAppearanceLTexts(a);
              }
            }
            project.menus.push(stamped);
            rekeyMenu(project, stamped);
            (project.canvasLayout as Record<string, { x: number; y: number }>)[stamped.id] = {
              x: offset.x,
              y: offset.y,
            };
            offset.x += 24;
            offset.y += 24;
          }
          for (const c of commands) {
            const stamped: Command = { ...c, projectId: pId };
            for (const action of walkActions(stamped.steps)) {
              if (action.type === "send_message" || action.type === "broadcast") {
                const src = project.i18nKeys[action.text.key];
                action.text = createLText(project, "", project.defaultLang);
                if (src) project.i18nKeys[action.text.key] = { ...src };
              } else if (action.type === "show_title") {
                const srcT = project.i18nKeys[action.title.key];
                action.title = createLText(project, "", project.defaultLang);
                if (srcT) project.i18nKeys[action.title.key] = { ...srcT };
                if (action.subtitle) {
                  const srcS = project.i18nKeys[action.subtitle.key];
                  action.subtitle = createLText(project, "", project.defaultLang);
                  if (srcS) project.i18nKeys[action.subtitle.key] = { ...srcS };
                }
              }
            }
            project.commands.push(stamped);
            rekeyCommand(project, stamped);
            (project.canvasLayout as Record<string, { x: number; y: number }>)[stamped.id] = {
              x: offset.x,
              y: offset.y,
            };
            offset.x += 24;
            offset.y += 24;
          }
        });
        set({ account: next });
      },
      addProjectDataSource: ({ projectId, shape = "table" }) =>
        set((state) =>
          produce(state, (draft) => {
            const project = draft.account.projects.find((p) => p.id === projectId);
            if (!project) return;
            if (!project.dataSources) project.dataSources = [];
            if (!project.dataModels) project.dataModels = [];
            const id = generateDataSourceId();
            const name = nextAvailableName(project.dataSources, "new_source");
            if (shape === "config") {
              project.dataSources.push({ id, name, shape: "config", fields: [], value: {} });
              return;
            }
            // A Table is a table OF a Data model — auto-created with it (ADR
            // project-sources-and-data-models), seeded with its Row key field.
            const modelId = newDataModelId();
            project.dataModels.push({
              id: modelId,
              name,
              keyField: "id",
              fields: [{ name: "id", type: { kind: "string" } }],
            });
            project.dataSources.push({ id, name, shape: "table", modelId, rows: [] });
          }),
        ),
      removeProjectDataSource: ({ projectId, id }) =>
        set((state) =>
          produce(state, (draft) => {
            const project = draft.account.projects.find((p) => p.id === projectId);
            if (!project) return;
            const ds = project.dataSources.find((d) => d.id === id);
            if (!ds) return;
            releaseLTexts(project, visitDataSourceLTexts(project, ds));
            project.dataSources = project.dataSources.filter((d) => d.id !== id);
            // GC the auto-created model when nothing else references it.
            if (ds.shape === "table" && !isDataModelReferenced(project, ds.modelId)) {
              project.dataModels = (project.dataModels ?? []).filter((m) => m.id !== ds.modelId);
            }
          }),
        ),
      renameProjectDataSource: ({ projectId, id, newName }) => {
        const normalizedName = normalizeDataSourceName(newName);
        const project = get().account.projects.find((p) => p.id === projectId);
        if (
          !project ||
          normalizedName === "" ||
          project.dataSources.some(
            (source) => source.id !== id && normalizeDataSourceName(source.name) === normalizedName,
          )
        ) {
          return false;
        }

        let renamed = false;
        set((state) =>
          produce(state, (draft) => {
            const draftProject = draft.account.projects.find((p) => p.id === projectId);
            const dataSource = draftProject?.dataSources.find((source) => source.id === id);
            if (!draftProject || !dataSource) return;
            dataSource.name = normalizedName;
            rekeyDataSource(draftProject, dataSource);
            renamed = true;
          }),
        );
        return renamed;
      },
      editSourceField: ({ projectId, target, edit }) =>
        set((state) =>
          produce(state, (draft) => {
            const project = draft.account.projects.find((p) => p.id === projectId);
            if (!project) return;
            if (target.kind === "model" && (edit.op === "add" || edit.op === "retype")) {
              const t = edit.op === "add" ? edit.field.type : edit.newType;
              if (wouldTypeCreateModelCycle(project.dataModels ?? [], target.modelId, t)) return;
            }
            applyFieldEdit(project, target, edit);
            mintSourceLTexts(project);
          }),
        ),
      renameDataModel: ({ projectId, modelId, newName }) =>
        set((state) =>
          produce(state, (draft) => {
            const project = draft.account.projects.find((p) => p.id === projectId);
            const m = project?.dataModels?.find((x) => x.id === modelId);
            if (m) m.name = newName;
          }),
        ),
      setModelKeyField: ({ projectId, modelId, keyField }) =>
        set((state) =>
          produce(state, (draft) => {
            const project = draft.account.projects.find((p) => p.id === projectId);
            const m = project?.dataModels?.find((x) => x.id === modelId);
            // Placements pinned on the old key dangle — never rewritten (ADR).
            if (m && project) {
              m.keyField = keyField;
              mintSourceLTexts(project);
            }
          }),
        ),
      addSourceRow: ({ projectId, sourceId }) =>
        set((state) =>
          produce(state, (draft) => {
            const project = draft.account.projects.find((p) => p.id === projectId);
            if (!project) return;
            const ds = project.dataSources.find((d) => d.id === sourceId);
            if (ds?.shape !== "table") return;
            const model = project.dataModels?.find((dataModel) => dataModel.id === ds.modelId);
            if (!model) return;
            const row = defaultValueForModelType(
              { kind: "object", fields: sourceRootFields(project, ds) },
              project.dataModels ?? [],
            ) as Record<string, unknown>;
            row[model.keyField] = nextAvailableSourceRowKey(project, ds);
            ds.rows.push(row);
            mintSourceLTexts(project);
          }),
        ),
      removeSourceRow: ({ projectId, sourceId, index }) =>
        set((state) =>
          produce(state, (draft) => {
            const project = draft.account.projects.find((p) => p.id === projectId);
            if (!project) return;
            const ds = project.dataSources.find((d) => d.id === sourceId);
            if (ds?.shape !== "table") return;
            const row = ds.rows[index];
            if (row === undefined) return;
            releaseValueLTexts(project, row, {
              kind: "object",
              fields: sourceRootFields(project, ds),
            });
            ds.rows.splice(index, 1);
            rekeyDataSource(project, ds);
          }),
        ),
      setSourceGranularity: ({ projectId, sourceId, granularity }) =>
        set((state) =>
          produce(state, (draft) => {
            const project = draft.account.projects.find((p) => p.id === projectId);
            const ds = project?.dataSources.find((d) => d.id === sourceId);
            if (!ds || ds.shape !== "table") return;
            if (granularity === "row") ds.granularity = "row";
            else delete ds.granularity;
          }),
        ),
      setSourceValue: ({ projectId, sourceId, row, path, value }) => {
        let nextValue = value;
        if (row !== null && path.length === 1) {
          const project = get().account.projects.find((p) => p.id === projectId);
          const ds = project?.dataSources.find((d) => d.id === sourceId);
          const model =
            ds?.shape === "table"
              ? project?.dataModels?.find((dataModel) => dataModel.id === ds.modelId)
              : undefined;
          const container = ds ? sourceValueContainer(ds, row, []) : undefined;
          if (
            ds?.shape === "table" &&
            model &&
            path[0] === model.keyField &&
            container !== undefined
          ) {
            const validation = validateSourceRowKey(project!, ds, row, value);
            if (!validation.ok) {
              return {
                ok: false,
                reason: validation.reason === "required" ? "required_row_key" : "duplicate_row_key",
              };
            }
            nextValue = validation.value;
          }
        }
        set((state) =>
          produce(state, (draft) => {
            const project = draft.account.projects.find((p) => p.id === projectId);
            if (!project) return;
            const ds = project.dataSources.find((d) => d.id === sourceId);
            if (!ds) return;
            const container = sourceValueContainer(ds, row, path.slice(0, -1));
            const last = path[path.length - 1];
            if (container === undefined || last === undefined) return;
            (container as Record<string | number, unknown>)[last] = nextValue;
            rekeyDataSource(project, ds);
          }),
        );
        return { ok: true };
      },
      addSourceListItem: ({ projectId, sourceId, row, path }) =>
        set((state) =>
          produce(state, (draft) => {
            const project = draft.account.projects.find((p) => p.id === projectId);
            if (!project) return;
            const ds = project.dataSources.find((d) => d.id === sourceId);
            if (!ds) return;
            const listType = sourceTypeAtPath(project, ds, path);
            if (listType?.kind !== "list") return;
            const list = sourceValueContainer(ds, row, path);
            if (!Array.isArray(list)) return;
            list.push(defaultValueForModelType(listType.of, project.dataModels ?? []));
            mintSourceLTexts(project);
          }),
        ),
      removeSourceListItem: ({ projectId, sourceId, row, path, index }) =>
        set((state) =>
          produce(state, (draft) => {
            const project = draft.account.projects.find((p) => p.id === projectId);
            if (!project) return;
            const ds = project.dataSources.find((d) => d.id === sourceId);
            if (!ds) return;
            const listType = sourceTypeAtPath(project, ds, path);
            const list = sourceValueContainer(ds, row, path);
            if (!Array.isArray(list) || list[index] === undefined) return;
            if (listType?.kind === "list") releaseValueLTexts(project, list[index], listType.of);
            list.splice(index, 1);
            rekeyDataSource(project, ds);
          }),
        ),
      replaceSourceValueTyped: ({ projectId, sourceId, row, path, value }) =>
        set((state) =>
          produce(state, (draft) => {
            const project = draft.account.projects.find((p) => p.id === projectId);
            if (!project) return;
            const ds = project.dataSources.find((d) => d.id === sourceId);
            if (!ds) return;
            const type = sourceTypeAtPath(project, ds, path);
            const container = sourceValueContainer(ds, row, path.slice(0, -1));
            const last = path[path.length - 1];
            if (container === undefined || last === undefined) return;
            const old = (container as Record<string | number, unknown>)[last];
            if (type) releaseValueLTexts(project, old, type);
            (container as Record<string | number, unknown>)[last] = value;
            mintSourceLTexts(project);
            rekeyDataSource(project, ds);
          }),
        ),
      deleteFromProject: ({ projectId: pId, nodeIds }) => {
        const ids = new Set(nodeIds);
        const next = produce(get().account, (draft) => {
          const project = draft.projects.find((p) => p.id === pId);
          if (!project) return;
          for (const m of project.menus) {
            if (ids.has(m.id)) gcMenuLTexts(project, m);
          }
          for (const c of project.commands) {
            if (ids.has(c.id)) gcCommandLTexts(project, c);
          }
          for (const d of project.dialogs) {
            if (ids.has(d.id)) gcDialogLTexts(project, d);
          }
          project.menus = project.menus.filter((m) => !ids.has(m.id));
          project.commands = project.commands.filter((c) => !ids.has(c.id));
          project.dialogs = project.dialogs.filter((d) => !ids.has(d.id));
          for (const id of ids) {
            delete (project.canvasLayout as Record<string, { x: number; y: number }>)[id];
          }
          if (project.canvasEdges) {
            for (const key of Object.keys(project.canvasEdges)) {
              const [src, tgt] = key.split("->") as [string, string];
              if (ids.has(src) || ids.has(tgt)) delete project.canvasEdges[key];
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
function rewriteCanvasEdgeIds(project: Project, oldId: string, newId: string) {
  if (!project.canvasEdges) return;
  for (const key of Object.keys(project.canvasEdges)) {
    const [src, tgt] = key.split("->") as [string, string];
    if (src !== oldId && tgt !== oldId) continue;
    const newKey = `${src === oldId ? newId : src}->${tgt === oldId ? newId : tgt}`;
    project.canvasEdges[newKey] = project.canvasEdges[key]!;
    delete project.canvasEdges[key];
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

  for (const project of account.projects ?? []) {
    const i18nKeys = project.i18nKeys ?? {};
    for (const menu of project.menus ?? []) {
      for (const layer of menu.layers ?? []) {
        for (const el of layer.elements ?? []) {
          for (const appearance of el.appearances ?? []) {
            migrateAppearance(appearance, i18nKeys);
          }
        }
      }
    }
    for (const tpl of project.templates ?? []) {
      for (const appearance of tpl.appearances ?? []) {
        migrateAppearance(appearance, i18nKeys);
      }
    }
  }
  return persisted;
};

/**
 * v4 → v5: convert opaque `lt_xxx` i18n keys to semantic dotted-path keys
 * (e.g. `menus.shop_main.title`). Uses `rekeyProject` from `@/domain/i18nSites`
 * to canonicalize every LText key in each project.
 */
// biome-ignore lint/suspicious/noExplicitAny: legacy shape — migration only
// @ts-ignore — kept as dead code; was used by persist middleware
const migrateV4ToV5 = (persisted: unknown): unknown => {
  if (!persisted || typeof persisted !== "object") return persisted;
  // biome-ignore lint/suspicious/noExplicitAny: legacy shape
  const account = (persisted as any).account;
  if (!account) return persisted;
  for (const project of account.projects ?? []) rekeyProject(project);
  return persisted;
};

/**
 * v2 → v3: lift every plain user-facing string (menu/appearance titles,
 * lore lines, send_message text) into an `LText` ref, populating
 * `project.i18nKeys[key][project.defaultLang]` with the original value. The
 * actual walker lives in `lib/i18nMigration` so it can be reused for
 * imported projects at runtime.
 */
// @ts-ignore — kept as dead code; was used by persist middleware
const migrateV2ToV3 = (persisted: unknown): unknown => {
  if (!persisted || typeof persisted !== "object") return persisted;
  // biome-ignore lint/suspicious/noExplicitAny: legacy shape
  const account = (persisted as any).account;
  if (!account) return persisted;
  for (const project of account.projects ?? []) {
    migrateProjectToI18n(project, project.defaultLang ?? "en");
  }
  return persisted;
};

// @ts-ignore — kept as dead code; was used by persist middleware
const migrateV1ToV2 = (persisted: unknown): unknown => {
  if (!persisted || typeof persisted !== "object") return persisted;
  // biome-ignore lint/suspicious/noExplicitAny: legacy v1 shape — we don't model it in TS
  const account = (persisted as any).account;
  if (!account) return persisted;
  for (const project of account.projects ?? []) {
    for (const menu of project.menus ?? []) {
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
    for (const cmd of project.commands ?? []) {
      const v1 = cmd as V1Command;
      if (Array.isArray(v1.actions)) {
        cmd.steps = wrapV1Actions(v1.actions);
        cmd.actions = undefined;
      }
    }
  }
  return persisted;
};
