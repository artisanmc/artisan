# Workspace Board-Curation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformer le canvas workspace « tout auto-placé » en une **planche curée** (`canvasLayout` = appartenance), avec un **panneau gauche source-de-vérité** listant tout le pack et une **vue individuelle deep-linkable** qui réutilise les mêmes composants de rendu que la planche.

**Architecture:** `pack.canvasLayout` cesse d'être rempli automatiquement et devient l'ensemble des éléments présents sur la planche. `Stage` ne rend que ces éléments. Un nouveau `WorkspacePanel` (gauche) liste tout le pack ; clic → vue individuelle (nouvelle route enfant TanStack), drag → ajout à la planche. La vue individuelle d'un menu monte le **même** `MenuGroup`, paramétré en mode `solo` (au lieu de réécrire un éditeur — c'est la divergence qui avait causé le revert de l'ancien focus mode). Voir spec : `docs/superpowers/specs/2026-06-13-workspace-board-curation-design.md`.

**Tech Stack:** React 19, Konva (`react-konva`), Zustand + Immer + `zundo` temporal, TanStack Router (file-based, auto-gen via `TanStackRouterVite`), dnd-kit, react-i18next, Vitest + React Testing Library. Lancer les tests éditeur : `cd editor && npm test`.

**Décision d'implémentation clé (amende §7 de la spec) :** plutôt que de splitter `MenuGroup.tsx` en 6 fichiers, on **paramètre** `MenuGroup` avec un flag `solo`. Un seul composant rendu dans les deux contextes ⇒ zéro divergence possible. C'est l'antidote direct à la cause du revert, à moindre risque qu'un gros split.

---

## File Structure

