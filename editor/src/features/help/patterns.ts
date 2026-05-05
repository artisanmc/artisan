/**
 * Static catalog of 15 reference snippets shown in the Patterns Gallery.
 *
 * Each pattern has:
 *  - id: stable key for i18n (pattern.<id>.name and pattern.<id>.desc)
 *  - kind: lore | condition | action — drives the badge color
 *  - snippet: the literal text the admin copies. Verbatim, no
 *             interpolation. Quotes inside snippets are intentional
 *             (the DSL grammar requires them for string literals).
 */

export type PatternKind = "lore" | "condition" | "action";

export interface Pattern {
  id: string;
  kind: PatternKind;
  snippet: string;
}

export const PATTERNS: Pattern[] = [
  { id: "placeholder", kind: "lore", snippet: "{quest.name}" },
  {
    id: "colorByAmount",
    kind: "lore",
    snippet: '{quest.gold > 1000 ? "<gold>" : "<gray>"}{quest.gold}',
  },
  {
    id: "vipBadge",
    kind: "lore",
    snippet: '{%player_has_permission_vip% == "true" ? "VIP" : ""}',
  },
  { id: "joinComma", kind: "lore", snippet: '{quest.tags.join(", ")}' },
  { id: "joinNewline", kind: "lore", snippet: '{quest.tags.join("\\n")}' },
  { id: "pageOfN", kind: "lore", snippet: "Page {index + 1} of {count}" },
  { id: "starOnFirst", kind: "lore", snippet: '{first ? "★ " : ""}{quest.name}' },
  {
    id: "lockedIfNoPerm",
    kind: "lore",
    snippet:
      '{%player_has_permission_shop_vip% == "true" ? "" : "<dark_gray>(VIP required)</dark_gray>"}',
  },
  {
    id: "compareBalanceToPrice",
    kind: "lore",
    snippet: '{%vault_eco_balance% >= quest.gold ? "<green>Buy" : "<red>Too expensive"}',
  },
  {
    id: "rarityPrefix",
    kind: "lore",
    snippet: '{quest.rarity == "legendary" ? "<gold>★ " : ""}{quest.name}',
  },
  { id: "countTags", kind: "lore", snippet: "{quest.tags.length()} categories" },
  { id: "firstOrDefault", kind: "lore", snippet: "{quest.tags.first()}" },
  {
    id: "cycleCategory",
    kind: "action",
    snippet: "set_arg_cycle_next: arg=current_tag, list=categories",
  },
  { id: "resetCategory", kind: "action", snippet: 'set_arg: arg=current_tag, value="weapon"' },
  { id: "i18nReuse", kind: "lore", snippet: "{i18n:common.coins}" },
];
