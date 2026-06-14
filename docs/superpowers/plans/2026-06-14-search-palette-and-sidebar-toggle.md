# Search Palette (Cmd+K) + Toggleable Sidebar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la recherche inline du `WorkspacePanel` par une **palette de commande globale (Cmd/Ctrl+K, type GitBook)** qui cherche éléments + contenu (items, titres, lore, textes de dialogue), et rendre le `WorkspacePanel` **toggleable** via un bouton « Éléments » dans la topbar.

**Architecture:** Un builder pur `buildSearchIndex(pack, lang)` aplatit le pack en `SearchEntry[]` (chaque entrée porte son label, son contexte d'affichage et sa cible de navigation). `searchQuery(entries, q)` filtre+classe. `SearchPalette` (overlay) lit `uiStore.searchOpen`, rend les résultats groupés, gère la navigation clavier, et à la sélection `navigate` vers la vue individuelle (+ sous-sélectionne le slot pour un item). La sidebar est rendue conditionnellement selon `uiStore.workspacePanelOpen` (persisté), togglée par un bouton topbar.

**Tech Stack:** React 19, Zustand (persist), TanStack Router, react-i18next, Vitest + RTL. Tests éditeur : `cd editor && npx vitest run <path>`. Spec : `docs/superpowers/specs/2026-06-14-search-palette-and-sidebar-toggle-design.md`.

---

## File Structure

**Créés**
- `editor/src/features/search/searchIndex.ts` — types `SearchEntry`/`SearchGroup` + `buildSearchIndex(pack, lang)` + `searchQuery(entries, q)` (purs).
- `editor/src/features/search/SearchPalette.tsx` — overlay UI + navigation clavier + action de sélection.
- `editor/src/features/search/useGlobalSearchShortcut.ts` — hook : listener Cmd/Ctrl+K → ouvre la palette.

**Modifiés**
- `editor/src/state/uiStore.ts` — `workspacePanelOpen` (persisté) + `searchOpen` (transitoire) + setters.
- `editor/src/components/WorkspaceTopBarControls.tsx` — bouton toggle « Éléments » (gauche) + bouton « Rechercher ⌘K » (cluster droit).
- `editor/src/routes/networks.$networkId.servers.$serverId.workspaces.$workspaceId.tsx` — rendu conditionnel de la colonne panneau selon `workspacePanelOpen` ; montage de `<SearchPalette>` ; appel de `useGlobalSearchShortcut()`.
- `editor/src/features/workspace/WorkspacePanel.tsx` — retirer l'`<Input>` de recherche + l'état `q` + le filtrage.
- `editor/src/locales/en.ts` + `fr.ts` — nouvelles clés `search.*`.

**Phasage** : T1 store → T2 index (pur) → T3 palette (UI) → T4 intégration route + Cmd+K + bouton topbar recherche → T5 toggle sidebar + retrait recherche inline.

---

## Task 1 : Flags `uiStore` (`workspacePanelOpen` persisté, `searchOpen` transitoire)

**Files:**
- Modify: `editor/src/state/uiStore.ts` (interface `UiState`, l'objet du store, et le `partialize` du middleware `persist`)
- Test: `editor/src/state/uiStore.test.ts` (créer si absent)

Contexte : `uiStore` utilise `persist(...)`. `assistantPanelOpen` est **transitoire** (exclu du `partialize`) ; des champs comme `editorPaneWidth` sont **persistés**. On mirror : `workspacePanelOpen` persisté, `searchOpen` transitoire.

- [ ] **Step 1 : Écrire le test rouge**

Créer/compléter `editor/src/state/uiStore.test.ts` :
```ts
import { describe, expect, it } from "vitest";
import { useUiStore } from "./uiStore";

describe("uiStore — panel/search flags", () => {
  it("workspacePanelOpen défaut true, toggle/set le modifient", () => {
    expect(useUiStore.getState().workspacePanelOpen).toBe(true);
    useUiStore.getState().setWorkspacePanelOpen(false);
    expect(useUiStore.getState().workspacePanelOpen).toBe(false);
    useUiStore.getState().toggleWorkspacePanel();
    expect(useUiStore.getState().workspacePanelOpen).toBe(true);
  });
  it("searchOpen défaut false, set le modifie", () => {
    expect(useUiStore.getState().searchOpen).toBe(false);
    useUiStore.getState().setSearchOpen(true);
    expect(useUiStore.getState().searchOpen).toBe(true);
    useUiStore.getState().setSearchOpen(false);
    expect(useUiStore.getState().searchOpen).toBe(false);
  });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `cd editor && npx vitest run src/state/uiStore.test.ts`
Expected: FAIL — `workspacePanelOpen`/`setWorkspacePanelOpen` undefined.

- [ ] **Step 3 : Ajouter à l'interface `UiState`** (près de `assistantPanelOpen`)
```ts
  /** Sidebar (WorkspacePanel) visible ? Persisté — l'utilisateur garde son choix. */
  workspacePanelOpen: boolean;
  setWorkspacePanelOpen: (open: boolean) => void;
  toggleWorkspacePanel: () => void;
  /** Palette de recherche Cmd+K ouverte ? Transitoire (non persisté). */
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
```

- [ ] **Step 4 : Ajouter à l'objet du store** (dans le `create(persist((set) => ({ ... })))`, près de `assistantPanelOpen: false`)
```ts
      workspacePanelOpen: true,
      setWorkspacePanelOpen: (open) => set({ workspacePanelOpen: open }),
      toggleWorkspacePanel: () => set((s) => ({ workspacePanelOpen: !s.workspacePanelOpen })),
      searchOpen: false,
      setSearchOpen: (open) => set({ searchOpen: open }),
```

- [ ] **Step 5 : Gérer le `partialize`**

Ouvrir le `partialize` (2ᵉ arg de `persist`, là où `assistantPanelOpen` est exclu). **`searchOpen` doit être exclu** (transitoire, comme `assistantPanelOpen`) et **`workspacePanelOpen` inclus** (persisté). Si `partialize` est une **liste d'exclusion** (retourne tout sauf certains), ajouter `searchOpen` aux exclus et ne rien faire pour `workspacePanelOpen` (inclus par défaut). Si c'est une **allowlist** (retourne un objet de clés explicites), ajouter `workspacePanelOpen` à l'allowlist et NE PAS ajouter `searchOpen`. Lire le code existant pour `assistantPanelOpen` et mirror son traitement pour `searchOpen`.

- [ ] **Step 6 : Lancer, vérifier le succès**

Run: `cd editor && npx vitest run src/state/uiStore.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7 : Commit**
```bash
git add editor/src/state/uiStore.ts editor/src/state/uiStore.test.ts
git commit -m "feat(editor): uiStore workspacePanelOpen (persisted) + searchOpen (transient)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2 : Index de recherche `searchIndex.ts` (pur)

**Files:**
- Create: `editor/src/features/search/searchIndex.ts`
- Test: `editor/src/features/search/searchIndex.test.ts`

Faits (vérifiés) — `getText(pack, lt, lang): string` (`@/lib/i18n`, retourne "" si absent), `getFirstTitleText(menu): LText | undefined` (`@/domain/menuTitle`). `Appearance` a `material?`, `title?: LText`, `lore?: LText | null`. `Dialog` a `title: LText`, `body: ({type:"text";text:LText} | {type:"item";material;count})[]`, `buttons: {id;label:LText;steps}[]`. `Element` a `id: ElementId`, `positions: string`, `appearances: Appearance[]`. `parsePositions(s): number[]` depuis `@/lib/positions` (parse "0-8" → [0..8]).

- [ ] **Step 1 : Écrire les tests rouges**

Créer `editor/src/features/search/searchIndex.test.ts` :
```ts
import { describe, expect, it } from "vitest";
import type { Pack, PackId } from "@/domain/types";
import { buildSearchIndex, searchQuery } from "./searchIndex";

const PID = "p1" as PackId;
function pack(): Pack {
  return {
    id: PID, name: "p", source: "user_created", createdAt: "", updatedAt: "",
    menus: [{
      id: "m_shop", packId: PID, title: [{ kind: "plain", value: { key: "k_title" } }], rows: 3,
      layers: [{ id: "L1", name: "default", elements: [
        { id: "el_buy", positions: "13", appearances: [{ material: "DIAMOND", title: { key: "k_buytitle" }, lore: { key: "k_buylore" } }] },
      ] }],
    } as any],
    commands: [{ id: "c_heal", packId: PID, name: "heal", arguments: [], steps: [] } as any],
    dialogs: [{ id: "d_confirm", packId: PID, title: { key: "k_dtitle" }, canCloseWithEscape: true,
      body: [{ type: "text", text: { key: "k_dbody" } }], inputs: [],
      buttons: [{ id: "btn_ok", label: { key: "k_btn" }, steps: [] }] } as any],
    templates: [], assets: [], dataSources: [], importedConnectors: [],
    i18nKeys: {
      k_title: { en: "Shop" }, k_buytitle: { en: "Buy now" }, k_buylore: { en: "Costs 10 coins" },
      k_dtitle: { en: "Confirm" }, k_dbody: { en: "Are you sure?" }, k_btn: { en: "OK" },
    } as any,
    defaultLang: "en", canvasLayout: {},
  } as Pack;
}

describe("buildSearchIndex", () => {
  it("indexe menus, commandes, dialogs (niveau élément)", () => {
    const idx = buildSearchIndex(pack(), "en");
    expect(idx.find((e) => e.group === "menu" && e.label === "Shop")?.target.openId).toBe("m_shop");
    expect(idx.find((e) => e.group === "command" && e.label === "/heal")?.target.openId).toBe("c_heal");
    expect(idx.find((e) => e.group === "dialog" && e.label === "Confirm")?.target.openId).toBe("d_confirm");
  });
  it("indexe les items de menu avec cible = menu + slot", () => {
    const idx = buildSearchIndex(pack(), "en");
    const item = idx.find((e) => e.group === "content" && e.label === "DIAMOND");
    expect(item?.target).toEqual({ openId: "m_shop", selectId: "el_buy", focusedSlot: 13 });
    expect(item?.context).toContain("Shop");
  });
  it("indexe les textes (titre/lore d'item, corps + bouton de dialog)", () => {
    const idx = buildSearchIndex(pack(), "en");
    expect(idx.some((e) => e.label === "Buy now" && e.target.selectId === "el_buy")).toBe(true);
    expect(idx.some((e) => e.label === "Costs 10 coins" && e.target.selectId === "el_buy")).toBe(true);
    expect(idx.some((e) => e.label === "Are you sure?" && e.target.openId === "d_confirm")).toBe(true);
    expect(idx.some((e) => e.label === "OK" && e.target.openId === "d_confirm")).toBe(true);
  });
});

describe("searchQuery", () => {
  it("filtre par sous-chaîne insensible à la casse", () => {
    const idx = buildSearchIndex(pack(), "en");
    const r = searchQuery(idx, "diam");
    expect(r.some((e) => e.label === "DIAMOND")).toBe(true);
    expect(r.every((e) => e.haystack.includes("diam"))).toBe(true);
  });
  it("classe élément avant contenu, exact/préfixe avant sous-chaîne", () => {
    const idx = buildSearchIndex(pack(), "en");
    const r = searchQuery(idx, "shop");
    // L'entrée menu "Shop" (exact, niveau élément) doit précéder le contexte "…Shop" des items.
    expect(r[0]?.group).toBe("menu");
  });
  it("requête vide renvoie []", () => {
    expect(searchQuery(buildSearchIndex(pack(), "en"), "  ")).toEqual([]);
  });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `cd editor && npx vitest run src/features/search/searchIndex.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3 : Implémenter `searchIndex.ts`**
```ts
import type { Pack } from "@/domain/types";
import { getText } from "@/lib/i18n";
import { getFirstTitleText } from "@/domain/menuTitle";
import { parsePositions } from "@/lib/positions";

export type SearchGroup = "menu" | "command" | "dialog" | "content";

export interface SearchEntry {
  /** Clé stable unique (pour React key + dédup). */
  id: string;
  group: SearchGroup;
  /** Texte principal affiché et matché. */
  label: string;
  /** Texte secondaire (où se trouve le match), ex. "dans Shop", "lore · Shop". */
  context?: string;
  /** Texte minuscule pour le matching (label + context). */
  haystack: string;
  /** Cible de navigation : openId = id route (menu/commande/dialog) ;
   *  selectId = élément à sélectionner après nav (item/texte dans un menu) ;
   *  focusedSlot = slot à focaliser. */
  target: { openId: string; selectId?: string; focusedSlot?: number };
}

function entry(
  partial: Omit<SearchEntry, "haystack">,
): SearchEntry {
  const haystack = `${partial.label} ${partial.context ?? ""}`.toLowerCase();
  return { ...partial, haystack };
}

/** Aplati un pack en entrées de recherche (éléments + contenu). Pur. */
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
          out.push(entry({
            id: `item:${menu.id}:${el.id}`, group: "content", label: ap.material,
            context: `dans ${menuLabel}`, target: baseTarget,
          }));
        }
        const title = getText(pack, ap.title, activeLang);
        if (title) {
          out.push(entry({
            id: `itemtitle:${menu.id}:${el.id}`, group: "content", label: title,
            context: `titre · ${menuLabel}`, target: baseTarget,
          }));
        }
        const lore = getText(pack, ap.lore ?? undefined, activeLang);
        if (lore) {
          out.push(entry({
            id: `itemlore:${menu.id}:${el.id}`, group: "content", label: lore,
            context: `lore · ${menuLabel}`, target: baseTarget,
          }));
        }
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
        if (text) out.push(entry({
          id: `dbody:${dialog.id}:${i}`, group: "content", label: text,
          context: `dialog · ${dlabel}`, target: { openId: dialog.id },
        }));
      }
    }
    for (const btn of dialog.buttons ?? []) {
      const text = getText(pack, btn.label, activeLang);
      if (text) out.push(entry({
        id: `dbtn:${dialog.id}:${btn.id}`, group: "content", label: text,
        context: `bouton · ${dlabel}`, target: { openId: dialog.id },
      }));
    }
  }

  return out;
}

