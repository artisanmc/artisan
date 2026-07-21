import { parse, stringify } from "yaml";
import type { BoutiqueCategory, BoutiqueItem, BoutiqueState } from "./state";

/** Mechanical legacy migration: one console `run_command "…" as console` DSL line
 *  per command, `%player%` → `{player}` (the step engine's arg placeholder),
 *  joined by newlines. Empty list → empty string. */
export function migrateBuyCommands(commands: string[]): string {
  return commands
    .map((cmd) => `run_command ${JSON.stringify(cmd.replace(/%player%/g, "{player}"))} as console`)
    .join("\n");
}

export function serializeShopYaml(state: BoutiqueState): string {
  return stringify({
    schema: "boutique/v1",
    whole_shop_discount: state.wholeShopDiscount,
    categories: state.categories.map((c) => ({
      id: c.id, name: c.name, icon: c.icon, discount: c.discount,
      items: c.items.map((i) => ({
        id: i.id, name: i.name, icon: i.icon, price: i.price, discount: i.discount,
        lore: i.lore, actions: i.actions,
      })),
    })),
  });
}

export function parseShopYaml(content: string): BoutiqueState | null {
  let root: unknown;
  try { root = parse(content); } catch { return null; }
  if (typeof root !== "object" || root === null) return null;
  const r = root as Record<string, unknown>;
  if (r.schema !== "boutique/v1") return null;
  const categories: BoutiqueCategory[] = (Array.isArray(r.categories) ? r.categories : []).map((c) => {
    const cat = c as Record<string, unknown>;
    const items: BoutiqueItem[] = (Array.isArray(cat.items) ? cat.items : []).map((i) => {
      const it = i as Record<string, unknown>;
      return {
        id: String(it.id ?? ""), name: String(it.name ?? ""), icon: String(it.icon ?? "BARRIER"),
        price: Number(it.price ?? 0), discount: Number(it.discount ?? 0),
        lore: (Array.isArray(it.lore) ? it.lore : []).map(String),
        actions: typeof it.actions === "string"
          ? it.actions
          : migrateBuyCommands(Array.isArray(it.buy_commands) ? it.buy_commands.map(String) : []),
      };
    });
    return {
      id: String(cat.id ?? ""), name: String(cat.name ?? ""), icon: String(cat.icon ?? "CHEST"),
      discount: Number(cat.discount ?? 0), items,
    };
  });
  return { wholeShopDiscount: Number(r.whole_shop_discount ?? 0), categories };
}
