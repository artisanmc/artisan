/**
 * Domain types for the Interfaze editor scaffold.
 *
 * - Pack is hermetic: every reference (open_menu, template_ref, i18n key) must
 *   target an entity in the same pack. Enforced by `assertPackHermetic` (see
 *   invariants.ts), not by these types.
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
  createdAt: string;
  updatedAt: string;
  menus: Menu[];
  commands: Command[];
  templates: Template[];
  assets: Asset[];
  i18nKeys: Record<I18nKey, Record<string, string>>;
  defaultLang: string;
  canvasLayout: Record<MenuId | CommandId, { x: number; y: number }>;
}

export interface Menu {
  id: MenuId;
  packId: PackId;
  title: string;
  rows: 1 | 2 | 3 | 4 | 5 | 6;
  permission?: string;
  background?: { assetId: AssetId };
  layers: Layer[];
}

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
}

export interface Appearance {
  if?: Condition[];
  assetId?: AssetId;
  material?: string;
  count?: number;
  title?: string;
  lore?: string[];
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
 *   match = "all" (default) → AND-join the conditions
 *   match = "any"           → OR-join the conditions
 *
 * For mixed boolean expressions, wrap nested conditions inside a `not` (the
 * Condition tree itself doesn't yet have AND/OR — fold via nested cases).
 */
export interface IfCase {
  conditions: Condition[];
  match?: "all" | "any";
  steps: Step[];
}

export type Action =
  | { type: "open_menu"; menuId: MenuId; clearContext?: boolean }
  | { type: "close_menu" }
  | { type: "run_command"; command: string; as: "player" | "console" }
  | { type: "send_message"; text: string }
  | { type: "give_item"; material: string; count: number }
  | { type: "take_money"; amount: number };

export type Condition =
  | { type: "has_permission"; perm: string }
  | { type: "has_money"; amount: number }
  | { type: "not"; of: Condition }
  | { type: "and"; of: Condition[] }
  | { type: "or"; of: Condition[] };

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
