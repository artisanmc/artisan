# Feature IA — sous-plan 1 : convertisseur `menu/v1 → domain` (éditeur)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) ou superpowers:executing-plans. Steps en checkbox (`- [ ]`).

**Goal:** Une fonction **pure** côté éditeur qui transforme un `menu/v1` canonique (ce que l'IA émet, validé par `validateMenuV1`) en **domain `Menu`** (le modèle interne de l'éditeur), en allouant les clés i18n pour le texte littéral. C'est l'inverse de `editor/src/features/export/transform.ts`. Réutilisable hors IA (import de fichiers `menu/v1`).

**Architecture:** Pure : `menuV1ToDomain(src, opts) → { menu, i18nKeys, unsupported }`. Pas de mutation de pack — elle **retourne** les entrées i18n allouées ; l'insertion dans `accountStore` est un sous-plan ultérieur (panel éditeur). Grâce à la P1, les structures `menu/v1` et domain sont alignées (steps, conditions `of`, title array) → le convertisseur se réduit à : **pont i18n** (string `{i18n:}`/littéral → `LText`), **un-snake** (`asset_id`→`assetId`, `menu_id`→`menuId`…), **`size`→`rows`** (÷9), **`pagination_*`→`paginate{direction}`**, et le **mapping de vocabulaire** (le domain ne couvre qu'un sous-ensemble du vocab `menu/v1` ; le reste est listé dans `unsupported`).

**Tech Stack:** TS, Vitest. Types entrée = `docs/schema/menu/v1/types.ts` (miroir canonique, aligné en P1.1) ; sortie = `@/domain/types` ; i18n = `@/lib/i18n` (`newI18nKey`).