const GROUP_RANK: Record<SearchGroup, number> = { menu: 0, command: 0, dialog: 0, content: 1 };

/** Filtre + classe. Sous-chaîne insensible à la casse. Requête vide → []. */
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
    // score composite : qualité de match d'abord, puis niveau (élément avant contenu).
    scored.push({ e, score: matchScore * 10 + GROUP_RANK[e.group] });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.map((s) => s.e);
}
```

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `cd editor && npx vitest run src/features/search/searchIndex.test.ts`
Expected: PASS (6 tests). Vérifier les vraies signatures de `getText`/`getFirstTitleText`/`parsePositions` si un import casse ; adapter aux signatures réelles (cf. usage verbatim dans `MenuGroup.tsx`/`EdgeTooltip.tsx`).

- [ ] **Step 5 : Commit**
```bash
git add editor/src/features/search/searchIndex.ts editor/src/features/search/searchIndex.test.ts
git commit -m "feat(editor): search index over pack (names, items, i18n text)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3 : `SearchPalette` (overlay + clavier + sélection)

**Files:**
- Create: `editor/src/features/search/SearchPalette.tsx`
- Modify: `editor/src/locales/en.ts` + `fr.ts`
- Test: `editor/src/features/search/SearchPalette.test.tsx`

Faits : `useSelectionStore.getState().set(ids: Iterable<string>, focusedSlot?: number | null)`. Navigation : `navigate({ to: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId/element/$elementId", params })`. `uiStore.searchOpen`/`setSearchOpen`, `uiStore.activeLang`. Pack via `useAccountStore`.

