import { type ComponentType, type ReactElement, type ReactNode, createElement } from "react";
import type { GuiScaleChoice, McScreenLayout } from "../contract/mcScreen";

/**
 * What a module's view needs from the editor that hosts it: the open Project, its texts,
 * the writes to its Documents. The host installs one implementation at boot
 * (`installEditorHost`); a module reaches it only through the functions below, so a
 * bundle loaded at runtime and a module compiled into the editor see the same thing.
 *
 * Projects and Documents stay `unknown` here, as in `DocumentKindContribution`: a module
 * knows the shape of its own Documents, never the host's domain types.
 */
export interface EditorHost {
  /** The open Project `projectId` (a hook: re-renders when it changes), or undefined. */
  useProject(projectId: string): unknown | undefined;
  /** The language texts are edited in (the editor's content-language switch). A hook. */
  useContentLang(): string;
  /** The editor's own interface language ("en", "fr"), for a module's labels. A hook. */
  useUiLang(): string;
  /** Replaces a Document wholesale and sets texts, in one undoable step. */
  updateDocument(input: {
    projectId: string;
    kind: string;
    id: string;
    doc: unknown;
    texts?: TextWrite[];
  }): void;
  /** A fresh text key, for a text site a view adds (its canonical key is set at export). */
  newTextKey(): string;
  /** A text's value in `lang`, else in the Project's default language, else "". */
  text(project: unknown, key: string, lang: string): string;
  /** A text as a Document file carries it: a bare string, or `{lang: text}`. */
  fieldText(project: unknown, key: string): string | Record<string, string>;
  /** The Project's languages, its default first. */
  langs(project: unknown): string[];
  /**
   * Selects a Document, or one of its parts (`board.items` id) when `item` is set: the board
   * lights it up and the Properties panel shows the kind's view with that `item` (SDK 1.2).
   */
  selectDocumentItem(input: { documentId: string; item?: string | null }): void;
  /** Briefly tells the user something (a refused value, a done operation). */
  notify(message: string, tone?: "info" | "error"): void;
  /** The editor's own widgets a module view embeds (SDK 1.1). */
  components: HostComponents;
}

/**
 * An Action chain as a Document file carries it: a list of keyed steps (`{action: args}`,
 * `{if, do, else}`, or an action name alone). Text inside is literal (no i18n key).
 */
export type ActionChainWire = unknown[];

export interface ActionChainEditorProps {
  projectId: string;
  value: ActionChainWire;
  onChange: (steps: ActionChainWire) => void;
}

export interface MaterialInputProps {
  /** The material name (`DIAMOND`), or "" for none. */
  value: string;
  /** The picked or typed material; "" when cleared. */
  onChange: (material: string) => void;
  placeholder?: string;
  "aria-label"?: string;
}

/**
 * An item as a module's Document stores it: the fields of a menu button's appearance
 * (`material`: a vanilla material, `item:<captured id>` or `<namespace>:<id>`; `title`,
 * `lore` (lines), `enchants`, `custom_model_data`, `count`…), text literal (MiniMessage).
 * The plugin builds and compares it with `api.getItems().build` / `matches`.
 */
export type ItemSpecWire = Record<string, unknown>;

/** The criteria of `api.getItems().matches`, in wire form (SDK 1.3). */
export type ItemComparisonWire =
  | "material"
  | "custom_item"
  | "name"
  | "lore"
  | "enchants"
  | "custom_model_data"
  | "damage"
  | "exact";

export interface ItemInputProps {
  projectId: string;
  value: ItemSpecWire;
  onChange: (spec: ItemSpecWire) => void;
  /** The criteria a player's stack is compared on; undefined: the plugin's default for the item. */
  match?: ItemComparisonWire[];
  /** Shows the criteria as boxes to (un)tick; undefined goes back to the default. */
  onMatchChange?: (match: ItemComparisonWire[] | undefined) => void;
}

export interface MiniMessageInputProps {
  /** The raw text, MiniMessage tags included. */
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  "aria-label"?: string;
}

export interface SortableListProps {
  /** One stable id per row, in order: a row keeps its id when it moves. */
  ids: readonly string[];
  /** The row at `from` is dropped at `to` (indexes in `ids`): remove it, insert it at `to`. */
  onMove: (from: number, to: number) => void;
  /** A row's content; `handle` is its drag handle, to place in the row (first, usually). */
  children: (index: number, handle: ReactElement) => ReactNode;
  /** Classes of the list (`<ul>`). */
  className?: string;
  /** Classes of each row (`<li>`). */
  itemClassName?: string;
  /** The handle's accessible name; default: the editor's own ("Drag to reorder"). */
  handleLabel?: string;
}

