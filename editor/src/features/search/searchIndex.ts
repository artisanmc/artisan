import { CORE_DOCUMENT_KINDS } from "@/domain/documentKinds";
import { allDocuments, commandsOf, dialogsOf, menusOf } from "@/domain/documents";
import { getFirstTitleText } from "@/domain/menuTitle";
import type { Project } from "@/domain/types";
import { getText } from "@/lib/i18n";
import { documentTitle } from "@/lib/moduleDocumentKinds";
import { parsePositions } from "@/lib/positions";
import { documentKindContribution } from "@artisan/editor-sdk";

/** `menu`, `command`, `dialog`, a module's kind, or `content` (a text inside a Document). */
export type SearchGroup = string;

export interface SearchEntry {
  id: string;
  group: SearchGroup;
  label: string;
  /** Where the match is — translated by the palette via t(context.key, { owner }). */
  context?: { key: string; owner: string };
  haystack: string;
  /** `projectUrlId`: the Document lives in another project of the server. */
  target: {
    openId: string;
    /** The kind of `openId`'s Document: two kinds may share an id. */
    kind: string;
    selectId?: string;
    focusedSlot?: number;
    projectUrlId?: string;
  };
}

function entry(partial: Omit<SearchEntry, "haystack">): SearchEntry {
  const haystack = `${partial.label} ${partial.context?.owner ?? ""}`.toLowerCase();
  return { ...partial, haystack };
}

/** Flatten a project into searchable entries (element-level + content-level). Pure. */
export function buildSearchIndex(project: Project, activeLang: string): SearchEntry[] {
  const out: SearchEntry[] = [];

  for (const menu of menusOf(project)) {
    const lt = getFirstTitleText(menu);
    const menuLabel = (lt ? getText(project, lt, activeLang) : "") || menu.id;
    out.push(
      entry({
        id: `menu:${menu.id}`,
        group: "menu",
        label: menuLabel,
        target: { openId: menu.id, kind: "menu" },
      }),
    );

    for (const layer of menu.layers ?? []) {
      for (const el of layer.elements ?? []) {
        // display only; conditional states are not indexed
        const ap = el.display;
        if (!ap) continue;
        // the element's first slot (navigation anchor); undefined if positions is empty
        const slot = parsePositions(el.positions)[0];
        const baseTarget = { openId: menu.id, kind: "menu", selectId: el.id, focusedSlot: slot };
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

  for (const cmd of commandsOf(project)) {
    out.push(
      entry({
        id: `command:${cmd.id}`,
        group: "command",
        label: `/${cmd.name}`,
        target: { openId: cmd.id, kind: "command" },
      }),
    );
  }

  for (const dialog of dialogsOf(project)) {
    const dlabel = getText(project, dialog.title, activeLang) || dialog.id;
    out.push(
      entry({
        id: `dialog:${dialog.id}`,
        group: "dialog",
        label: dlabel,
        target: { openId: dialog.id, kind: "dialog" },
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
              target: { openId: dialog.id, kind: "dialog" },
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
            target: { openId: dialog.id, kind: "dialog" },
          }),
        );
    }
  }

  // A module's kind: one entry per Document, labelled by its kind's title.
  const core = new Set(CORE_DOCUMENT_KINDS.map((k) => k.kind));
  for (const { kind, doc } of allDocuments(project)) {
    if (core.has(kind)) continue;
    out.push(
      entry({
        id: `${kind}:${doc.id}`,
        group: kind,
        label: documentTitle(documentKindContribution(kind), doc, project, activeLang),
        target: { openId: doc.id, kind },
      }),
    );
  }

  return out;
}

/** Reorders results already ranked by score into CONTIGUOUS groups, in order
 *  of first appearance (the best match's group first), preserving the order
 *  within a group. Does not change the ranking, only the display contiguity
 *  (avoids repeated group headers). */
export function groupResultsForDisplay(results: SearchEntry[]): SearchEntry[] {
  const buckets = new Map<SearchGroup, SearchEntry[]>();
  for (const r of results) {
    const b = buckets.get(r.group);
    if (b) b.push(r);
    else buckets.set(r.group, [r]); // first appearance defines group order (Map preserves insertion)
  }
  return [...buckets.values()].flat();
}

/** Documents rank before the texts inside them. */
const groupRank = (group: SearchGroup): number => (group === "content" ? 1 : 0);

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
    scored.push({ e, score: matchScore * 10 + groupRank(e.group) });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.map((s) => s.e);
}