**Modifiés :**
- `editor/src/features/canvas/autoLayout.ts` — ne plus grid-filler ; ajouter `gridArrange`.
- `editor/src/features/canvas/Stage.tsx` — ne rendre que les éléments présents dans `canvasLayout`.
- `editor/src/features/canvas/Edges.tsx` — ne tracer qu'entre nœuds présents (+ chips en P6).
- `editor/src/features/canvas/MenuGroup.tsx` — flag `solo` (rendu à l'origine, non-draggable, pas de sélection-menu).
- `editor/src/state/accountStore.ts` — actions `addToBoard` / `removeFromBoard` / `arrangeAllOnBoard`.
- `editor/src/routes/networks.$networkId.servers.$serverId.workspaces.$workspaceId.tsx` — intégrer `WorkspacePanel` dans le layout overview.
- `editor/src/locales/en.ts` + `fr.ts` — nouvelles clés.

**Créés :**
- `editor/src/features/canvas/gridArrange.ts` *(ou export depuis autoLayout.ts — voir Task 1)*.
- `editor/src/features/workspace/WorkspacePanel.tsx` — panneau gauche.
- `editor/src/features/workspace/usePackElements.ts` — sélecteur dérivé (liste catégorisée + flag on-board).
- `editor/src/features/workspace/SoloMenuStage.tsx` — Konva Stage minimal hébergeant `<MenuGroup solo>`.
- `editor/src/features/workspace/ElementView.tsx` — dispatcher par type pour la vue individuelle.
- `editor/src/routes/networks.$networkId.servers.$serverId.workspaces.$workspaceId.element.$elementId.tsx` — route enfant.
- `editor/src/features/canvas/offBoardLinks.ts` — dérive les liens vers cibles hors-planche (P6).

**Phasage** (chaque phase shippable, tests verts) :
- **P1** Task 1–2 : modèle d'appartenance (autoLayout/gridArrange + store actions).
- **P2** Task 3–4 : Stage curé + Edges filtrées.
- **P3** Task 5–7 : `WorkspacePanel` (sélecteur, liste/recherche, drag→planche, intégration layout).
- **P4** Task 8–10 : `MenuGroup` solo + `SoloMenuStage` + route enfant + `ElementView` (menu).
- **P5** Task 11–12 : `ElementView` commande/dialog (flux centré).
- **P6** Task 13–14 : chips fantômes + double-clic planche → vue individuelle.
- **P7** Task 15 : mobile (drawers, pas de hover-only).

---

## Task 1 : `autoLayout` ne remplit plus la grille + `gridArrange`

**Files:**
- Modify: `editor/src/features/canvas/autoLayout.ts`
- Test: `editor/src/features/canvas/autoLayout.test.ts` (créer)

État actuel de `autoLayout.ts` (verbatim) :
```ts
export function autoLayout(pack: Pack): Record<string, { x: number; y: number }> {
  const layout: Record<string, { x: number; y: number }> = { ...pack.canvasLayout };
  const cellW = 220; const cellH = 160; const cols = 4;
  const ids = [...(pack.menus ?? []).map((m) => m.id), ...(pack.commands ?? []).map((c) => c.id), ...(pack.dialogs ?? []).map((d) => d.id)];
  let i = 0;
  for (const id of ids) { if (layout[id]) continue; const x = (i % cols) * cellW + 40; const y = Math.floor(i / cols) * cellH + 40; layout[id] = { x, y }; i++; }
  return layout;
}
```

- [ ] **Step 1 : Écrire les tests rouges**

Créer `editor/src/features/canvas/autoLayout.test.ts` :
```ts
import { describe, expect, it } from "vitest";
import type { Pack } from "@/domain/types";
import { autoLayout, gridArrange } from "./autoLayout";

function makePack(over: Partial<Pack> = {}): Pack {
  return {
    id: "p1" as Pack["id"], name: "p", source: "user_created", createdAt: "", updatedAt: "",
    menus: [], commands: [], templates: [], assets: [], dataSources: [], importedConnectors: [],
    i18nKeys: {}, defaultLang: "en", dialogs: [], canvasLayout: {}, ...over,
  } as Pack;
}

describe("autoLayout", () => {
  it("ne retourne QUE les entrées explicites de canvasLayout (pas de grid-fill)", () => {
    const pack = makePack({
      menus: [{ id: "m1" } as any, { id: "m2" } as any],
      canvasLayout: { m1: { x: 10, y: 20 } } as any,
    });
    const layout = autoLayout(pack);
    expect(layout).toEqual({ m1: { x: 10, y: 20 } });
    expect("m2" in layout).toBe(false);
  });
});

describe("gridArrange", () => {
  it("place TOUS les éléments (menus + commandes + dialogs) dans une grille", () => {
    const pack = makePack({
      menus: [{ id: "m1" } as any], commands: [{ id: "c1" } as any], dialogs: [{ id: "d1" } as any],
    });
    const layout = gridArrange(pack);
    expect(Object.keys(layout).sort()).toEqual(["c1", "d1", "m1"]);
    expect(layout.m1).toEqual({ x: 40, y: 40 });
  });
});
```

- [ ] **Step 2 : Lancer les tests, vérifier qu'ils échouent**

Run: `cd editor && npx vitest run src/features/canvas/autoLayout.test.ts`
Expected: FAIL — `gridArrange` is not exported ; `autoLayout` retourne encore m2.

- [ ] **Step 3 : Implémenter**

Remplacer le contenu de `editor/src/features/canvas/autoLayout.ts` :
```ts
import type { Pack } from "@/domain/types";

/**
 * Board layout = appartenance. Ne retourne que les positions EXPLICITES de
 * pack.canvasLayout. Un élément absent de canvasLayout n'est pas sur la planche.
 * (Le grid-fill historique vit désormais dans gridArrange, appelé à la demande.)
 */
export function autoLayout(pack: Pack): Record<string, { x: number; y: number }> {
  return { ...pack.canvasLayout };
}

/** Grille déterministe sur TOUS les éléments — pour le bouton « Tout arranger ». */
export function gridArrange(pack: Pack): Record<string, { x: number; y: number }> {
  const layout: Record<string, { x: number; y: number }> = {};
  const cellW = 220;
  const cellH = 160;
  const cols = 4;
  const ids = [
    ...(pack.menus ?? []).map((m) => m.id),
    ...(pack.commands ?? []).map((c) => c.id),
    ...(pack.dialogs ?? []).map((d) => d.id),
  ];
  let i = 0;
  for (const id of ids) {
    layout[id] = { x: (i % cols) * cellW + 40, y: Math.floor(i / cols) * cellH + 40 };
    i++;
  }
  return layout;
}
```

- [ ] **Step 4 : Lancer les tests, vérifier qu'ils passent**

Run: `cd editor && npx vitest run src/features/canvas/autoLayout.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5 : Commit**
```bash
git add editor/src/features/canvas/autoLayout.ts editor/src/features/canvas/autoLayout.test.ts
git commit -m "feat(editor): canvasLayout = board membership (autoLayout no longer grid-fills; add gridArrange)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2 : Store actions `addToBoard` / `removeFromBoard` / `arrangeAllOnBoard`

**Files:**
- Modify: `editor/src/state/accountStore.ts` (interface `AccountState` + actions ; voisin de `setCanvasPosition` ~ligne 1486)
- Test: `editor/src/state/accountStore.test.ts` (ajouter un `describe`)

Pattern existant à mirroir (`setCanvasPosition`, verbatim) :
```ts
setCanvasPosition: ({ packId: pId, nodeId, x, y }) =>
  set(produce((draft: AccountState) => {
    const pack = draft.account.packs.find((p) => p.id === pId);
    if (!pack) return;
    (pack.canvasLayout as Record<string, { x: number; y: number }>)[nodeId] = { x, y };
  })),
```

- [ ] **Step 1 : Écrire les tests rouges**

Ajouter dans `editor/src/state/accountStore.test.ts` (les imports `packId`, `useAccountStore`, `mockAccount` existent déjà en tête de fichier ; ajouter `gridArrange` si besoin) :
```ts
import { gridArrange } from "@/features/canvas/autoLayout";

describe("accountStore — board membership", () => {
  const P = packId("p_personal");
  it("addToBoard écrit une entrée canvasLayout sans toucher au reste du pack", () => {
    useAccountStore.getState().addToBoard({ packId: P, nodeId: "m_about", x: 5, y: 6 });
    const pack = useAccountStore.getState().account.packs.find((p) => p.id === P)!;
    expect(pack.canvasLayout["m_about" as keyof typeof pack.canvasLayout]).toEqual({ x: 5, y: 6 });
    expect(pack.menus.some((m) => m.id === "m_about")).toBe(true); // toujours dans le pack
  });

  it("removeFromBoard retire l'entrée canvasLayout MAIS garde l'élément dans le pack", () => {
    useAccountStore.getState().addToBoard({ packId: P, nodeId: "m_about", x: 5, y: 6 });
    useAccountStore.getState().removeFromBoard({ packId: P, nodeId: "m_about" });
    const pack = useAccountStore.getState().account.packs.find((p) => p.id === P)!;
    expect("m_about" in pack.canvasLayout).toBe(false);
    expect(pack.menus.some((m) => m.id === "m_about")).toBe(true);
  });

  it("arrangeAllOnBoard remplit canvasLayout pour tous les éléments via gridArrange", () => {
    useAccountStore.getState().arrangeAllOnBoard({ packId: P });
    const pack = useAccountStore.getState().account.packs.find((p) => p.id === P)!;
    const expected = gridArrange(pack);
    expect(Object.keys(pack.canvasLayout).sort()).toEqual(Object.keys(expected).sort());
  });
});
```

- [ ] **Step 2 : Lancer les tests, vérifier qu'ils échouent**

Run: `cd editor && npx vitest run src/state/accountStore.test.ts -t "board membership"`
Expected: FAIL — `addToBoard is not a function`.

- [ ] **Step 3 : Implémenter — déclarer dans l'interface `AccountState`**

Près des autres signatures (chercher `setCanvasPosition:` dans l'interface) ajouter :
```ts
  addToBoard: (input: { packId: PackId; nodeId: string; x: number; y: number }) => void;
  removeFromBoard: (input: { packId: PackId; nodeId: string }) => void;
  arrangeAllOnBoard: (input: { packId: PackId }) => void;
```

- [ ] **Step 4 : Implémenter — les actions (à côté de `setCanvasPosition`)**

Ajouter l'import en tête : `import { gridArrange } from "@/features/canvas/autoLayout";`
Puis :
```ts
  addToBoard: ({ packId: pId, nodeId, x, y }) =>
    set(produce((draft: AccountState) => {
      const pack = draft.account.packs.find((p) => p.id === pId);
      if (!pack) return;
      (pack.canvasLayout as Record<string, { x: number; y: number }>)[nodeId] = { x, y };
    })),
  removeFromBoard: ({ packId: pId, nodeId }) =>
    set(produce((draft: AccountState) => {
      const pack = draft.account.packs.find((p) => p.id === pId);
      if (!pack) return;
      delete (pack.canvasLayout as Record<string, { x: number; y: number }>)[nodeId];
    })),
  arrangeAllOnBoard: ({ packId: pId }) =>
    set(produce((draft: AccountState) => {
      const pack = draft.account.packs.find((p) => p.id === pId);
      if (!pack) return;
      const grid = gridArrange(pack);
      pack.canvasLayout = grid as typeof pack.canvasLayout;
    })),
```

- [ ] **Step 5 : Lancer les tests, vérifier qu'ils passent**

Run: `cd editor && npx vitest run src/state/accountStore.test.ts -t "board membership"`
Expected: PASS (3 tests).

- [ ] **Step 6 : Commit**
```bash
git add editor/src/state/accountStore.ts editor/src/state/accountStore.test.ts
git commit -m "feat(editor): addToBoard/removeFromBoard/arrangeAllOnBoard store actions

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3 : `Stage` ne rend que les éléments sur la planche

**Files:**
- Modify: `editor/src/features/canvas/Stage.tsx` (les 3 `.map` lignes ~240–268)
- Test: `editor/src/features/canvas/Stage.boardMembership.test.tsx` (créer)

État actuel (verbatim, rend TOUT) :
```tsx
{pack.menus.map((menu) => (<MenuGroup ... position={layout[menu.id] ?? { x: 0, y: 0 }} layout={layout} />))}
...
{pack.commands.map((command) => (<CommandGroup ... position={layout[command.id] ?? { x: 0, y: 0 }} />))}
{pack.dialogs.map((dialog) => (<DialogGroup ... position={layout[dialog.id] ?? { x: 0, y: 0 }} />))}
```

- [ ] **Step 1 : Écrire le test rouge**

Créer `editor/src/features/canvas/Stage.boardMembership.test.tsx`. Mirror le mock react-konva de `MenuGroup.test.tsx` (Group→div avec `data-name`) :
```tsx
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pack, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { Stage } from "./Stage";

vi.mock("react-konva", () => ({
  Stage: (p: any) => <div data-testid="konva-stage">{p.children}</div>,
  Layer: (p: any) => <div>{p.children}</div>,
  Group: (p: any) => <div data-testid="konva-group" data-name={p.name}>{p.children}</div>,
  Rect: () => <div />, Image: () => <div />, Text: () => <div />, Line: () => <div />,
}));
vi.mock("use-image", () => ({ default: () => [null, "loaded"] }));
vi.mock("./title/composer/TitleRender", () => ({ TitleRender: () => <div /> }));
vi.mock("./Edges", () => ({ Edges: () => <div data-testid="edges" /> }));

const PID = "p1" as PackId;
function pack(): Pack {
  return {
    id: PID, name: "p", source: "user_created", createdAt: "", updatedAt: "",
    menus: [{ id: "m1", packId: PID, title: [], rows: 3, layers: [] } as any,
            { id: "m2", packId: PID, title: [], rows: 3, layers: [] } as any],
    commands: [], templates: [], assets: [], dataSources: [], importedConnectors: [],
    i18nKeys: {}, defaultLang: "en", dialogs: [], canvasLayout: { m1: { x: 0, y: 0 } } as any,
  } as Pack;
}

describe("Stage — board membership", () => {
  beforeEach(() => {
    useAccountStore.setState({ account: { id: "a" as any, packs: [pack()], packOrder: [PID] } } as any);
  });
  it("ne rend QUE les éléments présents dans canvasLayout", () => {
    render(<Stage packId={PID} />);
    const names = screen.getAllByTestId("konva-group").map((g) => g.getAttribute("data-name"));
    expect(names).toContain("menu:m1");
    expect(names).not.toContain("menu:m2");
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier qu'il échoue**

Run: `cd editor && npx vitest run src/features/canvas/Stage.boardMembership.test.tsx`
Expected: FAIL — `menu:m2` est rendu (Stage rend tout).

- [ ] **Step 3 : Implémenter — filtrer les 3 map dans `Stage.tsx`**

Remplacer chaque `.map` par un `.filter` préalable :
```tsx
{pack.menus.filter((menu) => layout[menu.id]).map((menu) => (
  <MenuGroup key={menu.id} packId={packId} menu={menu} position={layout[menu.id]!} layout={layout} />
))}
```
```tsx
{pack.commands.filter((command) => layout[command.id]).map((command) => (
  <CommandGroup key={command.id} packId={packId} command={command} position={layout[command.id]!} />
))}
{pack.dialogs.filter((dialog) => layout[dialog.id]).map((dialog) => (
  <DialogGroup key={dialog.id} packId={packId} dialog={dialog} position={layout[dialog.id]!} />
))}
```

- [ ] **Step 4 : Lancer le test, vérifier qu'il passe**

Run: `cd editor && npx vitest run src/features/canvas/Stage.boardMembership.test.tsx`
Expected: PASS.

- [ ] **Step 5 : Lancer la suite canvas complète (non-régression)**

Run: `cd editor && npx vitest run src/features/canvas`
Expected: PASS (les tests existants ne posent que des packs avec canvasLayout peuplé, ou des menus déjà placés ; corriger tout test qui supposait un grid-fill implicite en ajoutant les entrées `canvasLayout` attendues).

- [ ] **Step 6 : Commit**
```bash
git add editor/src/features/canvas/Stage.tsx editor/src/features/canvas/Stage.boardMembership.test.tsx
git commit -m "feat(editor): Stage renders only elements present on the board (canvasLayout)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4 : `Edges` ne trace qu'entre nœuds présents sur la planche

**Files:**
- Modify: `editor/src/features/canvas/Edges.tsx` (consommateur de `deriveEdges`, ~ligne 92)
- Test: `editor/src/features/canvas/Edges.boardMembership.test.tsx` (créer)

`Edges` props : `{ pack: Pack; layout: Record<string, {x,y}> }`. Il fait `routeEdges({ edges: deriveEdges(pack), boxes, overrides })`. Un edge dont une extrémité est absente de `layout` n'a pas de box → à filtrer.

- [ ] **Step 1 : Écrire le test rouge**

Créer `editor/src/features/canvas/Edges.boardMembership.test.tsx` :
```tsx
import { describe, expect, it } from "vitest";
import { visibleEdges } from "./Edges";

describe("visibleEdges", () => {
  it("ne garde que les edges dont source ET target sont sur la planche", () => {
    const edges = [
      { id: "m1->m2", source: "m1", target: "m2", triggers: [] },
      { id: "m1->m3", source: "m1", target: "m3", triggers: [] },
    ] as any;
    const layout = { m1: { x: 0, y: 0 }, m2: { x: 1, y: 1 } };
    const out = visibleEdges(edges, layout);
    expect(out.map((e) => e.id)).toEqual(["m1->m2"]);
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier qu'il échoue**

Run: `cd editor && npx vitest run src/features/canvas/Edges.boardMembership.test.tsx`
Expected: FAIL — `visibleEdges` not exported.

- [ ] **Step 3 : Implémenter dans `Edges.tsx`**

Ajouter en haut (après les imports) la fonction pure exportée :
```ts
import type { Edge } from "./deriveEdges";
/** Ne garde que les edges dont les deux extrémités sont sur la planche. */
export function visibleEdges(edges: Edge[], layout: Record<string, { x: number; y: number }>): Edge[] {
  return edges.filter((e) => layout[e.source] && layout[e.target]);
}
```
Puis dans le `useMemo` du composant, envelopper `deriveEdges(pack)` :
```ts
const routed = useMemo(
  () => routeEdges({ edges: visibleEdges(deriveEdges(pack), layout), boxes, overrides }),
  [pack, boxes, overrides, layout],
);
```

- [ ] **Step 4 : Lancer les tests, vérifier qu'ils passent**

Run: `cd editor && npx vitest run src/features/canvas/Edges.boardMembership.test.tsx src/features/canvas`
Expected: PASS.

- [ ] **Step 5 : Commit**
```bash
git add editor/src/features/canvas/Edges.tsx editor/src/features/canvas/Edges.boardMembership.test.tsx
git commit -m "feat(editor): draw edges only between on-board nodes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5 : Sélecteur dérivé `usePackElements` (liste catégorisée + flag on-board)

**Files:**
- Create: `editor/src/features/workspace/usePackElements.ts`
- Test: `editor/src/features/workspace/usePackElements.test.ts`

Résolution des noms (rappel) : menu → `getText(pack, getFirstTitleText(menu), activeLang) || menu.id` ; commande → `/${command.name}` ; dialog → `dialog.id`.

- [ ] **Step 1 : Écrire le test rouge**
```ts
import { describe, expect, it } from "vitest";
import type { Pack, PackId } from "@/domain/types";
import { buildPackElements } from "./usePackElements";

const PID = "p1" as PackId;
function pack(): Pack {
  return {
    id: PID, name: "p", source: "user_created", createdAt: "", updatedAt: "",
    menus: [{ id: "m1", packId: PID, title: [], rows: 3, layers: [] } as any],
    commands: [{ id: "c1", packId: PID, name: "heal", arguments: [], steps: [] } as any],
    dialogs: [{ id: "d1", packId: PID, title: { _: "" }, canCloseWithEscape: true, body: [], inputs: [], buttons: [] } as any],
    templates: [], assets: [], dataSources: [], importedConnectors: [],
    i18nKeys: {}, defaultLang: "en", canvasLayout: { m1: { x: 0, y: 0 } } as any,
  } as Pack;
}

describe("buildPackElements", () => {
  it("groupe par catégorie avec id, label, type et flag onBoard", () => {
    const groups = buildPackElements(pack(), "en");
    const menus = groups.find((g) => g.type === "menu")!;
    expect(menus.items[0]).toMatchObject({ id: "m1", onBoard: true, type: "menu" });
    const cmds = groups.find((g) => g.type === "command")!;
    expect(cmds.items[0]).toMatchObject({ id: "c1", label: "/heal", onBoard: false });
    const dlgs = groups.find((g) => g.type === "dialog")!;
    expect(dlgs.items[0]).toMatchObject({ id: "d1", onBoard: false });
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier qu'il échoue**

Run: `cd editor && npx vitest run src/features/workspace/usePackElements.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3 : Implémenter**

Créer `editor/src/features/workspace/usePackElements.ts` :
```ts
import type { Pack } from "@/domain/types";
import { getFirstTitleText } from "@/domain/menuTitle";
import { getText } from "@/lib/i18n";

export type ElementType = "menu" | "command" | "dialog";
export interface PackElementItem { id: string; label: string; type: ElementType; onBoard: boolean; }
export interface PackElementGroup { type: ElementType; items: PackElementItem[]; }

/** Pure: construit la liste catégorisée des éléments du pack (source de vérité du panneau). */
export function buildPackElements(pack: Pack, activeLang: string): PackElementGroup[] {
  const onBoard = (id: string) => id in pack.canvasLayout;
  const menus: PackElementItem[] = (pack.menus ?? []).map((m) => {
    const lt = getFirstTitleText(m);
    return { id: m.id, label: (lt ? getText(pack, lt, activeLang) : "") || m.id, type: "menu", onBoard: onBoard(m.id) };
  });
  const commands: PackElementItem[] = (pack.commands ?? []).map((c) => ({
    id: c.id, label: `/${c.name}`, type: "command", onBoard: onBoard(c.id),
  }));
  const dialogs: PackElementItem[] = (pack.dialogs ?? []).map((d) => ({
    id: d.id, label: d.id, type: "dialog", onBoard: onBoard(d.id),
  }));
  return [
    { type: "menu", items: menus },
    { type: "command", items: commands },
    { type: "dialog", items: dialogs },
  ];
}
```
> Note : vérifier la signature exacte de `getText` dans `editor/src/lib/i18n.ts` (utilisée verbatim dans `EdgeTooltip.tsx` comme `getText(pack, lt, activeLang)`).

- [ ] **Step 4 : Lancer le test, vérifier qu'il passe**

Run: `cd editor && npx vitest run src/features/workspace/usePackElements.test.ts`
Expected: PASS.

- [ ] **Step 5 : Commit**
```bash
git add editor/src/features/workspace/usePackElements.ts editor/src/features/workspace/usePackElements.test.ts
git commit -m "feat(editor): buildPackElements selector (categorized list + on-board flag)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6 : `WorkspacePanel` — liste, recherche, badge, drag, menu contextuel

**Files:**
- Create: `editor/src/features/workspace/WorkspacePanel.tsx`
- Modify: `editor/src/locales/en.ts` + `editor/src/locales/fr.ts`
- Test: `editor/src/features/workspace/WorkspacePanel.test.tsx`

Composants design-system : `Input` (`@/components/ui/input`), `DropdownMenu*` (`@/components/ui/dropdown-menu`), `EmptyState` (`@/components/ui/empty-state`), `Button`. Drag source dnd-kit : `useDraggable({ id: `${PANEL_DRAG_PREFIX}${item.id}`, data: { nodeId, type } })`. Navigation : `useNavigate` + `to: ".../element/$elementId"`.

- [ ] **Step 1 : Ajouter les clés i18n**

Dans `editor/src/locales/en.ts`, ajouter un bloc :
```ts
  workspacePanel: {
    search: "Search…",
    menus: "Menus",
    commands: "Commands",
    dialogs: "Dialogs",
    onBoard: "on board",
    edit: "Edit",
    addToBoard: "Add to board",
    removeFromBoard: "Remove from board",
    delete: "Delete from pack",
    empty: "No elements yet",
    arrangeAll: "Arrange all on board",
  },
```
Dans `editor/src/locales/fr.ts`, le parallèle :
```ts
  workspacePanel: {
    search: "Rechercher…",
    menus: "Menus",
    commands: "Commandes",
    dialogs: "Dialogs",
    onBoard: "sur la planche",
    edit: "Éditer",
    addToBoard: "Ajouter à la planche",
    removeFromBoard: "Retirer de la planche",
    delete: "Supprimer du pack",
    empty: "Aucun élément pour l'instant",
    arrangeAll: "Tout arranger sur la planche",
  },
```

- [ ] **Step 2 : Écrire le test rouge**

Créer `editor/src/features/workspace/WorkspacePanel.test.tsx` :
```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pack, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ networkId: "n1", serverId: "s1", workspaceId: "p1" }),
  useNavigate: () => navigate,
}));
vi.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, isDragging: false }),
}));

import { WorkspacePanel } from "./WorkspacePanel";

const PID = "p1" as PackId;
function pack(): Pack {
  return {
    id: PID, name: "p", source: "user_created", createdAt: "", updatedAt: "",
    menus: [{ id: "m1", packId: PID, title: [], rows: 3, layers: [] } as any],
    commands: [{ id: "c1", packId: PID, name: "heal", arguments: [], steps: [] } as any],
    dialogs: [], templates: [], assets: [], dataSources: [], importedConnectors: [],
    i18nKeys: {}, defaultLang: "en", canvasLayout: { m1: { x: 0, y: 0 } } as any,
  } as Pack;
}

describe("WorkspacePanel", () => {
  beforeEach(() => {
    navigate.mockClear();
    useAccountStore.setState({ account: { id: "a" as any, packs: [pack()], packOrder: [PID] } } as any);
  });

  it("liste les éléments par catégorie avec le badge on-board", () => {
    render(<WorkspacePanel packId={PID} />);
    expect(screen.getByText("/heal")).toBeInTheDocument();
    expect(screen.getByText("m1")).toBeInTheDocument();
    expect(screen.getAllByText(/on board|sur la planche/i).length).toBeGreaterThanOrEqual(1);
  });

  it("la recherche filtre la liste", () => {
    render(<WorkspacePanel packId={PID} />);
    fireEvent.change(screen.getByPlaceholderText(/search|rechercher/i), { target: { value: "heal" } });
    expect(screen.getByText("/heal")).toBeInTheDocument();
    expect(screen.queryByText("m1")).not.toBeInTheDocument();
  });

  it("cliquer un élément navigue vers sa vue individuelle", () => {
    render(<WorkspacePanel packId={PID} />);
    fireEvent.click(screen.getByText("/heal"));
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({
      to: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId/element/$elementId",
      params: expect.objectContaining({ elementId: "c1" }),
    }));
  });
});
```

- [ ] **Step 3 : Lancer, vérifier l'échec**

Run: `cd editor && npx vitest run src/features/workspace/WorkspacePanel.test.tsx`
Expected: FAIL — module introuvable.

- [ ] **Step 4 : Implémenter `WorkspacePanel.tsx`**
```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDraggable } from "@dnd-kit/core";
import { useNavigate, useParams } from "@tanstack/react-router";
import { LayoutGrid, TerminalSquare, MessageSquare } from "lucide-react";
import type { PackId } from "@/domain/types";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { buildPackElements, type ElementType, type PackElementItem } from "./usePackElements";

export const PANEL_DRAG_PREFIX = "panel:";
const TYPE_ICON: Record<ElementType, typeof LayoutGrid> = {
  menu: LayoutGrid, command: TerminalSquare, dialog: MessageSquare,
};

export function WorkspacePanel({ packId }: { packId: PackId }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { networkId?: string; serverId?: string };
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const activeLang = useUiStore((s) => s.activeLang);
  const [q, setQ] = useState("");
  if (!pack) return null;

  const groups = buildPackElements(pack, activeLang).map((g) => ({
    ...g, items: g.items.filter((it) => it.label.toLowerCase().includes(q.toLowerCase())),
  }));
  const empty = groups.every((g) => g.items.length === 0);

  const openElement = (id: string) =>
    navigate({
      to: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId/element/$elementId",
      params: { networkId: params.networkId!, serverId: params.serverId!, workspaceId: packId, elementId: id },
    });

  return (
    <nav className="flex h-full flex-col gap-2 overflow-auto p-2">
      <Input placeholder={t("workspacePanel.search")} value={q} onChange={(e) => setQ(e.target.value)} />
      {empty ? (
        <EmptyState title={t("workspacePanel.empty")} />
      ) : (
        groups.map((g) => g.items.length > 0 && (
          <div key={g.type} className="flex flex-col">
            <div className="px-2 pt-2 pb-1 text-[9.5px] font-bold uppercase tracking-[.14em] text-[var(--text-faint)]">
              {t(`workspacePanel.${g.type === "menu" ? "menus" : g.type === "command" ? "commands" : "dialogs"}`)}
            </div>
            {g.items.map((it) => (
              <PanelItem key={it.id} packId={packId} item={it} onOpen={() => openElement(it.id)} />
            ))}
          </div>
        ))
      )}
    </nav>
  );
}

function PanelItem({ packId, item, onOpen }: { packId: PackId; item: PackElementItem; onOpen: () => void }) {
  const { t } = useTranslation();
  const Icon = TYPE_ICON[item.type];
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${PANEL_DRAG_PREFIX}${item.id}`, data: { nodeId: item.id, type: item.type },
  });
  return (
    <div className="group flex items-center gap-1 rounded-[10px] hover:bg-[var(--surface-hover)]"
         style={{ opacity: isDragging ? 0.4 : 1 }}>
      <button type="button" onClick={onOpen}
        className="flex flex-1 items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[13px] text-[var(--text-mut)] hover:text-[var(--text)]">
        <Icon className="size-[15px] shrink-0 text-[var(--text-faint)]" />
        <span className="flex-1 truncate">{item.label}</span>
        {item.onBoard && (
          <span className="shrink-0 text-[9px] text-[var(--brand)]">{t("workspacePanel.onBoard")}</span>
        )}
      </button>
      <span ref={setNodeRef} {...listeners} {...attributes}
            className="w-5 shrink-0 cursor-grab touch-none text-center text-[var(--text-faint)]" aria-label="drag">⋮⋮</span>
      <DropdownMenu>
        <DropdownMenuTrigger className="w-5 shrink-0 text-[var(--text-faint)]">···</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={onOpen}>{t("workspacePanel.edit")}</DropdownMenuItem>
          {item.onBoard ? (
            <DropdownMenuItem onClick={() => useAccountStore.getState().removeFromBoard({ packId, nodeId: item.id })}>
              {t("workspacePanel.removeFromBoard")}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => useAccountStore.getState().addToBoard({ packId, nodeId: item.id, x: 40, y: 40 })}>
              {t("workspacePanel.addToBoard")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => useAccountStore.getState().deleteFromPack({ packId, nodeIds: [item.id] })}>
            {t("workspacePanel.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
```

- [ ] **Step 5 : Lancer les tests, vérifier qu'ils passent**

Run: `cd editor && npx vitest run src/features/workspace/WorkspacePanel.test.tsx`
Expected: PASS (3 tests). Vérifier que `useUiStore` expose bien `activeLang` (utilisé dans `MenuGroup`).

- [ ] **Step 6 : Commit**
```bash
git add editor/src/features/workspace/WorkspacePanel.tsx editor/src/locales/en.ts editor/src/locales/fr.ts editor/src/features/workspace/WorkspacePanel.test.tsx
git commit -m "feat(editor): WorkspacePanel — categorized list, search, board badge, context menu

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 7 : Intégrer `WorkspacePanel` au layout overview + drag→planche + bouton « Tout arranger »

**Files:**
- Modify: `editor/src/routes/networks.$networkId.servers.$serverId.workspaces.$workspaceId.tsx`
- Test: étendre `editor/src/routes/networks.$networkId.servers.$serverId.workspaces.$workspaceId.test.tsx`

L'overview est aujourd'hui un `SplitPane(primary=<Stage/>, secondary=<EditorPane/>)`. On insère le panneau à gauche : `SplitPane(primary=<WorkspacePanel/>, secondary=<SplitPane(Stage, EditorPane)>)` côté desktop. Le `onDragEnd` global doit gérer le préfixe `PANEL_DRAG_PREFIX`.

- [ ] **Step 1 : Écrire le test rouge (drop panneau→planche appelle addToBoard)**

Ajouter dans le test de route un cas qui simule `onDragEnd` avec un id `panel:...`. Comme `onDragEnd` est interne, exposer la logique de drop dans une fonction pure testable `handlePanelDrop` (créée Step 3) et tester celle-ci :
```ts
import { handlePanelDrop } from "./networks.$networkId.servers.$serverId.workspaces.$workspaceId";
import { useAccountStore } from "@/state/accountStore";

it("handlePanelDrop ajoute l'élément à la planche aux coords monde", () => {
  // seed pack p1 with menu m2 off-board (réutiliser le helper de seed du fichier)
  const before = useAccountStore.getState().account.packs.find((p) => p.id === "p1");
  handlePanelDrop("p1" as any, "m2", 120, 80);
  const pack = useAccountStore.getState().account.packs.find((p) => p.id === "p1")!;
  expect("m2" in pack.canvasLayout).toBe(true);
});
```
> Si le seed de pack du fichier de test ne contient pas `m2`, ajouter un menu off-board au helper `makePack`/mock utilisé.

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `cd editor && npx vitest run "src/routes/networks.\$networkId.servers.\$serverId.workspaces.\$workspaceId.test.tsx"`
Expected: FAIL — `handlePanelDrop` not exported.

- [ ] **Step 3 : Implémenter — fonction de drop + branchement dans `onDragEnd`**

Dans la route, ajouter l'import `import { PANEL_DRAG_PREFIX, WorkspacePanel } from "@/features/workspace/WorkspacePanel";` et `import { screenToWorld } from "@/features/canvas/hitTest";` (déjà utilisé par Stage). Exposer :
```ts
/** Convertit un drop panneau→planche en addToBoard aux coordonnées monde. */
export function handlePanelDrop(packId: PackId, nodeId: string, worldX: number, worldY: number) {
  useAccountStore.getState().addToBoard({ packId, nodeId, x: worldX, y: worldY });
}
```
Dans `onDragEnd`, AVANT le bloc `LIBRARY_DRAG_PREFIX`, ajouter :
```ts
if (id.startsWith(PANEL_DRAG_PREFIX)) {
  const nodeId = id.slice(PANEL_DRAG_PREFIX.length);
  const start = e.activatorEvent as PointerEvent;
  const endX = (start.clientX ?? 0) + e.delta.x;
  const endY = (start.clientY ?? 0) + e.delta.y;
  // Convertir en coords monde via le geometry provider du Stage (cf. setStageGeometryProvider).
  const geo = getStageGeometry?.();
  if (geo) {
    const world = screenToWorld({ x: endX - geo.wrapperRect.left, y: endY - geo.wrapperRect.top }, geo.viewport);
    handlePanelDrop(pId, nodeId, world.x, world.y);
  } else {
    handlePanelDrop(pId, nodeId, 40, 40);
  }
  return;
}
```
> `getStageGeometry` : ajouter un getter symétrique à `setStageGeometryProvider` dans `editor/src/features/canvas/stageGeometry.ts` (le provider y est déjà posé par Stage). Exporter `export function getStageGeometry() { return provider?.() ?? null; }`.

- [ ] **Step 4 : Implémenter — insérer le panneau dans le layout overview (desktop)**

Remplacer le bloc `tab === "overview"` desktop par un SplitPane à 3 zones :
```tsx
{isDesktop ? (
  <SplitPane
    orientation="horizontal"
    primary={<WorkspacePanel packId={pId} />}
    secondary={
      <SplitPane
        orientation="horizontal"
        primary={<Stage packId={pId} />}
        secondary={<EditorPane packId={pId} />}
        secondarySize={editorPaneWidth}
        onSecondarySizeChange={setEditorPaneWidth}
        minSecondary={280}
        minPrimary={400}
      />
    }
    secondarySize={undefined as any}  /* primary = panneau à largeur fixe via minPrimary */
    minPrimary={220}
    minSecondary={500}
  />
) : ( /* mobile inchangé pour l'instant — traité en P7 */ )}
```
> Ajuster les props `SplitPane` selon sa vraie signature (lire `editor/src/components/SplitPane.tsx`). Cible visuelle : panneau ~240px à gauche, planche au centre, éditeur à droite. Mobile reste l'ancien comportement jusqu'à P7.

- [ ] **Step 5 : Ajouter le bouton « Tout arranger » dans l'état vide de la planche**

Dans `Stage.tsx`, si `Object.keys(layout).length === 0`, rendre par-dessus le canvas un overlay `EmptyState` avec une action :
```tsx
{Object.keys(layout).length === 0 && (
  <div className="absolute inset-0 flex items-center justify-center">
    <EmptyState
      title={t("workspacePanel.empty")}
      action={
        <button className="btn btn-outline btn-sm"
          onClick={() => useAccountStore.getState().arrangeAllOnBoard({ packId })}>
          {t("workspacePanel.arrangeAll")}
        </button>
      }
    />
  </div>
)}
```
(importer `EmptyState`, `useTranslation`.)

- [ ] **Step 6 : Lancer les tests de route + canvas**

Run: `cd editor && npx vitest run "src/routes/networks.\$networkId.servers.\$serverId.workspaces.\$workspaceId.test.tsx" src/features/canvas`
Expected: PASS.

- [ ] **Step 7 : Commit**
```bash
git add editor/src/routes/networks.\$networkId.servers.\$serverId.workspaces.\$workspaceId.tsx editor/src/features/canvas/stageGeometry.ts editor/src/features/canvas/Stage.tsx
git commit -m "feat(editor): mount WorkspacePanel in overview; panel drag adds to board; empty-board arrange-all

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 8 : `MenuGroup` mode `solo` (rendu à l'origine, non-draggable, sans sélection-menu)

**Files:**
- Modify: `editor/src/features/canvas/MenuGroup.tsx`
- Test: `editor/src/features/canvas/MenuGroup.solo.test.tsx`

Objectif : le même `MenuGroup` doit pouvoir se monter seul. En mode `solo` : `draggable=false`, pas de `onClick`/`onDragStart`/`onDragEnd` de sélection-menu, position forcée à `{0,0}`. Les slots restent cliquables (édition) — c'est le comportement à préserver pour zéro divergence.

- [ ] **Step 1 : Écrire le test rouge**
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
// (réutiliser le bloc de mocks react-konva / use-image / TitleRender de MenuGroup.test.tsx)
import type { Menu, MenuId, PackId } from "@/domain/types";
import { MenuGroup } from "./MenuGroup";

describe("MenuGroup solo", () => {
  it("ne pose pas de Group draggable et se rend à l'origine", () => {
    const menu = { id: "m1" as MenuId, packId: "p1" as PackId, title: [], rows: 3, layers: [] } as Menu;
    render(<MenuGroup packId={"p1" as PackId} menu={menu} position={{ x: 99, y: 99 }} layout={{}} solo />);
    const outer = screen.getAllByTestId("konva-group").find((g) => g.getAttribute("data-name") === "menu:m1")!;
    expect(outer.getAttribute("data-x")).toBe("0"); // forcé à l'origine en solo
    expect(outer.getAttribute("data-draggable")).toBe("false");
  });
});
```
> Étendre le mock `Group` pour exposer `data-draggable={String(props.draggable)}` (ajouter cette ligne au mock partagé).

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `cd editor && npx vitest run src/features/canvas/MenuGroup.solo.test.tsx`
Expected: FAIL — `solo` ignoré, `data-x` = 99.

- [ ] **Step 3 : Implémenter le flag `solo`**

Dans `MenuGroupProps`, ajouter `solo?: boolean;`. Dans le composant, destructurer `solo = false`. Modifier le `<Group>` racine :
```tsx
<Group
  x={solo ? 0 : position.x}
  y={solo ? 0 : position.y}
  draggable={!solo}
  onDragStart={solo ? undefined : onMenuDragStart}
  onDragEnd={solo ? undefined : onMenuDragEnd}
  onClick={solo ? undefined : onClick}
  onTap={solo ? undefined : onClick}
  name={`menu:${menu.id}`}
  id={menu.id}
>
```
Les handlers de slot (édition) ne changent pas — ils restent actifs en solo.

- [ ] **Step 4 : Lancer les tests (nouveau + existants)**

Run: `cd editor && npx vitest run src/features/canvas/MenuGroup.solo.test.tsx src/features/canvas/MenuGroup.test.tsx`
Expected: PASS (le test existant ne passe pas `solo` → comportement board inchangé).

- [ ] **Step 5 : Commit**
```bash
git add editor/src/features/canvas/MenuGroup.tsx editor/src/features/canvas/MenuGroup.solo.test.tsx
git commit -m "feat(editor): MenuGroup solo mode (origin, non-draggable, no menu-select) for individual view

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 9 : `SoloMenuStage` — Konva Stage minimal hébergeant un menu seul

**Files:**
- Create: `editor/src/features/workspace/SoloMenuStage.tsx`
- Test: `editor/src/features/workspace/SoloMenuStage.test.tsx`

Monte un `react-konva` `Stage`+`Layer` dimensionné au wrapper, centré, et rend `<MenuGroup solo>`. Réutilise le pattern `ResizeObserver` + `imageSmoothingEnabled={false}` de `Stage.tsx`.

- [ ] **Step 1 : Écrire le test rouge**
```tsx
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pack, PackId, MenuId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
// mocks react-konva/use-image/TitleRender comme ailleurs
import { SoloMenuStage } from "./SoloMenuStage";

const PID = "p1" as PackId;
beforeEach(() => {
  useAccountStore.setState({ account: { id: "a" as any, packOrder: [PID], packs: [{
    id: PID, name: "p", source: "user_created", createdAt: "", updatedAt: "",
    menus: [{ id: "m1", packId: PID, title: [], rows: 3, layers: [] } as any],
    commands: [], dialogs: [], templates: [], assets: [], dataSources: [], importedConnectors: [],
    i18nKeys: {}, defaultLang: "en", canvasLayout: {},
  } as Pack] } } as any);
});

describe("SoloMenuStage", () => {
  it("rend le menu demandé en mode solo", () => {
    render(<SoloMenuStage packId={PID} menuId={"m1" as MenuId} />);
    const g = screen.getAllByTestId("konva-group").find((x) => x.getAttribute("data-name") === "menu:m1");
    expect(g).toBeDefined();
  });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec** — Run: `cd editor && npx vitest run src/features/workspace/SoloMenuStage.test.tsx` → FAIL.

- [ ] **Step 3 : Implémenter**
```tsx
import { useEffect, useRef, useState } from "react";
import { Stage as KonvaStage, Layer } from "react-konva";
import type { MenuId, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { MenuGroup } from "@/features/canvas/MenuGroup";

export function SoloMenuStage({ packId, menuId }: { packId: PackId; menuId: MenuId }) {
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const menu = pack?.menus.find((m) => m.id === menuId);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!wrapperRef.current) return;
    const ro = new ResizeObserver(([e]) => { if (e) setSize({ w: e.contentRect.width, h: e.contentRect.height }); });
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);
  if (!menu) return null;
  return (
    <div ref={wrapperRef} className="stage-bg-dots relative h-full w-full">
      <KonvaStage width={size.w} height={size.h} x={Math.max(40, size.w / 2 - 180)} y={40}>
        <Layer name="solo-menu" imageSmoothingEnabled={false}>
          <MenuGroup packId={packId} menu={menu} position={{ x: 0, y: 0 }} layout={{}} solo />
        </Layer>
      </KonvaStage>
    </div>
  );
}
```

- [ ] **Step 4 : Lancer le test** — Run: `cd editor && npx vitest run src/features/workspace/SoloMenuStage.test.tsx` → PASS.

- [ ] **Step 5 : Commit**
```bash
git add editor/src/features/workspace/SoloMenuStage.tsx editor/src/features/workspace/SoloMenuStage.test.tsx
git commit -m "feat(editor): SoloMenuStage hosts a single menu via MenuGroup solo

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 10 : Route enfant `element/$elementId` + `ElementView` (menu)

**Files:**
- Create: `editor/src/features/workspace/ElementView.tsx`
- Create: `editor/src/routes/networks.$networkId.servers.$serverId.workspaces.$workspaceId.element.$elementId.tsx`
- Modify: `editor/src/locales/en.ts` + `fr.ts` (clé `elementView.back`)
- Test: `editor/src/features/workspace/ElementView.test.tsx`

`ElementView` résout l'élément dans le pack, dispatch par type. Menu → `SoloMenuStage` (centre) + `EditorPane` (droite, édite le slot sélectionné). Top bar : bouton retour planche. Commande/dialog → P5 (placeholder « bientôt » en P4, remplacé en P5 — PAS un placeholder de plan : un vrai `EmptyState` temporaire).

- [ ] **Step 1 : Ajouter les clés i18n**

`en.ts` : `elementView: { back: "Back to board", notFound: "This element no longer exists", soon: "Editor coming soon" },`
`fr.ts` : `elementView: { back: "Retour à la planche", notFound: "Cet élément n'existe plus", soon: "Éditeur bientôt disponible" },`

- [ ] **Step 2 : Écrire le test rouge (`ElementView`)**
```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pack, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useParams: () => ({ networkId: "n1", serverId: "s1", workspaceId: "p1", elementId: "m1" }),
}));
vi.mock("./SoloMenuStage", () => ({ SoloMenuStage: () => <div data-testid="solo-menu" /> }));
vi.mock("@/features/canvas/EditorPane", () => ({ EditorPane: () => <div data-testid="editor-pane" /> }));
import { ElementView } from "./ElementView";

const PID = "p1" as PackId;
beforeEach(() => {
  navigate.mockClear();
  useAccountStore.setState({ account: { id: "a" as any, packOrder: [PID], packs: [{
    id: PID, name: "p", source: "user_created", createdAt: "", updatedAt: "",
    menus: [{ id: "m1", packId: PID, title: [], rows: 3, layers: [] } as any],
    commands: [], dialogs: [], templates: [], assets: [], dataSources: [], importedConnectors: [],
    i18nKeys: {}, defaultLang: "en", canvasLayout: {},
  } as Pack] } } as any);
});

describe("ElementView", () => {
  it("rend SoloMenuStage + EditorPane pour un menu", () => {
    render(<ElementView packId={PID} elementId={"m1" as any} />);
    expect(screen.getByTestId("solo-menu")).toBeInTheDocument();
    expect(screen.getByTestId("editor-pane")).toBeInTheDocument();
  });
  it("le bouton retour navigue vers l'overview", () => {
    render(<ElementView packId={PID} elementId={"m1" as any} />);
    fireEvent.click(screen.getByText(/back to board|retour à la planche/i));
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({
      to: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId",
    }));
  });
  it("élément introuvable → notFound", () => {
    render(<ElementView packId={PID} elementId={"zzz" as any} />);
    expect(screen.getByText(/no longer exists|n'existe plus/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3 : Lancer, vérifier l'échec** — `cd editor && npx vitest run src/features/workspace/ElementView.test.tsx` → FAIL.

- [ ] **Step 4 : Implémenter `ElementView.tsx`**
```tsx
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ElementId, MenuId, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { EmptyState } from "@/components/ui/empty-state";
import { SplitPane } from "@/components/SplitPane";
import { EditorPane } from "@/features/canvas/EditorPane";
import { useSelectionStore } from "@/state/selectionStore";
import { useEffect } from "react";
import { SoloMenuStage } from "./SoloMenuStage";

export function ElementView({ packId, elementId }: { packId: PackId; elementId: ElementId }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { networkId?: string; serverId?: string };
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const menu = pack?.menus.find((m) => m.id === elementId);
  const command = pack?.commands.find((c) => c.id === elementId);
  const dialog = pack?.dialogs.find((d) => d.id === elementId);

  // Sélectionner l'élément pour que l'EditorPane (Edit tab) l'édite.
  useEffect(() => { useSelectionStore.getState().set([elementId]); }, [elementId]);

  const back = () => navigate({
    to: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId",
    params: { networkId: params.networkId!, serverId: params.serverId!, workspaceId: packId },
  });

  const header = (
    <header className="flex h-[52px] shrink-0 items-center gap-3 px-4">
      <button type="button" onClick={back} className="btn btn-ghost btn-sm inline-flex items-center gap-1.5">
        <ArrowLeft className="size-4" /> {t("elementView.back")}
      </button>
      <span className="truncate text-[14px] font-medium text-[var(--text)]">{elementId}</span>
    </header>
  );

  if (!pack || (!menu && !command && !dialog)) {
    return (<div className="flex h-full flex-col">{header}
      <div className="flex flex-1 items-center justify-center"><EmptyState title={t("elementView.notFound")} /></div></div>);
  }

  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="min-h-0 flex-1">
        {menu ? (
          <SplitPane orientation="horizontal"
            primary={<SoloMenuStage packId={packId} menuId={elementId as unknown as MenuId} />}
            secondary={<EditorPane packId={packId} />}
            secondarySize={320} onSecondarySizeChange={() => {}} minSecondary={280} minPrimary={400} />
        ) : (
          // Commande/dialog : remplacé en P5 par le flux centré
          <div className="flex h-full items-center justify-center"><EmptyState title={t("elementView.soon")} /></div>
        )}
      </div>
    </div>
  );
}
```
> Vérifier la vraie signature de `SplitPane` et de `selectionStore.set` (le test `MenuGroup.test.tsx` utilise `sel.set([id], slot)` — `set` accepte un 2ᵉ arg optionnel ; `set([elementId])` doit suffire).

- [ ] **Step 5 : Créer la route enfant**

`editor/src/routes/networks.$networkId.servers.$serverId.workspaces.$workspaceId.element.$elementId.tsx` :
```tsx
import { createFileRoute, useParams } from "@tanstack/react-router";
import type { ElementId, PackId } from "@/domain/types";
import { ElementView } from "@/features/workspace/ElementView";

export const Route = createFileRoute(
  "/networks/$networkId/servers/$serverId/workspaces/$workspaceId/element/$elementId",
)({ component: ElementRoute });

function ElementRoute() {
  const { workspaceId, elementId } = useParams({
    from: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId/element/$elementId",
  });
  return <ElementView packId={workspaceId as PackId} elementId={elementId as ElementId} />;
}
```
> Le `<Outlet/>` parent (déjà présent : `if (childMatches.length > 0) return <Outlet />`) rend cette route. Lancer `npm run dev` une fois pour régénérer `routeTree.gen.ts`, OU `cd editor && npx tsr generate` si le script existe ; sinon le plugin Vite le génère au prochain démarrage. Committer le `routeTree.gen.ts` régénéré.

- [ ] **Step 6 : Lancer les tests + typecheck**

Run: `cd editor && npx vitest run src/features/workspace/ElementView.test.tsx && npx tsc --noEmit`
Expected: PASS + 0 erreur TS.

- [ ] **Step 7 : Commit**
```bash
git add editor/src/features/workspace/ElementView.tsx editor/src/routes/networks.\$networkId.servers.\$serverId.workspaces.\$workspaceId.element.\$elementId.tsx editor/src/routeTree.gen.ts editor/src/locales/en.ts editor/src/locales/fr.ts editor/src/features/workspace/ElementView.test.tsx
git commit -m "feat(editor): deep-linkable individual view route + ElementView (menu via SoloMenuStage)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 11 : Investiguer l'éditeur de flux réutilisable (commande/dialog)

**Files:** lecture seule — `editor/src/features/flow/FlowCanvas.tsx`, `editor/src/features/canvas/EditorPane.tsx`, et tout `ActionsChain*`/steps editor existant.

> Étape d'investigation **bornée** (pas un placeholder) : la vue individuelle commande/dialog doit réutiliser l'éditeur de steps existant, centré. Avant d'écrire du code, déterminer CE qui existe pour éviter une nouvelle divergence.

- [ ] **Step 1 : Cartographier l'éditeur de steps**

Lire `FlowCanvas.tsx` (rendu par l'onglet *Edit* de `EditorPane`). Répondre par écrit (dans le commit message ou un commentaire) :
1. `FlowCanvas` édite-t-il les `steps` de l'élément actuellement sélectionné (`selectionStore`) ? Gère-t-il commandes ET dialogs ET click-handlers de menu-elements, ou seulement un sous-ensemble ?
2. Quelle est sa surface props ? Peut-il être monté centré, large, sans le contexte pane ?
3. Existe-t-il déjà un composant « liste indentée pseudo-code » (cf. [[editor-ux-prefer-pseudocode]]) ou faut-il le construire autour de `walkActions`/`Step` ?

- [ ] **Step 2 : Décider et documenter le plan P5 exact**

Selon les findings, choisir :
- **Cas A** — `FlowCanvas` gère déjà commande/dialog : Task 12 = monter `<FlowCanvas>` centré dans `ElementView` pour ces types (réutilisation directe, zéro nouveau code d'édition).
- **Cas B** — il ne gère pas : Task 12 = extraire un `ActionsChainEditor` partagé (utilisé par le pane ET la vue centrée), édité via les actions store existantes (`updateCommandStep`, etc. — vérifier leurs noms réels dans `accountStore.ts`).

Écrire la décision en tête de Task 12 avant de coder.

- [ ] **Step 3 : Commit (notes d'investigation si un fichier de notes est créé, sinon rien)**

---

## Task 12 : `ElementView` commande/dialog — flux centré

**Files:**
- Modify: `editor/src/features/workspace/ElementView.tsx`
- Test: étendre `editor/src/features/workspace/ElementView.test.tsx`

> Implémenter selon la décision de Task 11 (Cas A ou B). Le code ci-dessous couvre le **Cas A** (réutilisation directe de `FlowCanvas` centré) ; adapter si Cas B.

- [ ] **Step 1 : Test rouge — commande rend l'éditeur de flux centré**
```tsx
// dans ElementView.test.tsx, ajouter un mock FlowCanvas + un pack avec une commande
vi.mock("@/features/flow/FlowCanvas", () => ({ FlowCanvas: () => <div data-testid="flow-canvas" /> }));
// ... seed pack avec commands: [{ id: "c1", name: "heal", arguments: [], steps: [] }]
it("rend l'éditeur de flux centré pour une commande", () => {
  render(<ElementView packId={PID} elementId={"c1" as any} />);
  expect(screen.getByTestId("flow-canvas")).toBeInTheDocument();
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec** — FAIL (rend encore `elementView.soon`).

- [ ] **Step 3 : Implémenter le branche commande/dialog**

Dans `ElementView.tsx`, remplacer le bloc `EmptyState soon` par :
```tsx
) : (command || dialog) ? (
  <div className="mx-auto h-full w-full max-w-3xl overflow-auto px-6 py-6">
    <FlowCanvas packId={packId} />
  </div>
) : null}
```
Ajouter l'import `import { FlowCanvas } from "@/features/flow/FlowCanvas";`. La sélection (`useSelectionStore.set([elementId])`, déjà posée Task 10) garantit que `FlowCanvas` édite le bon élément.

- [ ] **Step 4 : Lancer les tests** — `cd editor && npx vitest run src/features/workspace/ElementView.test.tsx` → PASS.

- [ ] **Step 5 : Commit**
```bash
git add editor/src/features/workspace/ElementView.tsx editor/src/features/workspace/ElementView.test.tsx
git commit -m "feat(editor): individual view for command/dialog (centered flow editor)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 13 : Chips fantômes — liens vers cibles hors-planche

**Files:**
- Create: `editor/src/features/canvas/offBoardLinks.ts`
- Test: `editor/src/features/canvas/offBoardLinks.test.ts`
- Modify: `editor/src/features/canvas/Stage.tsx` (rendre les chips) + `MenuGroup`/`CommandGroup`/`DialogGroup` selon où ancrer (au plus simple : overlay au niveau Stage par nœud source).

`deriveEdges(pack)` → `Edge[] { id, source, target, triggers }`. Un lien est « hors-planche » si `source ∈ layout` mais `target ∉ layout`.

- [ ] **Step 1 : Test rouge (fonction pure)**
```ts
import { describe, expect, it } from "vitest";
import { offBoardLinks } from "./offBoardLinks";

it("retourne les cibles hors-planche par nœud source présent", () => {
  const edges = [
    { id: "m1->shop", source: "m1", target: "shop", triggers: [] },
    { id: "m1->m2", source: "m1", target: "m2", triggers: [] },
  ] as any;
  const layout = { m1: { x: 0, y: 0 }, m2: { x: 1, y: 1 } };
  expect(offBoardLinks(edges, layout)).toEqual([{ source: "m1", target: "shop" }]);
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec** — FAIL.

- [ ] **Step 3 : Implémenter `offBoardLinks.ts`**
```ts
import type { Edge } from "./deriveEdges";
export interface OffBoardLink { source: string; target: string; }
/** Liens dont la source est sur la planche mais la cible non — candidats aux chips. */
export function offBoardLinks(edges: Edge[], layout: Record<string, { x: number; y: number }>): OffBoardLink[] {
  return edges
    .filter((e) => layout[e.source] && !layout[e.target])
    .map((e) => ({ source: e.source, target: e.target }));
}
```

- [ ] **Step 4 : Lancer le test** — PASS.

- [ ] **Step 5 : Rendre les chips dans `Stage.tsx`**

Après le layer `commands`, ajouter un layer overlay qui, pour chaque `OffBoardLink`, rend un petit `Group`/`Label` cliquable ancré au coin haut-droit de la box du nœud `source` (positions via `layout[source]` + dimensions box de `menuLayout`). Au clic : `useAccountStore.getState().addToBoard({ packId, nodeId: target, x: layout[source].x + 240, y: layout[source].y })`. Label = nom résolu de la cible (`buildPackElements` ou la résolution de `EdgeTooltip`). Garder ≤ 1 chip par cible distincte par source.

- [ ] **Step 6 : Test d'intégration léger (clic chip → addToBoard)**

Dans `Stage.boardMembership.test.tsx`, ajouter un pack où `m1` (on-board) ouvre `m2` (off-board), vérifier qu'un élément cliquable de chip existe et que le clic appelle `addToBoard` (espionner via `vi.spyOn(useAccountStore.getState(), "addToBoard")` ou vérifier `canvasLayout.m2` après `fireEvent.click`).

- [ ] **Step 7 : Lancer canvas + commit**
```bash
cd editor && npx vitest run src/features/canvas
git add editor/src/features/canvas/offBoardLinks.ts editor/src/features/canvas/offBoardLinks.test.ts editor/src/features/canvas/Stage.tsx editor/src/features/canvas/Stage.boardMembership.test.tsx
git commit -m "feat(editor): ghost chips for off-board link targets (click to add to board)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 14 : Double-clic sur un nœud de la planche → vue individuelle

**Files:**
- Modify: `editor/src/features/canvas/MenuGroup.tsx`, `CommandGroup.tsx`, `DialogGroup.tsx` (ajouter `onDblClick`/`onDblTap`)
- Test: étendre les tests de groupe (le mock react-konva forwarde déjà `onDblClick`)

Le `onDblClick` doit naviguer vers la route élément. Comme les Groups n'ont pas accès à `useNavigate` proprement dans le contexte Konva, exposer un callback via un petit store/contexte, OU émettre un `CustomEvent` capté par la route (pattern déjà utilisé : `window.dispatchEvent(new CustomEvent("ifz:..."))`). Choisir le `CustomEvent` pour rester découplé.

- [ ] **Step 1 : Test rouge (MenuGroup émet l'event au double-clic)**
```tsx
it("double-clic émet ifz:open_element avec l'id", () => {
  const spy = vi.fn();
  window.addEventListener("ifz:open_element", spy as any);
  const menu = { id: "m1", packId: "p1", title: [], rows: 3, layers: [] } as any;
  render(<MenuGroup packId={"p1" as any} menu={menu} position={{ x: 0, y: 0 }} layout={{ m1: { x: 0, y: 0 } }} />);
  const g = screen.getAllByTestId("konva-group").find((x) => x.getAttribute("data-name") === "menu:m1")!;
  fireEvent.doubleClick(g);
  expect(spy).toHaveBeenCalled();
  window.removeEventListener("ifz:open_element", spy as any);
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec** — FAIL.

- [ ] **Step 3 : Implémenter — `onDblClick` dans chaque Group (non-solo)**

Dans `MenuGroup` (board mode), ajouter au `<Group>` :
```tsx
onDblClick={solo ? undefined : () => window.dispatchEvent(new CustomEvent("ifz:open_element", { detail: { id: menu.id } }))}
onDblTap={solo ? undefined : () => window.dispatchEvent(new CustomEvent("ifz:open_element", { detail: { id: menu.id } }))}
```
Idem pour `CommandGroup` (`command.id`) et `DialogGroup` (`dialog.id`).

- [ ] **Step 4 : Brancher l'écoute dans la route overview**

Dans `networks.$networkId.servers.$serverId.workspaces.$workspaceId.tsx`, ajouter un `useEffect` :
```tsx
useEffect(() => {
  function onOpen(e: Event) {
    const id = (e as CustomEvent<{ id: string }>).detail?.id;
    if (id) navigate({
      to: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId/element/$elementId",
      params: { networkId, serverId, workspaceId: pId, elementId: id },
    });
  }
  window.addEventListener("ifz:open_element", onOpen);
  return () => window.removeEventListener("ifz:open_element", onOpen);
}, [networkId, serverId, pId, navigate]);
```

- [ ] **Step 5 : Lancer canvas + route**

Run: `cd editor && npx vitest run src/features/canvas "src/routes/networks.\$networkId.servers.\$serverId.workspaces.\$workspaceId.test.tsx"`
Expected: PASS.

- [ ] **Step 6 : Commit**
```bash
git add editor/src/features/canvas/MenuGroup.tsx editor/src/features/canvas/CommandGroup.tsx editor/src/features/canvas/DialogGroup.tsx editor/src/routes/networks.\$networkId.servers.\$serverId.workspaces.\$workspaceId.tsx
git commit -m "feat(editor): double-click a board node opens its individual view

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 15 : Mobile — panneau en drawer, pas de hover-only

**Files:**
- Modify: `editor/src/routes/networks.$networkId.servers.$serverId.workspaces.$workspaceId.tsx` (branche `!isDesktop`)
- Modify: `editor/src/features/workspace/WorkspacePanel.tsx` (boutons d'action visibles, pas hover-only)
- Test: `editor/src/features/workspace/WorkspacePanel.mobile.test.tsx` (optionnel) + vérif manuelle

Rappels : `useIsDesktop()` = `≥1024px`. Pattern drawer mobile éprouvé dans `__root.tsx` (overlay `bg-black/50 lg:hidden` + `aside` translaté). Le `WorkspacePanel` actuel n'utilise PAS d'affordance hover-only (les actions sont dans un `DropdownMenu` toujours visible) — conforme à [[mobile-first]].

- [ ] **Step 1 : Layout mobile overview**

Dans la branche `!isDesktop` du `tab === "overview"`, présenter en mono-panneau : la planche (`Stage`) en plein, le `WorkspacePanel` accessible via un bouton qui ouvre un drawer (réutiliser `Sheet` côté `left`, `@/components/ui/sheet`), et `EditorPane` via le `SplitPane` vertical existant. Exemple :
```tsx
<>
  <div className="flex h-9 items-center gap-2 px-2">
    <Sheet>
      <SheetTrigger className="btn btn-ghost btn-sm">☰ {t("workspacePanel.menus")}</SheetTrigger>
      <SheetContent side="left"><SheetBody><WorkspacePanel packId={pId} /></SheetBody></SheetContent>
    </Sheet>
  </div>
  <SplitPane orientation="vertical" primary={<Stage packId={pId} />} secondary={<EditorPane packId={pId} />}
    secondarySize={flowCanvasHeight} onSecondarySizeChange={setFlowCanvasHeight} minSecondary={120} minPrimary={200} />
</>
```

- [ ] **Step 2 : Vérifier l'absence d'affordance hover-only**

Confirmer que `WorkspacePanel` n'introduit aucun `lg:opacity-0 lg:group-hover:opacity-100` SANS équivalent tactile. Le drag handle (`⋮⋮`) et le menu (`···`) doivent être visibles/atteignables au tactile (long-press non requis).

- [ ] **Step 3 : Lancer la suite éditeur complète + typecheck**

Run: `cd editor && npm test && npx tsc --noEmit`
Expected: PASS, 0 erreur TS.

- [ ] **Step 4 : Vérification manuelle (DevTools responsive < 1024px)**

Lancer `cd editor && npm run dev`, ouvrir un workspace, réduire < 1024px : le drawer du panneau s'ouvre/ferme, la planche et l'éditeur restent utilisables, clic sur un élément du drawer ouvre la vue individuelle.

- [ ] **Step 5 : Commit**
```bash
git add editor/src/routes/networks.\$networkId.servers.\$serverId.workspaces.\$workspaceId.tsx editor/src/features/workspace/WorkspacePanel.tsx
git commit -m "feat(editor): mobile layout — WorkspacePanel as left drawer, no hover-only affordances

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Documentation (à faire avant merge — discipline same-commit / sync-docs)

Per `CLAUDE.md` doc-impact map :
- `docs/architecture/editor-internals.md` — nouvelle section « Planche curée + panneau + vue individuelle » : sémantique `canvasLayout = appartenance`, `WorkspacePanel`, `ElementView`/route enfant, `MenuGroup solo`, chips.
- `docs/architecture/entities.md` — note la sémantique d'appartenance de `canvasLayout`.
- `CHANGELOG.md` `[Unreleased]` — entrée si une surface API publique/REST change (ici éditeur-only ; ajouter une ligne UX).
- La spec `2026-06-02-per-element-focus-mode-design.md` est déjà marquée superseded.

Si le volume doc dépasse ~30 lignes ou nécessite des screenshots → invoquer le skill `/sync-docs` en fin de feature (commit doc séparé).

---

## Self-Review (rempli par l'auteur du plan)

**Couverture spec ↔ tasks :**
- §3 modèle d'appartenance → Task 1, 2, 3.
- §4 panneau source-de-vérité → Task 5, 6, 7.
- §5 planche curée + chips → Task 3, 4 (curation), Task 13 (chips), §5.2 côté-à-côte/copier-coller = inchangé (déjà couvert par le code existant, aucune task requise).
- §6 vue individuelle deep-linkable + dispatch → Task 8, 9, 10 (menu), 11, 12 (commande/dialog).
- §7 refactor rendu partagé → Task 8 (paramétrage `solo` au lieu du split ; décision documentée en tête).
- §8 migration / états vides → Task 1 (plus d'auto-fill = planche vide), Task 7 (bouton « Tout arranger » + état vide).
- §9 mobile → Task 15.
- §10 impact code → couvert task par task.
- §13 non-goals → respectés (pas de cross-nav riche, pas de preview dialog, une seule planche, pas de schéma DB, dispatch extensible).

**Placeholders :** aucun « TODO/TBD ». Task 11 est une investigation **bornée** avec critères de sortie explicites (pas un placeholder). Les rares « vérifier la signature exacte de X » pointent une lecture ciblée d'un fichier nommé, pas du code à inventer.

**Cohérence des types/noms :** `addToBoard({packId,nodeId,x,y})`, `removeFromBoard({packId,nodeId})`, `arrangeAllOnBoard({packId})`, `gridArrange(pack)`, `autoLayout(pack)`, `buildPackElements(pack,activeLang)`, `visibleEdges(edges,layout)`, `offBoardLinks(edges,layout)`, `PANEL_DRAG_PREFIX`, `handlePanelDrop`, `SoloMenuStage`, `ElementView`, event `ifz:open_element`, flag `solo` — utilisés de façon cohérente d'une task à l'autre.