/**
 * A condition list as a Document file carries it: the keyed wire `api.getConditions()` reads
 * (`{has_permission: vip.use}`, `{not: …}`, `{or: [...]}`…), an AND.
 */
export type ConditionsWire = unknown[];

export interface ConditionsEditorProps {
  projectId: string;
  /** The list; a single condition is read as a list of one. */
  value: ConditionsWire;
  onChange: (conditions: ConditionsWire) => void;
  /** Shown above the list. */
  label?: string;
  /** Shown when the list is empty (default: the editor's "always"). */
  emptyHint?: string;
}

export interface DocumentRefInputProps {
  projectId: string;
  /** The Document kind referenced: `menu`, or a module's (`quest_group`, `conversation`…). */
  kind: string;
  /** The Document's id, `<project>:<id>` for another project's; "" for none. */
  value: string;
  /** The picked reference; "" when cleared. */
  onChange: (id: string) => void;
  "aria-label"?: string;
}

/** What the game applies to text without tags (a lore's purple, the chat's white). */
export interface McTextStyle {
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underlined?: boolean;
  strikethrough?: boolean;
  obfuscated?: boolean;
}

export interface McTextProps {
  /** MiniMessage; `\n` (or `<newline>`) starts a new line. */
  source: string;
  defaults?: McTextStyle;
  /** CSS pixels per MC pixel; inside `McScreen`, its `scale` (× 4 for a title). */
  scale?: number;
  /** Line pitch in MC pixels (chat 9, tooltip 10). */
  lineHeight?: number;
  shadow?: boolean;
  maxLines?: number;
  align?: "left" | "center";
  className?: string;
}

/** A boss bar's colour, as `BossBar.Color` names it. */
export type McBossBarColor = "pink" | "blue" | "red" | "green" | "yellow" | "purple" | "white";

export interface McBossBar {
  /** MiniMessage. */
  name: string;
  /** 0 to 1. */
  progress: number;
  color?: McBossBarColor;
}

/** What a layer drawn inside `McScreen` gets: the layout, and window pixels per GUI pixel. */
export interface McScreenGeometry {
  layout: McScreenLayout;
  /** Window pixels per GUI pixel: a GUI rectangle `r` is at `r.x * scale` in the layer. */
  scale: number;
}

export interface McScreenProps {
  /** The game window, in window pixels (854×480 is the game's default window). */
  width: number;
  height: number;
  /** The GUI scale option; default `"auto"`, as in game. */
  guiScale?: GuiScaleChoice;
  /** `"fit"`: the whole window fits the container's width; a number: CSS pixels per window pixel. */
  zoom?: "fit" | number;
  /** The world behind the HUD; default a sky over grass. */
  backdrop?: "scene" | "none";
  /** The hotbar, `selected` the highlighted slot (0–8); false hides the HUD. */
  hotbar?: false | { selected?: number };
  /** Hearts, food (0–20 each) and experience (`xp` 0–1, `level`); omitted: creative, none. */
  survival?: { health?: number; food?: number; xp?: number; level?: number };
  /** Chat messages (MiniMessage), oldest first, wrapped at the chat's width. */
  chat?: string[];
  /** The chat open, with this text typed (`""` for none); omitted: closed. */
  chatInput?: string;
  /** The action bar's text. */
  actionBar?: string;
  title?: { title: string; subtitle?: string };
  bossBars?: McBossBar[];
  /**
   * An open screen (a menu, a dialog): drawn above the HUD on the game's dimmed background.
   * Place it with `centeredScreen(geometry.layout, w, h)`.
   */
  screen?: (geometry: McScreenGeometry) => ReactNode;
  /** A module's layers (a HUD), drawn above the vanilla HUD and under an open screen. */
  children?: (geometry: McScreenGeometry) => ReactNode;
  className?: string;
}

/** The editor widgets behind the SDK's components (`ActionChainEditor`, `MaterialInput`, `ItemInput`, `MiniMessageInput`, `SortableList`, `ConditionsEditor`, `DocumentRefInput`). */
export interface HostComponents {
  ActionChainEditor: ComponentType<ActionChainEditorProps>;
  MaterialInput: ComponentType<MaterialInputProps>;
  /** SDK 1.3. */
  ItemInput: ComponentType<ItemInputProps>;
  /** SDK 1.4. */
  MiniMessageInput: ComponentType<MiniMessageInputProps>;
  /** SDK 1.10. */
  SortableList: ComponentType<SortableListProps>;
  /** SDK 1.11. */
  ConditionsEditor: ComponentType<ConditionsEditorProps>;
  /** SDK 1.11. */
  DocumentRefInput: ComponentType<DocumentRefInputProps>;
  /** SDK 1.14. */
  McText: ComponentType<McTextProps>;
  /** SDK 1.14. */
  McScreen: ComponentType<McScreenProps>;
}

