/**
 * Domain types for the Artisan editor scaffold.
 *
 * - References (open_menu, template_ref, i18n key) may dangle: a target id
 *   that doesn't resolve at runtime is a no-op (or the plugin surfaces an
 *   error to the player). The editor doesn't enforce hermeticity — packs
 *   can freely reference each other or have stale ids.
 * - "Element" is the canonical name (per main-spec §8.1); the old "Slot" name
 *   from the prior proto is dropped.
 */

export type AccountId = string & { __brand: "AccountId" };
export type PackId = string & { __brand: "PackId" };
export type MenuId = string & { __brand: "MenuId" };
export type CommandId = string & { __brand: "CommandId" };
export type TemplateId = string & { __brand: "TemplateId" };
export type AssetId = string & { __brand: "AssetId" };
export type ElementId = string & { __brand: "ElementId" };
export type LayerId = string & { __brand: "LayerId" };
export type I18nKey = string & { __brand: "I18nKey" };
export type DataSourceId = string & { __brand: "DataSourceId" };
export type SourceRef = string & { __brand: "SourceRef" };
export type DialogId = string & { __brand: "DialogId" };

/**
 * Reference to a localizable string. The actual translations live in
 * `Pack.i18nKeys[key][lang]`. Keys are opaque random ids generated at
 * field creation time — stable across renames of the surrounding entity
 * (menu/element/etc.) so translations don't break when ids change.
 *
 * The user never sees keys: the editor reads through `getText` and writes
 * through `setLText`, both of which take the active language from the UI
 * store and fall back to `Pack.defaultLang` when the active language has
 * no entry yet.
 */
export interface LText {
  key: I18nKey;
}

/**
 * Discrete font heights for `text` and `textarea` title layers. The backend
 * bakes one resource-pack font variant per (Y, size) pair. Restricted to
 * vanilla and upscale multiples — downscale (h<8) was dropped because
 * nearest-neighbor downsampling renders ASCII glyphs illegible and MC's
 * 1-pixel bold offset becomes visually dominant. Default 8 = vanilla.
 */
export type TextSize = 8 | 12 | 16 | 20 | 24 | 32;

export type MenuTitleLayer =
  | { kind: "background"; assetId: AssetId }
  | { kind: "glyph"; assetId: AssetId; x: number; y: number }
  | { kind: "text"; value: LText; x: number; y: number;
      fontAssetId?: AssetId;
      color?: string;
      size?: TextSize }
  /** Plain vanilla title — no resource pack required. Emitted as a raw
   *  MiniMessage string in YAML (legacy format) so any server can use it. */
  | { kind: "plain"; value: LText; color?: string }
  /** Multi-line text block. `value` resolves to a string containing literal
   *  `\n`s; the runtime splits and renders one line per split at
   *  `(x, y + i * lineHeight)`. Lines share alignment + optional font. */
  | { kind: "textarea"; value: LText; x: number; y: number;
      width: number;
      lineHeight: number;
      alignment: "left" | "center" | "right";
      fontAssetId?: AssetId;
      size?: TextSize }
  | { kind: "external_glyph"; provider: "oraxen" | "nexo" | "itemsadder";
      glyphName: string; x: number; y: number };

export type PackSource = "user_created" | "imported" | "forked";

export interface Account {
  id: AccountId;
  packs: Pack[];
  packOrder: PackId[];
}

export interface Pack {
  id: PackId;
  name: string;
  description?: string;
  source: PackSource;
  sourcePackId?: PackId;
  sourceVersion?: string;
  serverKeyId?: string;
  createdAt: string;
  updatedAt: string;
  menus: Menu[];
  commands: Command[];
  templates: Template[];
  assets: Asset[];
  dataSources: DataSource[];
  importedConnectors: ConnectorSpec[];
  i18nKeys: Record<I18nKey, Record<string, string>>;
  defaultLang: string;
  dialogs: Dialog[];
  canvasLayout: Record<MenuId | CommandId | DialogId, { x: number; y: number }>;
}

export interface Menu {
  id: MenuId;
  packId: PackId;
  title: MenuTitleLayer[];
  rows: 1 | 2 | 3 | 4 | 5 | 6;
  permission?: string;
  /**
   * Internal admin notes, never rendered to players (menu/v1 `notes`).
   * The AI assistant records non-mappable source constructs here on import.
   */
  notes?: string;
  layers: Layer[];
  /**
   * Named values the menu expects when opened — typically passed by the
   * caller (a command, or a parent menu's `open_menu` action). Inside the
   * menu, every Element's title/lore/click actions can reference these
   * via `{name}` placeholders.
   */
  contextInputs?: ContextInput[];
}

export type ContextInput =
  | {
      kind: "primitive";
      name: string;
      /** `list`/`object` = caller-provided structured data (e.g. an iteration alias). */
      type: "player" | "string" | "integer" | "number" | "boolean" | "list" | "object";
      default?: string;
    }
  | {
      kind: "sourceRef";
      name: string;
      ref: SourceRef;
    };

