import { getFirstTitleText } from "@/domain/menuTitle";
import type { Project } from "@/domain/types";
import { getText } from "@/lib/i18n";
import { parsePositions } from "@/lib/positions";

export type SearchGroup = "menu" | "command" | "dialog" | "content";

export interface SearchEntry {
  id: string;
  group: SearchGroup;
  label: string;
  /** Où se trouve le match — traduit par la palette via t(context.key, { owner }). */
  context?: { key: string; owner: string };
  haystack: string;
  target: { openId: string; selectId?: string; focusedSlot?: number };
}

function entry(partial: Omit<SearchEntry, "haystack">): SearchEntry {
  const haystack = `${partial.label} ${partial.context?.owner ?? ""}`.toLowerCase();
  return { ...partial, haystack };
}

/** Flatten a project into searchable entries (element-level + content-level). Pure. */
export function buildSearchIndex(project: Project, activeLang: string): SearchEntry[] {
  const out: SearchEntry[] = [];

  for (const menu of project.menus ?? []) {
    const lt = getFirstTitleText(menu);
    const menuLabel = (lt ? getText(project, lt, activeLang) : "") || menu.id;
    out.push(
      entry({
        id: `menu:${menu.id}`,
        group: "menu",
        label: menuLabel,
        target: { openId: menu.id },
      }),
    );

    for (const layer of menu.layers ?? []) {
      for (const el of layer.elements ?? []) {
        // display seulement ; les états conditionnels ne sont pas indexés
        const ap = el.display;
        if (!ap) continue;
        // première slot de l'élément (ancre de navigation) ; undefined si positions vide
        const slot = parsePositions(el.positions)[0];
        const baseTarget = { openId: menu.id, selectId: el.id, focusedSlot: slot };
        if (ap.material) {
          out.push(
            entry({
              id: `item:${menu.id}:${el.id}`,
              group: "content",
              label: ap.material,
              context: { key: "search.ctxInMenu", owner: menuLabel },
              target: baseTarget,
            }),
          );
        }
        const title = getText(project, ap.title, activeLang);
        if (title)
          out.push(
            entry({
              id: `itemtitle:${menu.id}:${el.id}`,
              group: "content",
              label: title,
              context: { key: "search.ctxItemTitle", owner: menuLabel },
              target: baseTarget,
            }),
          );
        const lore = getText(project, ap.lore ?? undefined, activeLang);
        if (lore)
          out.push(
            entry({
              id: `itemlore:${menu.id}:${el.id}`,
              group: "content",
              label: lore,
              context: { key: "search.ctxItemLore", owner: menuLabel },
              target: baseTarget,
            }),
          );
      }
    }
  }

  for (const cmd of project.commands ?? []) {
    out.push(
      entry({
        id: `command:${cmd.id}`,
        group: "command",
        label: `/${cmd.name}`,
        target: { openId: cmd.id },
      }),
    );
  }

  for (const dialog of project.dialogs ?? []) {
    const dlabel = getText(project, dialog.title, activeLang) || dialog.id;
    out.push(
      entry({
        id: `dialog:${dialog.id}`,
        group: "dialog",
        label: dlabel,
        target: { openId: dialog.id },
      }),
    );
    const body = dialog.body ?? [];
    for (let i = 0; i < body.length; i++) {
      const b = body[i];
      if (b && b.type === "text") {
        const text = getText(project, b.text, activeLang);
        if (text)
          out.push(
            entry({
              id: `dbody:${dialog.id}:${i}`,
              group: "content",
              label: text,
              context: { key: "search.ctxDialogBody", owner: dlabel },
              target: { openId: dialog.id },
            }),
          );
      }
    }
    for (const btn of dialog.buttons ?? []) {
      const text = getText(project, btn.label, activeLang);
      if (text)
        out.push(
          entry({
            id: `dbtn:${dialog.id}:${btn.id}`,
            group: "content",
            label: text,
            context: { key: "search.ctxDialogButton", owner: dlabel },
            target: { openId: dialog.id },
          }),
        );
    }
  }

  return out;
}

/** Réordonne des résultats déjà classés par score en groupes CONTIGUS,
 *  dans l'ordre de première apparition (le groupe du meilleur match d'abord),
 *  en préservant l'ordre intra-groupe. Ne change pas le classement, seulement
 *  la contiguïté d'affichage (évite les en-têtes de groupe répétés). */
export function groupResultsForDisplay(results: SearchEntry[]): SearchEntry[] {
  const buckets = new Map<SearchGroup, SearchEntry[]>();
  for (const r of results) {
    const b = buckets.get(r.group);
    if (b) b.push(r);
    else buckets.set(r.group, [r]); // first appearance defines group order (Map preserves insertion)
  }
  return [...buckets.values()].flat();
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