**Emplacement:** `editor/src/schema/menuV1ToDomain.ts` (à côté de `validateMenuV1.ts` — outil schéma réutilisable ; imports relatifs courts vers `docs/`). *(Le spec IA suggérait `modules/assistant/import/` ; on le met dans `schema/` car réutilisable et imports plus simples — le futur module assistant l'importera depuis là.)*

**Prérequis:** P1.0–P1.2 mergées.

## Contrat & décisions

```ts
export interface ImportResult {
  menu: import("@/domain/types").Menu;
  /** Clés i18n allouées pour le texte littéral (à merger dans pack.i18nKeys par l'appelant). */
  i18nKeys: Record<string, Record<string, string>>;
  /** Constructs menu/v1 sans équivalent domain (le domain est un sous-ensemble du vocab plugin). */
  unsupported: string[];
}
export function menuV1ToDomain(
  src: Record<string, any>,
  opts: { packId: PackId; lang: string; translations?: Record<string, Record<string, string>> },
): ImportResult;
```

- **Pont i18n** : un champ texte `menu/v1` est une `string`. Littéral → **nouvelle clé** (`newI18nKey()`), valeur rangée sous `opts.lang`. `{i18n:KEY}` → réf `LText{key:KEY}` ; si `opts.translations[KEY]` fourni, copié dans `i18nKeys`. Les **title-layers** portent déjà `value:{key}` → passe-through en `LText{key}` (+ copie translation si fournie).
- **Vocab domain (cible)** : conditions `has_permission`, `has_money`, `placeholder_equals`, `placeholder_match`, `not`, `and`, `or`, `expression` ; actions `open_menu`, `close_menu`, `run_command`, `send_message`, `show_title`, `give_item`, `take_money`, `paginate`, `set_arg`, `set_arg_cycle_next/prev`, `open_dialog`, `close_dialog`. **Tout autre type `menu/v1`** (`has_item`, `give_money`, `teleport`, `broadcast`, `pagination_at_first`, …) → poussé dans `unsupported` (le domain/éditeur ne sait pas le représenter ; le grounding IA — sous-plan moteur — contraindra la sortie au sous-ensemble).
- **`if` d'appearance** : `menu/v1` `if: Condition[]` (ANDé) → domain `Appearance.if = if.map(cond)`, `ifJoins = ["and"]×(n−1)`. Un élément `{type:"or", of:[…]}` reste une condition composite domain.
- **Open items (sous-plan moteur/grounding, pas ici)** : comment l'IA émet un **titre littéral** (les title-layers canoniques portent une clé, pas un littéral — harmonisation i18n des titres = dette P1) ; le grounding restreint la sortie au vocab domain.

---

### Task 1 : i18n bridge + conditions (TDD)

**Files:**
- Create: `editor/src/schema/menuV1ToDomain.ts`
- Create: `editor/src/schema/menuV1ToDomain.test.ts`

- [ ] **Step 1 : Test (RED)** — `menuV1ToDomain.test.ts` :
```ts
import { describe, expect, it } from "vitest";
import { packId } from "@/domain/ids";
import { menuV1ToDomain } from "./menuV1ToDomain";

const opts = { packId: packId("p"), lang: "en" };

describe("menuV1ToDomain — i18n + conditions", () => {
  it("allocates a fresh key for literal text and stores the value", () => {
    const src = minimalMenu({ appTitle: "Shop" });
    const r = menuV1ToDomain(src, opts);
    const app = r.menu.layers[0].elements[0].appearances[0];
    const key = app.title!.key;
    expect(r.i18nKeys[key]).toEqual({ en: "Shop" });
  });

  it("references an existing {i18n:KEY} without allocating", () => {
    const src = minimalMenu({ appTitle: "{i18n:menus.x.title}" });
    const r = menuV1ToDomain(src, opts);
    expect(r.menu.layers[0].elements[0].appearances[0].title!.key).toBe("menus.x.title");
    expect(Object.keys(r.i18nKeys)).toHaveLength(0);
  });

  it("maps and/or with of, preserving 'of'", () => {
    const src = minimalMenu({
      if: [{ type: "and", of: [{ type: "has_permission", perm: "vip" }, { type: "has_money", amount: 100 }] }],
    });
    const r = menuV1ToDomain(src, opts);
    const cond = r.menu.layers[0].elements[0].appearances[0].if![0] as any;
    expect(cond.type).toBe("and");
    expect(cond.of).toHaveLength(2);
  });

  it("flags unsupported conditions instead of crashing", () => {
    const src = minimalMenu({ if: [{ type: "has_item", material: "DIRT", count: 1 }] });
    const r = menuV1ToDomain(src, opts);
    expect(r.unsupported.join(" ")).toMatch(/has_item/);
  });
});

function minimalMenu(p: { appTitle?: string; if?: any[] }): Record<string, any> {
  const appearance: Record<string, any> = {};
  if (p.appTitle) appearance.title = p.appTitle;
  if (p.if) appearance.if = p.if;
  appearance.material = "STONE";
  return {
    schema: "menu/v1", id: "shop", title: [], size: 27,
    layers: [{ id: "l1", name: "default", elements: [{ id: "e1", positions: "0", appearances: [appearance] }] }],
  };
}
```

- [ ] **Step 2 : Run (FAIL)** — `npx vitest run src/schema/menuV1ToDomain.test.ts` (working_directory `editor`).

- [ ] **Step 3 : Implémenter (partie 1)** — `menuV1ToDomain.ts` :
```ts
import { newI18nKey } from "@/lib/i18n";
import type {
  Condition as DomainCondition, I18nKey, LText, Menu as DomainMenu, PackId,
} from "@/domain/types";

type Json = Record<string, any>;

export interface ImportResult {
  menu: DomainMenu;
  i18nKeys: Record<string, Record<string, string>>;
  unsupported: string[];
}

const DOMAIN_CONDITIONS = new Set([
  "has_permission", "has_money", "placeholder_equals", "placeholder_match",
  "not", "and", "or", "expression",
]);

export function menuV1ToDomain(
  src: Json,
  opts: { packId: PackId; lang: string; translations?: Record<string, Record<string, string>> },
): ImportResult {
  const i18nKeys: Record<string, Record<string, string>> = {};
  const unsupported: string[] = [];

  function ref(key: string): LText {
    const tr = opts.translations?.[key];
    if (tr) i18nKeys[key] = { ...tr };
    return { key: key as I18nKey };
  }
  function text(raw: string | undefined): LText {
    const m = typeof raw === "string" ? /^\{i18n:(.+)\}$/.exec(raw) : null;
    if (m) return ref(m[1]!);
    const key = newI18nKey();
    i18nKeys[key] = { [opts.lang]: raw ?? "" };
    return { key };
  }

  function condition(c: Json): DomainCondition | null {
    if (!DOMAIN_CONDITIONS.has(c.type)) { unsupported.push(`condition: ${c.type}`); return null; }
    switch (c.type) {
      case "not": { const of = condition(c.of); return of ? { type: "not", of } : null; }
      case "and": return { type: "and", of: (c.of as Json[]).map(condition).filter(Boolean) as DomainCondition[] };
      case "or":  return { type: "or",  of: (c.of as Json[]).map(condition).filter(Boolean) as DomainCondition[] };
      default: return c as DomainCondition; // has_permission/has_money/placeholder_*/expression are identical
    }
  }

  // `if` array (ANDed) → domain if[] + ifJoins all "and"
  function ifArray(arr: Json[] | undefined): { conds: DomainCondition[]; joins: ("and" | "or")[] } | undefined {
    if (!arr || arr.length === 0) return undefined;
    const conds = arr.map(condition).filter(Boolean) as DomainCondition[];
    if (conds.length === 0) return undefined;
    return { conds, joins: new Array(Math.max(0, conds.length - 1)).fill("and") };
  }

  // ... assembled in later tasks (action/step/title/element/menu)
  // Placeholder so the file compiles for Task 1 tests:
  const menu = buildMenu(src, { text, ifArray, action: () => null, unsupported });
  return { menu, i18nKeys, unsupported };
}
```
(Le `buildMenu`/`action`/`step`/`titleLayer` complets arrivent en Task 2/3 ; pour faire passer Task 1, implémenter un `buildMenu` minimal qui mappe layers→elements→appearances avec `material`, `title` via `text`, et `if` via `ifArray` ; les clics/actions/title-layers peuvent être vides à ce stade.)

- [ ] **Step 4 : Run (PASS)** puis **commit** :
```bash
git add editor/src/schema/menuV1ToDomain.ts editor/src/schema/menuV1ToDomain.test.ts
git commit -m "feat(import): menu/v1 -> domain converter (i18n bridge + conditions)"
```

---

### Task 2 : Actions + steps (un-snake, `pagination_*`→`paginate`, vocab) (TDD)

**Files:** Modify `menuV1ToDomain.ts` + `.test.ts`.

- [ ] **Step 1 : Tests (RED)** — couvrir : `open_menu` (`menu_id`→`menuId`, `clear_context`→`clearContext`), `send_message` (`text` string → `LText`), `show_title` (`fade_in`→`fadeIn`…), `pagination_next`/`pagination_prev` → `paginate{direction, targetElementId?}`, `set_arg`, `open_dialog` (`dialog_id`→`dialogId`), un step `kind:"if"` (cases/else) round-trippé, et un `give_money` → `unsupported`.

- [ ] **Step 2 : Implémenter `action` + `step`** :
```ts
function action(a: Json): DomainAction | null {
  switch (a.type) {
    case "open_menu": return { type: "open_menu", menuId: a.menu_id, ...(a.clear_context ? { clearContext: true } : {}), ...(a.context ? { context: a.context } : {}) };
    case "close_menu": return { type: "close_menu" };
    case "run_command": return { type: "run_command", command: a.command, as: a.as ?? "player" };
    case "send_message": return { type: "send_message", text: text(a.text) };
    case "show_title": return { type: "show_title", title: text(a.title), ...(a.subtitle !== undefined ? { subtitle: text(a.subtitle) } : {}), ...(a.fade_in !== undefined ? { fadeIn: a.fade_in } : {}), ...(a.stay !== undefined ? { stay: a.stay } : {}), ...(a.fade_out !== undefined ? { fadeOut: a.fade_out } : {}) };
    case "give_item": return { type: "give_item", material: a.material, count: a.count };
    case "take_money": return { type: "take_money", amount: a.amount };
    case "pagination_next": return { type: "paginate", direction: "next", ...(a.element_id ? { targetElementId: a.element_id } : {}) };
    case "pagination_prev": return { type: "paginate", direction: "prev", ...(a.element_id ? { targetElementId: a.element_id } : {}) };
    case "set_arg": return { type: "set_arg", arg: a.arg, value: a.value };
    case "set_arg_cycle_next": return { type: "set_arg_cycle_next", arg: a.arg, list: a.list };
    case "set_arg_cycle_prev": return { type: "set_arg_cycle_prev", arg: a.arg, list: a.list };
    case "open_dialog": return { type: "open_dialog", dialogId: a.dialog_id, ...(a.clear_context ? { clearContext: true } : {}), ...(a.context ? { context: a.context } : {}) };
    case "close_dialog": return { type: "close_dialog" };
    default: unsupported.push(`action: ${a.type}`); return null;
  }
}
function step(s: Json): DomainStep | null {
  if (s.kind === "action") { const act = action(s.action); return act ? { kind: "action", action: act } : null; }
  if (s.kind === "if") {
    return {
      kind: "if",
      cases: (s.cases as Json[]).map((c) => ({
        conditions: (c.conditions as Json[]).map(condition).filter(Boolean) as DomainCondition[],
        ...(c.joins ? { joins: c.joins } : {}),
        steps: (c.steps as Json[]).map(step).filter(Boolean) as DomainStep[],
      })),
      ...(s.else ? { else: (s.else as Json[]).map(step).filter(Boolean) as DomainStep[] } : {}),
    };
  }
  unsupported.push(`step kind: ${s.kind}`); return null;
}
```
(Importer `Action as DomainAction`, `Step as DomainStep` depuis `@/domain/types`.)

- [ ] **Step 3 : Run (PASS) + commit** `feat(import): actions + step-tree (un-snake, pagination, vocab subset)`.

---

### Task 3 : Title layers + assemblage menu (TDD)

**Files:** Modify `menuV1ToDomain.ts` + `.test.ts`.

- [ ] **Step 1 : Tests (RED)** — title layers (un-snake : `asset_id`→`assetId`, `font_asset_id`→`fontAssetId`, `line_height`→`lineHeight`, `glyph_name`→`glyphName` ; `value:{key}`→`LText`), `size`→`rows` (27→3), `context_inputs`→`contextInputs`, `lore: string[]` → domain `LText` (join `\n` si multi-littéral ; réf si unique `{i18n:}`), `click` (ClickMap → ClickHandler `{steps}`).

- [ ] **Step 2 : Implémenter `titleLayer`, `appearance`, `element`, `layer`, `buildMenu`** (inverse de `serializeTitleLayer`/`serializeAppearance`/`serializeElement`/`serializeLayer`/`serializeMenu`). Points clés :
  - `rows = src.size / 9` (cast `1|2|3|4|5|6`).
  - `lore`: `appearance.lore` (string[]) → `lore.length === 1 ? text(lore[0]) : text(lore.join("\n"))` ; absent → `undefined`.
  - `click`: pour chaque clé de ClickType, `{ steps: handler.steps.map(step).filter(Boolean) }`.
  - `context_inputs` → `contextInputs` (passe-through ; `kind:"primitive"`/`"sourceRef"` selon présence de `source`/`ref`).
  - title-layers via `titleLayer` (un-snake + `value:{key}`→`ref(key)`).

- [ ] **Step 3 : Run (PASS) + commit** `feat(import): title layers + menu assembly (size->rows, context_inputs)`.

---

### Task 4 : Oracle round-trip (domain → export → import → résolu) (TDD)

**Files:** Create `editor/src/schema/menuV1ToDomain.roundtrip.test.ts`.

- [ ] **Step 1 : Test** — construire un domain `Pack`/`Menu` riche (title layers, élément multi-appearance avec `if` AND, click step-tree avec `if`-case, actions variées **du sous-ensemble domain**), l'exporter via `transform(pack)`, parser le YAML menu, le ré-importer via `menuV1ToDomain`, puis asserter :
  - structure : `rows`, nb layers/elements/appearances, types/champs d'actions et conditions identiques (modulo identité des clés i18n) ;
  - **texte résolu** : pour chaque `LText` importé, la valeur résolue via `i18nKeys` retournés == la valeur d'origine dans `pack.i18nKeys`.
  - Fournir `translations` = `pack.i18nKeys` à `menuV1ToDomain` (puisque l'export émet des `{i18n:}` refs) → l'import doit ré-référencer les mêmes clés avec les bonnes valeurs.

- [ ] **Step 2 : Run (PASS) + commit** `test(import): round-trip oracle domain<->menu/v1`.

---

### Task 5 : Docs

- [ ] **Step 1** — `CHANGELOG.md` `[Unreleased]` : convertisseur `menu/v1 → domain` (`editor/src/schema/menuV1ToDomain.ts`) + oracle round-trip. `docs/architecture/editor-internals.md` : note « import `menu/v1 → domain` (inverse de l'export), pont i18n + vocab sous-ensemble ». `docs/superpowers/specs/2026-06-08-ai-assistant-design.md` : cocher sous-plan (1) fait.
- [ ] **Step 2** — commit `docs(import): menu/v1 -> domain converter`.

---

## Self-review

- **Couverture** : i18n+conditions (T1), actions/steps (T2), title/assemblage (T3), oracle round-trip (T4), docs (T5). ✓
- **Réduit par P1** : structures alignées → le convertisseur est surtout un-snake + pont i18n + 2 remaps (`size`/`rows`, `pagination_*`/`paginate`). ✓
- **Vocab sous-ensemble** : les constructs `menu/v1` hors domain → `unsupported` (pas de crash) ; le grounding IA (sous-plan moteur) contraindra la sortie. ✓
- **Pur** : aucune mutation de pack ; `i18nKeys` retournés, insertion = sous-plan panel. ✓
- **Open items (hors ce plan)** : émission de **titre littéral** par l'IA (title-layers portent une clé) ; politique exacte sur `lore` multi-`{i18n:}`. Notés pour le sous-plan moteur/grounding.

## Suite (feature IA)

- **Sous-plan 2 — moteur backend** : `LLMProvider`, tools (`upsert_menu` gate = `validateMenuV1`), boucle agentique, grounding (vocab domain + fiches zmenu/DeluxeMenus), SSE.
- **Sous-plan 3 — crédits** (ledger + métering + débit).
- **Sous-plan 4 — panel éditeur** : chat + file-drop + applique les writes via ce convertisseur (action accountStore `addMenuFromV1`) + checkpoint/undo.