export interface Layer {
  id: LayerId;
  name: string;
  elements: Element[];
}

export interface Element {
  id: ElementId;
  positions: string;
  appearances: Appearance[];
  templateRef?: { id: TemplateId; vars: Record<string, string> };
  tags?: string[];
  /**
   * Iteration: when set, this element is rendered once per item of the
   * source list (a placeholder pointing to a list-typed value in the
   * menu's context, e.g. `quests`). Each iteration's `alias` (e.g.
   * `quest`) becomes a placeholder available inside this element's
   * title / lore / click actions, scoped to the current item.
   */
  iterates?: { source: string; alias: string };
}

export interface Appearance {
  if?: Condition[];
  /** Per-joiner ops between consecutive `if` conditions. Defaults to "and". */
  ifJoins?: ("and" | "or")[];
  assetId?: AssetId;
  material?: string;
  count?: number;
  title?: LText;
  lore?: LText | null;
  click?: ClickMap;
}

export type ClickType = "left" | "right" | "shift_left" | "shift_right" | "middle";
export type ClickMap = Partial<Record<ClickType, ClickHandler>>;

/**
 * Click handler is a sequential list of `Step`s. Each step is either a
 * leaf action or an `if`-branch with one or more cases (the if/else-if
 * list) and an optional else-branch. This recursive shape lets the user
 * compose chains with arbitrary branching, which is what real Minecraft
 * GUI plugins actually need.
 */
export interface ClickHandler {
  steps: Step[];
}

export type Step =
  | { kind: "action"; action: Action }
  | { kind: "if"; cases: IfCase[]; else?: Step[] };

/**
 * One arm of an if/else-if chain.
 *
 *   joins[i] is the boolean operator between conditions[i] and
 *   conditions[i+1]. Length is `max(0, conditions.length - 1)`. Missing
 *   entries default to "and".
 *
 *   Standard precedence at runtime: AND binds tighter than OR. So
 *   `A AND B OR C AND D` evaluates as `(A AND B) OR (C AND D)`.
 *
 * For unary negation use `Condition` of type `not`. Composite AND/OR
 * conditions also exist for explicit grouping when precedence isn't enough.
 */
export interface IfCase {
  conditions: Condition[];
  joins?: ("and" | "or")[];
  steps: Step[];
}

export type Action =
  | {
      type: "open_menu";
      menuId: MenuId;
      clearContext?: boolean;
      /**
       * Values passed to the target menu's contextInputs when it opens.
       * Keys are the target input names; values are template strings
       * that may reference placeholders from the caller scope (e.g.
       * `{player}`, `{quest.name}`).
       */
      context?: Record<string, string>;
    }
  | { type: "close_menu" }
  | { type: "run_command"; command: string; as: "player" | "console" }
  | { type: "send_message"; text: LText }
  /**
   * Display a Minecraft HUD title (and optional subtitle) to the
   * triggering player. Mirrors Adventure's `Audience.showTitle(Title)`.
   * `title` and `subtitle` are LText refs so they translate per-player;
   * timings are ticks (50ms each). Defaults match Adventure: 10/70/20.
   */
  | {
      type: "show_title";
      title: LText;
      subtitle?: LText;
      fadeIn?: number;
      stay?: number;
      fadeOut?: number;
    }
  | { type: "give_item"; material: string; count: number }
  | { type: "take_item"; material: string; count: number }
  | { type: "take_money"; amount: number }
  | { type: "give_money"; amount: number }
  | { type: "give_xp"; amount: number }
  | { type: "give_level"; amount: number }
  /** Broadcast to every online player (vs send_message → triggering player only). */
  | { type: "broadcast"; text: LText }
  /** Play a sound to the triggering player. `sound` is a Bukkit Sound name. */
  | { type: "play_sound"; sound: string; volume?: number; pitch?: number }
  /** Teleport to coordinates. */
  | { type: "teleport"; world: string; x: number; y: number; z: number; yaw?: number; pitch?: number }
  /**
   * Advance pagination of an iterating element. If `targetElementId` is
   * unset the runtime paginates every iterating element in the current
   * menu (handy for a single "Next page" button when there's only one
   * list). With it set, only that element's pagination flips — useful
   * when a menu has several iterables, each with its own pager.
   */
  | { type: "paginate"; direction: "next" | "prev"; targetElementId?: ElementId }
  /**
   * Mutate a context input of the current menu. `value` is an Expression
   * (DSL). After the mutation, the runtime triggers a re-render of the
   * current menu. `arg` MUST match an existing Menu.contextInputs[*].name.
   */
  | { type: "set_arg"; arg: string; value: string }
  /**
   * Cycle a context input through a list. `list` is an Expression
   * evaluating to a list. The runtime finds the current value's index
   * (looseEq), advances by ±1 wrapping at endpoints, and writes the
   * new value to contextInput[arg]. Then triggers re-render.
   *
   * If `arg` is unknown or `list` doesn't evaluate to a non-empty list,
   * the action is a no-op (warn-logged).
   */
  | { type: "set_arg_cycle_next"; arg: string; list: string }
  | { type: "set_arg_cycle_prev"; arg: string; list: string }
  | {
      type: "open_dialog";
      dialogId: DialogId;
      context?: Record<string, string>;
      clearContext?: boolean;
    }
  | { type: "close_dialog" };