/** One text written with a Document: the node's key, a language, a value. */
export interface TextWrite {
  key: string;
  lang: string;
  value: string;
}

let host: EditorHost | null = null;

/** Installed once by the editor before any module renders. */
export function installEditorHost(impl: EditorHost): void {
  host = impl;
}

function current(): EditorHost {
  if (!host) throw new Error("@artisan/editor-sdk: no editor host is installed");
  return host;
}

export const useProject = (projectId: string): unknown | undefined =>
  current().useProject(projectId);
export const useContentLang = (): string => current().useContentLang();
export const useUiLang = (): string => current().useUiLang();
export const updateDocument: EditorHost["updateDocument"] = (input) =>
  current().updateDocument(input);
export const newTextKey = (): string => current().newTextKey();
export const textValue = (project: unknown, key: string, lang: string): string =>
  current().text(project, key, lang);
export const fieldText = (project: unknown, key: string): string | Record<string, string> =>
  current().fieldText(project, key);
export const projectLangs = (project: unknown): string[] => current().langs(project);
export const selectDocumentItem: EditorHost["selectDocumentItem"] = (input) =>
  current().selectDocumentItem(input);
export const notify: EditorHost["notify"] = (message, tone) => current().notify(message, tone);

/**
 * The editor's Action chain editor (the one of commands and dialogs) on a controlled value:
 * every action the server declares, Artisan's and the modules', with their forms, plus `if`
 * branches. An action without a declaration is edited as JSON, so nothing is lost.
 */
export function ActionChainEditor(props: ActionChainEditorProps): ReactElement {
  const Impl = current().components.ActionChainEditor;
  return createElement(Impl, props);
}

/** A material field: the item's texture opening the editor's item palette, and the name. */
export function MaterialInput(props: MaterialInputProps): ReactElement {
  const Impl = current().components.MaterialInput;
  return createElement(Impl, props);
}

/**
 * A whole item: the item card of menus opening its form (vanilla, custom or captured item,
 * name, lore, enchantments, custom model data…), and, with `onMatchChange`, the criteria a
 * player's stack is compared on, ticked by default from the item (SDK 1.3).
 */
export function ItemInput(props: ItemInputProps): ReactElement {
  const Impl = current().components.ItemInput;
  return createElement(Impl, props);
}

/**
 * A text field that supports MiniMessage, the way every such field of the editor behaves:
 * rendered until clicked, then the raw text with its live rendering below (SDK 1.4).
 */
export function MiniMessageInput(props: MiniMessageInputProps): ReactElement {
  const Impl = current().components.MiniMessageInput;
  return createElement(Impl, props);
}

/**
 * A list reordered the editor's way: a grip handle per row, dragged with the pointer, or
 * focused and moved with Space, ↑/↓, Space; the drop calls `onMove` once. Lists nest, each
 * keeping its rows (SDK 1.10). Replaces up/down arrow buttons.
 */
export function SortableList(props: SortableListProps): ReactElement {
  const Impl = current().components.SortableList;
  return createElement(Impl, props);
}

/**
 * The editor's condition list (the one of `if` branches and Triggers) on a controlled value in
 * keyed wire: Artisan's conditions with their forms, `not` / `and` / `or` groups. An entry it
 * cannot edit (a module's condition) is kept as written, after the others (SDK 1.11).
 */
export function ConditionsEditor(props: ConditionsEditorProps): ReactElement {
  const Impl = current().components.ConditionsEditor;
  return createElement(Impl, props);
}

/**
 * A reference to a Document of `kind`: the project's Documents of that kind and, qualified
 * `<project>:<id>`, those of the server's other projects, the way an action's `document_ref`
 * argument is picked. A menu shows its title (SDK 1.11).
 */
export function DocumentRefInput(props: DocumentRefInputProps): ReactElement {
  const Impl = current().components.DocumentRefInput;
  return createElement(Impl, props);
}

/**
 * MiniMessage as the client draws it: the vanilla bitmap font, colours, decorations and drop
 * shadow, on a canvas (SDK 1.14). Styled HTML text while the font is not served.
 */
export function McText(props: McTextProps): ReactElement {
  const Impl = current().components.McText;
  return createElement(Impl, props);
}

/**
 * The game's screen at a window size and GUI scale (SDK 1.14): the world, the HUD (hotbar,
 * hearts, experience), boss bars, title, action bar, chat, then a module's layers and an
 * open screen, each placed as the 1.21 client places it (`mcScreenLayout`). Display only: the
 * caller owns what is shown and when.
 */
export function McScreen(props: McScreenProps): ReactElement {
  const Impl = current().components.McScreen;
  return createElement(Impl, props);
}
