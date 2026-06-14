import type { Pack } from "@/domain/types";
import { getText } from "@/lib/i18n";
import { getFirstTitleText } from "@/domain/menuTitle";
import { parsePositions } from "@/lib/positions";

export type SearchGroup = "menu" | "command" | "dialog" | "content";

export interface SearchEntry {
  id: string;
  group: SearchGroup;
  label: string;
  context?: string;
  haystack: string;
  target: { openId: string; selectId?: string; focusedSlot?: number };
}

function entry(partial: Omit<SearchEntry, "haystack">): SearchEntry {
  const haystack = `${partial.label} ${partial.context ?? ""}`.toLowerCase();
  return { ...partial, haystack };
}

/** Flatten a pack into searchable entries (element-level + content-level). Pure. */
export function buildSearchIndex(pack: Pack, activeLang: string): SearchEntry[] {
  const out: SearchEntry[] = [];

  for (const menu of pack.menus ?? []) {
    const lt = getFirstTitleText(menu);
    const menuLabel = (lt ? getText(pack, lt, activeLang) : "") || menu.id;
    out.push(entry({ id: `menu:${menu.id}`, group: "menu", label: menuLabel, target: { openId: menu.id } }));

    for (const layer of menu.layers ?? []) {
      for (const el of layer.elements ?? []) {
        const ap = el.appearances?.[0];
        if (!ap) continue;
        const slot = parsePositions(el.positions)[0];
        const baseTarget = { openId: menu.id, selectId: el.id, focusedSlot: slot };
        if (ap.material) {
          out.push(entry({ id: `item:${menu.id}:${el.id}`, group: "content", label: ap.material, context: `dans ${menuLabel}`, target: baseTarget }));
        }
        const title = getText(pack, ap.title, activeLang);
        if (title) out.push(entry({ id: `itemtitle:${menu.id}:${el.id}`, group: "content", label: title, context: `titre · ${menuLabel}`, target: baseTarget }));
        const lore = getText(pack, ap.lore ?? undefined, activeLang);
        if (lore) out.push(entry({ id: `itemlore:${menu.id}:${el.id}`, group: "content", label: lore, context: `lore · ${menuLabel}`, target: baseTarget }));
      }
    }
  }

  for (const cmd of pack.commands ?? []) {
    out.push(entry({ id: `command:${cmd.id}`, group: "command", label: `/${cmd.name}`, target: { openId: cmd.id } }));
  }

  for (const dialog of pack.dialogs ?? []) {
    const dlabel = getText(pack, dialog.title, activeLang) || dialog.id;
    out.push(entry({ id: `dialog:${dialog.id}`, group: "dialog", label: dlabel, target: { openId: dialog.id } }));
    for (let i = 0; i < (dialog.body ?? []).length; i++) {
      const b = dialog.body[i]!;
      if (b.type === "text") {
        const text = getText(pack, b.text, activeLang);
        if (text) out.push(entry({ id: `dbody:${dialog.id}:${i}`, group: "content", label: text, context: `dialog · ${dlabel}`, target: { openId: dialog.id } }));
      }
    }
    for (const btn of dialog.buttons ?? []) {
      const text = getText(pack, btn.label, activeLang);
      if (text) out.push(entry({ id: `dbtn:${dialog.id}:${btn.id}`, group: "content", label: text, context: `bouton · ${dlabel}`, target: { openId: dialog.id } }));
    }
  }

  return out;
}

const GROUP_RANK: Record<SearchGroup, number> = { menu: 0, command: 0, dialog: 0, content: 1 };

/** Filter + rank. Case-insensitive substring match. Empty query → []. */
export function searchQuery(entries: SearchEntry[], q: string): SearchEntry[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const scored: { e: SearchEntry; score: number }[] = [];
  for (const e of entries) {
    const label = e.label.toLowerCase();
    let matchScore: number;
    if (label === needle) matchScore = 0;
    else if (label.startsWith(needle)) matchScore = 1;
    else if (e.haystack.includes(needle)) matchScore = 2;
    else continue;
    scored.push({ e, score: matchScore * 10 + GROUP_RANK[e.group] });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.map((s) => s.e);
}