export type Condition =
  | { type: "has_permission"; perm: string }
  | { type: "has_money"; amount: number }
  /**
   * Compare a placeholder to a literal value. The placeholder string can
   * reference a contextInput ({category}), an iteration field
   * ({alias.field}), or a PAPI placeholder (%vault_eco_balance%).
   */
  | { type: "placeholder_equals"; placeholder: string; value: string }
  /**
   * Match a placeholder against a regex. Same placeholder semantics as
   * placeholder_equals.
   */
  | { type: "placeholder_match"; placeholder: string; regex: string }
  // The following mirror the wire shape exactly (snake_case fields) — the
  // exporter passes conditions through as-is, so domain = menu/v1 here.
  | { type: "has_item"; material: string; count: number }
  | { type: "has_xp"; amount: number }
  | { type: "has_level"; level: number }
  | { type: "world_is"; world: string }
  | { type: "time_is"; range: "day" | "night" | { from_ticks: number; to_ticks: number } }
  | { type: "random_chance"; probability: number }
  | { type: "cooldown_passed"; cooldown_id: string }
  | { type: "player_in_region"; region: string }
  | { type: "pagination_at_first"; elementId?: string }
  | { type: "pagination_at_last"; elementId?: string }
  | { type: "not"; of: Condition }
  | { type: "and"; of: Condition[] }
  | { type: "or"; of: Condition[] }
  /**
   * Free-form boolean expression evaluated via the DSL (cf.
   * web/src/lib/expr/). Used when typed conditions don't fit, e.g.
   * comparisons with operators other than == or against runtime
   * iteration fields.
   */
  | { type: "expression"; expr: string };

export interface Command {
  id: CommandId;
  packId: PackId;
  name: string;
  aliases?: string[];
  permission?: string;
  description?: string;
  arguments: CommandArg[];
  steps: Step[];
}

export interface CommandArg {
  name: string;
  type: "player" | "string" | "integer" | "number" | "boolean";
  required: boolean;
  default?: string;
}

export interface Template {
  id: TemplateId;
  packId: PackId;
  name: string;
  variables: { name: string; type: string }[];
  appearances: Appearance[];
}

export interface Asset {
  id: AssetId;
  packId: PackId;
  name: string;
  url: string;
  width: number;
  height: number;
}

/**
 * Recursive type descriptor for a data source's shape. Discriminated by
 * `kind`. Primitives (string/number/integer/boolean) are leaves.
 * `list` and `object` recurse — `list of {kind: object, fields: [...]}` is
 * the canonical "list of records" shape used by most connectors.
 */
export type FieldType =
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "integer" }
  | { kind: "boolean" }
  | { kind: "list"; of: FieldType }
  | { kind: "object"; fields: { name: string; type: FieldType }[] };

/**
 * Admin-made source of typed data. Lives on the pack and is referenced
 * by menus via `ContextInput { kind: "sourceRef", ref: "pack:<id>" }`.
 * Renaming the source updates referencing inputs atomically (cf.
 * accountStore reducers in Plan C2).
 */
export interface DataSource {
  id: DataSourceId;
  name: string;
  type: FieldType;
  /**
   * Concrete data, validated against `type` at edit time. Stored as
   * unknown because the shape varies — runtime/preview consumers cast
   * after schema lookup.
   */
  value: unknown;
}

/**
 * Spec of a plugin-sourced connector. Either pushed to the editor via
 * WS at server connection (plan paid) or manually imported from a YAML
 * file generated by the Artisan plugin (plan free). Stored on the
 * pack so exports ship with their connector specs.
 */
export interface ConnectorSpec {
  /** Stable namespaced ref, e.g. "chestshop:items", "essentials:warps". */
  ref: string;
  type: FieldType;
  /** 3-5 sample items validated against `type`. */
  sample: unknown;
}

export interface Dialog {
  id: DialogId;
  packId: PackId;
  title: LText;
  canCloseWithEscape: boolean;
  body: DialogBody[];
  inputs: DialogInput[];
  buttons: DialogButton[];
}

export type DialogBody =
  | { type: "text"; text: LText }
  | { type: "item"; material: string; count: number };

export type DialogInput =
  | { type: "text"; id: string; label: LText; default: string; maxLength: number }
  | { type: "bool"; id: string; label: LText; default: boolean }
  | {
      type: "number_range";
      id: string;
      label: LText;
      min: number;
      max: number;
      default: number;
    }
  | {
      type: "single_option";
      id: string;
      label: LText;
      options: DialogOption[];
      default: string;
    };

export interface DialogOption {
  value: string;
  label: LText;
}

export interface DialogButton {
  id: string;
  label: LText;
  steps: Step[];
}
