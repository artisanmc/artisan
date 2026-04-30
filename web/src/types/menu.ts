/**
 * Menu schema — internal v0 (frozen for the alpha MVP, will be migrated to public
 * v1 schema per the office hours design doc).
 */

export type ClickType = 'left' | 'right' | 'shift-left' | 'shift-right';

export type ActionKind = 'cond' | 'do' | 'else';

export interface ActionArg {
  k: string;
  v: string;
}

export interface ActionCard {
  /** Display tag — 'if' / 'do' / 'else'. */
  tag: 'if' | 'do' | 'else';
  /** Color/lane category. */
  kind: ActionKind;
  /** Position within the do-chain (1-based). Optional for cond/else. */
  n?: number;
  /** Action / condition name (e.g. 'has_money', 'take_money'). */
  name: string;
  /** Arguments rendered as key/value pairs. */
  args: ActionArg[];
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  count: number;
  active: boolean;
  premium?: boolean;
}

export type SlotKind =
  | 'item'
  | 'cat'
  | 'nav'
  | 'label'
  | 'page'
  | 'balance';

export interface SlotData {
  row: number;
  col: number;
  kind: SlotKind;
  icon?: string;
  title?: string;
  lore?: string;
  price?: number;
  count?: number;
  states?: number;
  premium?: boolean;
  template?: boolean;
  locked?: boolean;
  component?: string;
  selected?: boolean;
  action?: string;
}

export interface MenuData {
  menuName: string;
  menuTitle: string;
  rows: number;
  categories: Category[];
  items: SlotData[];
}

export type PaletteKind = 'vanilla' | 'assets' | 'plugin' | 'tpl';

export interface PaletteTabData {
  title: string;
  count: string;
  shown: number;
  items: string[];
  kind: PaletteKind;
  tag?: string;
}

export type PaletteTabKey = 'vanilla' | 'assets' | 'questx' | 'tpl';