- [ ] **Step 1 : Ajouter les clés i18n**

`editor/src/locales/en.ts` — nouveau bloc :
```ts
  search: {
    placeholder: "Search menus, commands, items, text…",
    open: "Search",
    empty: "No results",
    groupMenu: "Menus",
    groupCommand: "Commands",
    groupDialog: "Dialogs",
    groupContent: "Content",
  },
```
`editor/src/locales/fr.ts` :
```ts
  search: {
    placeholder: "Rechercher menus, commandes, items, texte…",
    open: "Rechercher",
    empty: "Aucun résultat",
    groupMenu: "Menus",
    groupCommand: "Commandes",
    groupDialog: "Dialogs",
    groupContent: "Contenu",
  },
```
Respecter le style/`typeof en` des fichiers.

- [ ] **Step 2 : Écrire le test rouge**

Créer `editor/src/features/search/SearchPalette.test.tsx` :
```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pack, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { useSelectionStore } from "@/state/selectionStore";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useParams: () => ({ networkId: "n1", serverId: "s1", workspaceId: "p1" }),
}));

import { SearchPalette } from "./SearchPalette";

const PID = "p1" as PackId;
function pack(): Pack {
  return {
    id: PID, name: "p", source: "user_created", createdAt: "", updatedAt: "",
    menus: [{ id: "m_shop", packId: PID, title: [{ kind: "plain", value: { key: "k" } }], rows: 3,
      layers: [{ id: "L", name: "d", elements: [{ id: "el_buy", positions: "13", appearances: [{ material: "DIAMOND" }] }] }] } as any],
    commands: [{ id: "c_heal", packId: PID, name: "heal", arguments: [], steps: [] } as any],
    dialogs: [], templates: [], assets: [], dataSources: [], importedConnectors: [],
    i18nKeys: { k: { en: "Shop" } } as any, defaultLang: "en", canvasLayout: {},
  } as Pack;
}

describe("SearchPalette", () => {
  beforeEach(() => {
    navigate.mockClear();
    useAccountStore.setState({ account: { id: "a" as any, packs: [pack()], packOrder: [PID] } } as any);
    useUiStore.setState({ searchOpen: true, activeLang: "en" } as any);
    useSelectionStore.getState().clear();
  });

  it("ne rend rien si searchOpen = false", () => {
    useUiStore.setState({ searchOpen: false } as any);
    const { container } = render(<SearchPalette packId={PID} />);
    expect(container.querySelector("input")).toBeNull();
  });

  it("taper filtre et affiche les résultats", () => {
    render(<SearchPalette packId={PID} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "heal" } });
    expect(screen.getByText("/heal")).toBeInTheDocument();
    expect(screen.queryByText("Shop")).not.toBeInTheDocument();
  });

  it("Entrée sur un menu navigue vers sa vue individuelle", () => {
    render(<SearchPalette packId={PID} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "shop" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({
      to: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId/element/$elementId",
      params: expect.objectContaining({ elementId: "m_shop" }),
    }));
    expect(useUiStore.getState().searchOpen).toBe(false);
  });

  it("Entrée sur un item sélectionne l'élément + slot", () => {
    render(<SearchPalette packId={PID} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "diamond" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({ elementId: "m_shop" }),
    }));
    expect([...useSelectionStore.getState().ids]).toContain("el_buy");
    expect(useSelectionStore.getState().focusedSlot).toBe(13);
  });

  it("Esc ferme la palette", () => {
    render(<SearchPalette packId={PID} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(useUiStore.getState().searchOpen).toBe(false);
  });
});
```

- [ ] **Step 3 : Lancer, vérifier l'échec**

Run: `cd editor && npx vitest run src/features/search/SearchPalette.test.tsx`
Expected: FAIL — module introuvable.

- [ ] **Step 4 : Implémenter `SearchPalette.tsx`**
```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "@tanstack/react-router";
import { LayoutGrid, MessageSquare, Search, TerminalSquare } from "lucide-react";
import type { ElementId, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { useSelectionStore } from "@/state/selectionStore";
import { buildSearchIndex, searchQuery, type SearchEntry, type SearchGroup } from "./searchIndex";

const GROUP_ICON: Record<SearchGroup, typeof Search> = {
  menu: LayoutGrid, command: TerminalSquare, dialog: MessageSquare, content: Search,
};
const GROUP_LABEL: Record<SearchGroup, string> = {
  menu: "search.groupMenu", command: "search.groupCommand", dialog: "search.groupDialog", content: "search.groupContent",
};

export function SearchPalette({ packId }: { packId: PackId }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { networkId?: string; serverId?: string };
  const open = useUiStore((s) => s.searchOpen);
  const setOpen = useUiStore((s) => s.setSearchOpen);
  const activeLang = useUiStore((s) => s.activeLang);
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const index = useMemo(() => (pack ? buildSearchIndex(pack, activeLang) : []), [pack, activeLang]);
  const results = useMemo(() => searchQuery(index, q), [index, q]);

  // Reset query + selection each time the palette opens; focus the input.
  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      // focus after paint
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);
  useEffect(() => setActive(0), [q]);

  if (!open) return null;

  const choose = (entry: SearchEntry | undefined) => {
    if (!entry) return;
    navigate({
      to: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId/element/$elementId",
      params: {
        networkId: params.networkId!, serverId: params.serverId!, workspaceId: packId,
        elementId: entry.target.openId,
      },
    });
    if (entry.target.selectId) {
      useSelectionStore.getState().set([entry.target.selectId as ElementId], entry.target.focusedSlot ?? null);
    }
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(results.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(results[active]); }
  };

  // Group consecutive results by group for display; activeIndex tracks the flat array.
  let lastGroup: SearchGroup | null = null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-[560px] overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-raised)] shadow-[var(--shadow-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--border-soft)] px-3">
          <Search className="size-4 shrink-0 text-[var(--text-faint)]" />
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("search.placeholder")}
            className="h-12 flex-1 bg-transparent text-[14px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
          />
        </div>
        <div className="max-h-[50vh] overflow-auto py-1">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-[13px] text-[var(--text-faint)]">
              {q.trim() ? t("search.empty") : t("search.placeholder")}
            </div>
          ) : (
            results.map((r, i) => {
              const header = r.group !== lastGroup ? r.group : null;
              lastGroup = r.group;
              const Icon = GROUP_ICON[r.group];
              return (
                <div key={r.id}>
                  {header && (
                    <div className="px-3 pt-2 pb-1 text-[9.5px] font-bold uppercase tracking-[.14em] text-[var(--text-faint)]">
                      {t(GROUP_LABEL[header])}
                    </div>
                  )}
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(r)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] ${
                      i === active ? "bg-[var(--brand-soft)] text-[var(--text)]" : "text-[var(--text-mut)]"
                    }`}
                  >
                    <Icon className="size-[15px] shrink-0 text-[var(--text-faint)]" />
                    <span className="flex-1 truncate">{r.label}</span>
                    {r.context && (
                      <span className="shrink-0 truncate text-[11px] text-[var(--text-faint)]">{r.context}</span>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
```
> Note design-system : la palette est un nouveau pattern d'overlay (command palette). Ajouter un spécimen sur `/admin/design` (`features/design-system/DesignSystemPage.tsx`) dans le même commit — cf. règle design-system de `CLAUDE.md`. Couleurs via `var(--token)` uniquement (déjà le cas ci-dessus).

- [ ] **Step 5 : Lancer, vérifier le succès**

Run: `cd editor && npx vitest run src/features/search/SearchPalette.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6 : Ajouter le spécimen design-system**

Dans `editor/src/features/design-system/DesignSystemPage.tsx`, ajouter une petite section montrant la palette (un aperçu statique de l'overlay, ou un bouton qui la déclenche via `setSearchOpen(true)`). Garder minimal — l'objectif est que le pattern soit catalogué.

- [ ] **Step 7 : Commit**
```bash
git add editor/src/features/search/SearchPalette.tsx editor/src/locales/en.ts editor/src/locales/fr.ts editor/src/features/search/SearchPalette.test.tsx editor/src/features/design-system/DesignSystemPage.tsx
git commit -m "feat(editor): SearchPalette overlay — grouped results, keyboard nav, sub-selection

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4 : Intégration route + Cmd+K + bouton « Rechercher » topbar

**Files:**
- Create: `editor/src/features/search/useGlobalSearchShortcut.ts`
- Test: `editor/src/features/search/useGlobalSearchShortcut.test.ts`
- Modify: `editor/src/routes/networks.$networkId.servers.$serverId.workspaces.$workspaceId.tsx` (monter `<SearchPalette>` + appeler le hook)
- Modify: `editor/src/components/WorkspaceTopBarControls.tsx` (bouton « Rechercher ⌘K »)

- [ ] **Step 1 : Test rouge du hook**

Créer `editor/src/features/search/useGlobalSearchShortcut.test.ts` :
```ts
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useUiStore } from "@/state/uiStore";
import { useGlobalSearchShortcut } from "./useGlobalSearchShortcut";

describe("useGlobalSearchShortcut", () => {
  it("Cmd/Ctrl+K ouvre la palette", () => {
    useUiStore.setState({ searchOpen: false } as any);
    renderHook(() => useGlobalSearchShortcut());
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
    expect(useUiStore.getState().searchOpen).toBe(true);
  });
  it("no-op si déjà ouverte", () => {
    useUiStore.setState({ searchOpen: true } as any);
    renderHook(() => useGlobalSearchShortcut());
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    expect(useUiStore.getState().searchOpen).toBe(true);
  });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec** — `cd editor && npx vitest run src/features/search/useGlobalSearchShortcut.test.ts` → FAIL.

- [ ] **Step 3 : Implémenter le hook**
```ts
import { useEffect } from "react";
import { useUiStore } from "@/state/uiStore";

/** Ouvre la palette de recherche au Cmd/Ctrl+K (global, même depuis un input). */
export function useGlobalSearchShortcut(): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        const ui = useUiStore.getState();
        if (!ui.searchOpen) ui.setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
```

- [ ] **Step 4 : Lancer, vérifier le succès** — `cd editor && npx vitest run src/features/search/useGlobalSearchShortcut.test.ts` → PASS (2).

- [ ] **Step 5 : Monter la palette + le hook dans la route**

Dans `editor/src/routes/networks.$networkId.servers.$serverId.workspaces.$workspaceId.tsx` :
- import `{ SearchPalette } from "@/features/search/SearchPalette";` et `{ useGlobalSearchShortcut } from "@/features/search/useGlobalSearchShortcut";`.
- Appeler `useGlobalSearchShortcut();` près des autres hooks (avant tout `return` conditionnel, pour stabilité d'ordre).
- Monter `<SearchPalette packId={pId} />` au même niveau que `<AssistantPanel packId={pId} />` (à la fin du JSX, dans le `DndContext` ou juste après — un overlay `fixed` n'a pas d'exigence de position dans l'arbre).

- [ ] **Step 6 : Bouton « Rechercher » dans la topbar**

Dans `editor/src/components/WorkspaceTopBarControls.tsx`, ajouter (cluster droit, avant `<TopBarKebabMenu>`) un bouton réutilisant le helper `TopBarIconButton` déjà présent dans ce fichier :
```tsx
<TopBarIconButton title={`${t("search.open")} (⌘K)`} onClick={() => useUiStore.getState().setSearchOpen(true)}>
  <Search className="size-[18px]" />
</TopBarIconButton>
```
Imports nécessaires dans ce fichier : `Search` de `lucide-react`, `useUiStore` de `@/state/uiStore`, `useTranslation` (vérifier s'il est déjà importé). Placer le bouton entre `<DeployButtons>` et `<TopBarKebabMenu>` (ou à côté de `<AssistantButton>`).

- [ ] **Step 7 : Vérifier**

Run: `cd editor && npx vitest run src/features/search src/routes && npx tsc --noEmit`
Expected: PASS ; pas de NOUVELLE erreur tsc dans les fichiers touchés (le repo a ~84 erreurs préexistantes hors scope).

- [ ] **Step 8 : Commit**
```bash
git add editor/src/features/search/useGlobalSearchShortcut.ts editor/src/features/search/useGlobalSearchShortcut.test.ts editor/src/routes/networks.\$networkId.servers.\$serverId.workspaces.\$workspaceId.tsx editor/src/components/WorkspaceTopBarControls.tsx
git commit -m "feat(editor): mount SearchPalette + Cmd+K shortcut + topbar search button

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5 : Sidebar toggleable + retrait de la recherche inline

**Files:**
- Modify: `editor/src/components/WorkspaceTopBarControls.tsx` (bouton « Éléments » à gauche)
- Modify: `editor/src/routes/networks.$networkId.servers.$serverId.workspaces.$workspaceId.tsx` (rendu conditionnel de la colonne panneau)
- Modify: `editor/src/features/workspace/WorkspacePanel.tsx` (retirer l'`<Input>` de recherche)
- Modify: `editor/src/locales/en.ts` + `fr.ts` (`workspacePanel.toggle`)
- Test: `editor/src/features/workspace/WorkspacePanel.test.tsx` (mettre à jour le test de recherche inline)

- [ ] **Step 1 : Clés i18n**

Ajouter à `workspacePanel` (en.ts / fr.ts) : `toggle: "Elements"` / `toggle: "Éléments"`.

- [ ] **Step 2 : Bouton toggle « Éléments » à gauche de la topbar**

Dans `WorkspaceTopBarControls.tsx`, AVANT le `<div className="flex min-w-0 flex-1 ...">` (le bloc nom), insérer un bouton labellisé (pas un `TopBarIconButton` icône-seule — on veut l'icône + le label « Éléments ») :
```tsx
<button
  type="button"
  onClick={() => useUiStore.getState().toggleWorkspacePanel()}
  className="inline-flex shrink-0 items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-[12px] text-[var(--text-mut)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
  aria-label={t("workspacePanel.toggle")}
  aria-pressed={panelOpen}
>
  {panelOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
  <span className="hidden sm:inline">{t("workspacePanel.toggle")}</span>
</button>
```
- `panelOpen` : lire `const panelOpen = useUiStore((s) => s.workspacePanelOpen);` en tête du composant.
- Imports : `PanelLeftClose, PanelLeftOpen` de `lucide-react`, `useUiStore`.
- L'icône reflète l'état (ouvert → `PanelLeftClose` « replier », fermé → `PanelLeftOpen` « déplier »). Le label « Éléments » lève l'ambiguïté vs l'app nav.

- [ ] **Step 3 : Rendu conditionnel de la colonne panneau dans la route**

Dans la branche desktop de l'overview (la colonne `w-[240px]` qui contient `<WorkspacePanel>`), conditionner son rendu :
```tsx
const workspacePanelOpen = useUiStore((s) => s.workspacePanelOpen);
// ...
{workspacePanelOpen && (
  <div className="w-[240px] shrink-0 overflow-hidden border-r border-[var(--border-soft)]">
    <WorkspacePanel packId={pId} />
  </div>
)}
```
(Adapter aux classes réelles de la colonne existante — lire la branche desktop actuelle. Quand `workspacePanelOpen` est faux, la colonne n'est pas rendue et le reste prend la place.) Sur mobile, le `Sheet` drawer reste déclenché par le bouton « Éléments » (le toggle ouvre le drawer ; vérifier que le bouton topbar contrôle bien le même état — sur mobile, `workspacePanelOpen` peut piloter l'ouverture du `Sheet`).

- [ ] **Step 4 : Retirer la recherche inline du `WorkspacePanel`**

Dans `editor/src/features/workspace/WorkspacePanel.tsx` :
- Supprimer l'import `Input`, l'état `const [q, setQ] = useState("")`, le filtrage `.filter((it) => it.label...includes(q...))` et le `<Input placeholder={t("workspacePanel.search")} .../>`.
- `groups` devient directement `buildPackElements(pack, activeLang)` (sans filtre).
- `empty` reste calculé sur les groupes (désormais non filtrés → empty seulement si le pack n'a aucun élément).

- [ ] **Step 5 : Mettre à jour le test `WorkspacePanel.test.tsx`**

Le test « la recherche filtre la liste » n'a plus de sens (la recherche a déménagé). Le **supprimer**. Garder/ajuster : « liste les éléments par catégorie avec le badge on-board » et « cliquer un élément navigue ». Vérifier qu'aucun test ne référence plus le placeholder de recherche.

- [ ] **Step 6 : Vérifier**

Run: `cd editor && npx vitest run src/features/workspace src/routes && npx tsc --noEmit`
Expected: PASS ; pas de nouvelle erreur tsc dans les fichiers touchés.

- [ ] **Step 7 : Suite complète + commit**
```bash
cd editor && npx vitest run
# attendu : tout vert
git add editor/src/components/WorkspaceTopBarControls.tsx editor/src/routes/networks.\$networkId.servers.\$serverId.workspaces.\$workspaceId.tsx editor/src/features/workspace/WorkspacePanel.tsx editor/src/features/workspace/WorkspacePanel.test.tsx editor/src/locales/en.ts editor/src/locales/fr.ts
git commit -m "feat(editor): toggleable WorkspacePanel (topbar Éléments button) + drop inline search

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Documentation (avant merge)

Per `CLAUDE.md` doc-impact map :
- `docs/architecture/editor-internals.md` — section recherche : `SearchPalette` + `searchIndex` (périmètre indexé), Cmd+K, `WorkspacePanel` toggleable (`uiStore.workspacePanelOpen`), retrait de la recherche inline. Compléter la section « Planche curée + panneau + vue individuelle » existante.
- Design system : nouveau pattern command-palette → mentionner dans la section Design system + spécimen `/admin/design` (déjà ajouté en Task 3).
- Pas de CHANGELOG API/REST (éditeur-only) — entrée UX optionnelle dans `[Unreleased]`.

Si > ~30 lignes doc → `/sync-docs` en commit séparé.

---

## Self-Review (auteur du plan)

**Couverture spec ↔ tasks :**
- §3 sidebar toggleable (bouton « Éléments », `workspacePanelOpen` persisté, rendu conditionnel, retrait recherche inline) → Task 1 (flag), Task 5 (bouton + rendu + retrait).
- §3.1 toggle non-ambigu (icône panneau + label « Éléments ») → Task 5 Step 2.
- §4 palette (overlay, Cmd+K + bouton topbar, clavier, action de sélection) → Task 3 (overlay+clavier+sélection), Task 4 (Cmd+K + bouton topbar).
- §4.4 sous-sélection slot pour item → Task 2 (`target.selectId`/`focusedSlot`), Task 3 (`choose` appelle `selectionStore.set`).
- §5 index (périmètre noms/items/textes, ranking) → Task 2.
- §6 fichiers → couverts.
- §7 tests → chaque task TDD ; mise à jour du test inline-search en Task 5.
- §8 non-goals (logique/liens, cross-pack) → non implémentés (respectés).

**Placeholders :** aucun TODO/TBD. Les « adapter aux signatures/classes réelles » pointent une lecture ciblée d'un fichier nommé, pas du code à inventer. La gestion `partialize` (Task 1 Step 5) est une instruction conditionnelle explicite (mirror `assistantPanelOpen`), pas un placeholder.

**Cohérence des types/noms :** `workspacePanelOpen`/`setWorkspacePanelOpen`/`toggleWorkspacePanel`, `searchOpen`/`setSearchOpen`, `SearchEntry{id,group,label,context,haystack,target:{openId,selectId,focusedSlot}}`, `buildSearchIndex(pack,lang)`, `searchQuery(entries,q)`, `SearchPalette`, `useGlobalSearchShortcut`, clés `search.*` + `workspacePanel.toggle` — cohérents d'une task à l'autre. `selectionStore.set(ids, focusedSlot?)` utilisé conformément à sa signature réelle.
