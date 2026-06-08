# Canonicalisation P1.1 — conformité éditeur (export → menu/v1 canonique)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Faire en sorte que l'export de l'éditeur (`editor/src/features/export/transform.ts`) émette la forme **canonique** `menu/v1` (validée par `validateMenuV1`/ajv depuis P1.0), et aligner le miroir de types à la main `docs/schema/menu/v1/types.ts`. Oracle de vérité : un **test « golden pack → export → ajv-valide »** (RED→GREEN).

**Architecture:** L'export actuel dévie du schéma canonique sur 3 points : conditions sérialisées `{type:"and", all:[…]}`/`{type:"or", any:[…]}` (canonique = `of`), `if` d'appearance **collapsé en map** (canonique = tableau `Condition[]`), `title` plain-only émis en **string `{i18n:…}`** (canonique = tableau de layers), et l'action `paginate` (canonique = `pagination_next`/`pagination_prev`). Les actions `show_title`/`open_dialog`/`close_dialog`/`set_arg*` et le `context_inputs` snake_case sont **déjà** émis correctement. On corrige `transform.ts`, on met à jour les tests existants impactés, et on prouve la conformité par ajv.

**Tech Stack:** TS, Vitest, `yaml`, `validateMenuV1` (ajv, P1.0).

**Prérequis:** P1.0 mergée (schéma canonique + `editor/src/schema/validateMenuV1.ts`).

---

### Task 1 : Test oracle « golden export → ajv » (RED)

**Files:**
- Create: `editor/src/features/export/canonical.test.ts`

- [ ] **Step 1 : Écrire le test**

```ts
import { menuId, packId, layerId, elementId } from "@/domain/ids";
import type { I18nKey, Pack } from "@/domain/types";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { transform } from "./transform";
import { validateMenuV1 } from "@/schema/validateMenuV1";

// A pack exercising: plain + text title layers, multi-appearance element with
// AND and OR `if`, click step-tree with an if-case, and a spread of actions.
function goldenPack(): Pack {
  return {
    id: packId("p_gold"),
    name: "Gold",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    defaultLang: "en",
    i18nKeys: {
      "t.title": { en: "Shop" },
      "t.buy.title": { en: "Buy" },
      "t.buy.lore": { en: "Click" },
      "t.buy.msg": { en: "Bought!" },
    } as Pack["i18nKeys"],
    menus: [
      {
        id: menuId("shop"),
        packId: packId("p_gold"),
        rows: 3,
        title: [{ kind: "plain", value: { key: "t.title" as I18nKey } }],
        layers: [
          {
            id: layerId("l1"),
            name: "default",
            elements: [
              {
                id: elementId("buy"),
                positions: "13",
                appearances: [
                  {
                    if: [
                      { type: "has_permission", perm: "vip" },
                      { type: "has_money", amount: 100 },
                    ],
                    ifJoins: ["and"],
                    material: "DIAMOND",
                    title: { key: "t.buy.title" as I18nKey },
                    lore: { key: "t.buy.lore" as I18nKey },
                    click: {
                      left: {
                        steps: [
                          {
                            kind: "if",
                            cases: [
                              {
                                conditions: [{ type: "has_money", amount: 50 }],
                                steps: [{ kind: "action", action: { type: "take_money", amount: 50 } }],
                              },
                            ],
                            else: [
                              { kind: "action", action: { type: "send_message", text: { key: "t.buy.msg" as I18nKey } } },
                            ],
                          },
                          { kind: "action", action: { type: "open_menu", menuId: menuId("shop"), clearContext: true } },
                          { kind: "action", action: { type: "paginate", direction: "next" } },
                        ],
                      },
                    },
                  },
                  {
                    if: [
                      { type: "has_permission", perm: "a" },
                      { type: "has_permission", perm: "b" },
                    ],
                    ifJoins: ["or"],
                    material: "STONE",
                    title: { key: "t.buy.title" as I18nKey },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    commands: [],
    dialogs: [],
    assets: [],
    templates: [],
    dataSources: [],
    importedConnectors: [],
    canvasLayout: {},
  } as Pack;
}

describe("editor export conforms to canonical menu/v1", () => {
  it("every exported menu validates against the canonical schema", () => {
    const files = transform(goldenPack());
    const menuYamls = Object.entries(files).filter(([p]) => p.includes("/menus/"));
    expect(menuYamls.length).toBeGreaterThan(0);
    for (const [path, yaml] of menuYamls) {
      const menu = parse(yaml);
      const r = validateMenuV1(menu);
      expect(r.errors, `${path}: ${r.errors.join(" | ")}`).toEqual([]);
      expect(r.valid).toBe(true);
    }
  });
});
```

- [ ] **Step 2 : Run (FAIL attendu)**

Run (working_directory `editor`): `npx vitest run src/features/export/canonical.test.ts`
Expected : FAIL — erreurs ajv sur `if` (map au lieu d'array), conditions (`all`/`any` interdits par le schéma), action `paginate` (type inconnu), title plain (string au lieu d'array).

- [ ] **Step 3 : Commit (test RED, pour matérialiser l'oracle)**

```bash
git add editor/src/features/export/canonical.test.ts
git commit -m "test(export): canonical menu/v1 conformance oracle (currently red)"
```

---

### Task 2 : Conditions canoniques (`of` + `if` en tableau)

**Files:**
- Modify: `editor/src/features/export/transform.ts`
- Modify: `editor/src/features/export/transform.test.ts`

- [ ] **Step 1 : Corriger `serializeCondition` (all/any → of)**

Remplacer la fonction `serializeCondition` par :
```ts
function serializeCondition(c: Condition): unknown {
  if (c.type === "not") return { type: "not", of: serializeCondition(c.of) };
  if (c.type === "and") return { type: "and", of: (c.of as Condition[]).map(serializeCondition) };
  if (c.type === "or") return { type: "or", of: (c.of as Condition[]).map(serializeCondition) };
  return c;
}
```

- [ ] **Step 2 : Remplacer `collapseConditions` par `serializeIfArray`**

Supprimer `collapseConditions` et ajouter :
```ts
/**
 * Canonical appearance `if` is a Condition[] (ANDed). We mirror the prior
 * single-join semantics: one join op governs the whole list. A pure-OR list
 * becomes a single wrapped `or`; otherwise the array is emitted as-is (ANDed).
 */
function serializeIfArray(conditions: Condition[], joins?: ("and" | "or")[]): unknown[] {
  // biome-ignore lint/style/noNonNullAssertion: length === 1 guarantees [0]
  if (conditions.length === 1) return [serializeCondition(conditions[0]!)];
  const items = conditions.map(serializeCondition);
  if ((joins?.[0] ?? "and") === "or") return [{ type: "or", of: items }];
  return items;
}
```

- [ ] **Step 3 : Brancher dans `serializeAppearance`**

Dans `serializeAppearance`, remplacer la ligne `if` par :
```ts
  if (app.if && app.if.length > 0) out.if = serializeIfArray(app.if, app.ifJoins);
```

- [ ] **Step 4 : Mettre à jour les tests existants de conditions**

Dans `transform.test.ts`, dans le `describe("transform — appearance conditions")`, remplacer les 5 `it(...)` par :
```ts
  it("single condition is written as a one-element array", () => {
    const pack = makePack({ menus: [baseMenu([{ if: [{ type: "has_permission", perm: "vip" }] }])] });
    const app = getApp(transform(pack));
    expect(app.if).toEqual([{ type: "has_permission", perm: "vip" }]);
  });

  it("AND-joined conditions are an ANDed array", () => {
    const pack = makePack({ menus: [baseMenu([{
      if: [{ type: "has_permission", perm: "vip" } as Condition, { type: "has_money", amount: 100 } as Condition],
      ifJoins: ["and"],
    }])] });
    const app = getApp(transform(pack));
    expect(app.if).toEqual([{ type: "has_permission", perm: "vip" }, { type: "has_money", amount: 100 }]);
  });

  it("OR-joined conditions are wrapped in a single { type: 'or', of: [...] }", () => {
    const pack = makePack({ menus: [baseMenu([{
      if: [{ type: "has_permission", perm: "vip" } as Condition, { type: "has_permission", perm: "admin" } as Condition],
      ifJoins: ["or"],
    }])] });
    const app = getApp(transform(pack));
    expect(app.if).toEqual([{ type: "or", of: [{ type: "has_permission", perm: "vip" }, { type: "has_permission", perm: "admin" }] }]);
  });

  it("composite 'and' condition uses 'of'", () => {
    const inner: Condition = { type: "has_permission", perm: "vip" };
    const pack = makePack({ menus: [baseMenu([{ if: [{ type: "and", of: [inner] }] }])] });
    const app = getApp(transform(pack));
    expect(app.if[0].of).toBeDefined();
    expect(app.if[0].all).toBeUndefined();
  });

  it("composite 'or' condition uses 'of'", () => {
    const inner: Condition = { type: "has_permission", perm: "vip" };
    const pack = makePack({ menus: [baseMenu([{ if: [{ type: "or", of: [inner] }] }])] });
    const app = getApp(transform(pack));
    expect(app.if[0].of).toBeDefined();
    expect(app.if[0].any).toBeUndefined();
  });
```

- [ ] **Step 5 : Run les tests de conditions (PASS)**

Run (working_directory `editor`): `npx vitest run src/features/export/transform.test.ts -t "appearance conditions"`
Expected : PASS.

- [ ] **Step 6 : Commit**

```bash
git add editor/src/features/export/transform.ts editor/src/features/export/transform.test.ts
git commit -m "feat(export): canonical conditions (of) + if as array"
```

---

### Task 3 : Title toujours en tableau de layers

**Files:**
- Modify: `editor/src/features/export/transform.ts`
- Modify: `editor/src/features/export/transform.test.ts`

- [ ] **Step 1 : Retirer le raccourci plain-only string dans `serializeMenu`**

Dans `serializeMenu`, remplacer le calcul `plainOnly`/`titleField` et la construction de `out` par :
```ts
  const out: Record<string, unknown> = {
    schema: "menu/v1",
    id: menu.id,
    title: menu.title.map(serializeTitleLayer),
    size: menu.rows * 9,
    layers: menu.layers.map((l) => serializeLayer(l, pack)),
  };
```
(Supprimer les lignes `const plainOnly = ...` et `const titleField = ...`. L'import `i18nRef` reste utilisé ailleurs — ne pas le retirer.)

- [ ] **Step 2 : Test — plain-only titre émis en tableau**

Dans `transform.test.ts`, ajouter dans `describe("transform — title layers")` :
```ts
  it("emits a plain-only title as a one-layer array (no legacy string shortcut)", () => {
    const files = transform(menuWithTitle([{ kind: "plain", value: { key: "k_plain" as I18nKey } }]));
    const menu = parse(files["plugins/Artisan/packs/p_test/menus/shop.yaml"]!);
    expect(Array.isArray(menu.title)).toBe(true);
    expect(menu.title).toEqual([{ kind: "plain", value: { key: "k_plain" } }]);
  });
```

- [ ] **Step 3 : Run (PASS)**

Run (working_directory `editor`): `npx vitest run src/features/export/transform.test.ts -t "title layers"`
Expected : PASS (anciens tests title-array inchangés + le nouveau).

- [ ] **Step 4 : Commit**

```bash
git add editor/src/features/export/transform.ts editor/src/features/export/transform.test.ts
git commit -m "feat(export): title always emitted as a layer array (drop plain-only string)"
```

---

### Task 4 : `paginate` → `pagination_next`/`pagination_prev`

**Files:**
- Modify: `editor/src/features/export/transform.ts`
- Modify: `editor/src/features/export/transform.test.ts`

- [ ] **Step 1 : Corriger le case `paginate` de `serializeAction`**

Remplacer le `case "paginate":` par :
```ts
    case "paginate": {
      const type = action.direction === "next" ? "pagination_next" : "pagination_prev";
      const out: Record<string, unknown> = { type };
      if (action.targetElementId) out.element_id = action.targetElementId;
      return out;
    }
```

- [ ] **Step 2 : Test**

Dans `transform.test.ts`, ajouter (dans le premier `describe("transform")`) :
```ts
  it("serializes paginate to pagination_next/prev with element_id", () => {
    const pack = makePack({
      i18nKeys: { "menus.shop.title": { en: "Shop" } } as Pack["i18nKeys"],
      menus: [{
        id: menuId("shop"), packId: packId("p_test"), rows: 3,
        title: [{ kind: "text", value: { key: "menus.shop.title" as I18nKey }, x: 8, y: 5 }],
        layers: [{ id: layerId("l1"), name: "default", elements: [{
          id: elementId("nav"), positions: "0",
          appearances: [{ click: { left: { steps: [
            { kind: "action", action: { type: "paginate", direction: "next" } },
            { kind: "action", action: { type: "paginate", direction: "prev", targetElementId: elementId("grid") } },
          ] } } }],
        }] }],
      }],
    });
    const files = transform(pack);
    const menu = parse(files["plugins/Artisan/packs/p_test/menus/shop.yaml"]!);
    const steps = menu.layers[0].elements[0].appearances[0].click.left.steps;
    expect(steps[0].action).toEqual({ type: "pagination_next" });
    expect(steps[1].action).toEqual({ type: "pagination_prev", element_id: "grid" });
  });
```

- [ ] **Step 3 : Run (PASS)**

Run (working_directory `editor`): `npx vitest run src/features/export/transform.test.ts -t "pagination_next"`
Expected : PASS.

- [ ] **Step 4 : Commit**

```bash
git add editor/src/features/export/transform.ts editor/src/features/export/transform.test.ts
git commit -m "feat(export): paginate -> pagination_next/prev (canonical)"
```

---

### Task 5 : Oracle vert + suite export complète

**Files:** (aucun nouveau — vérification)

- [ ] **Step 1 : Oracle golden (PASS)**

Run (working_directory `editor`): `npx vitest run src/features/export/canonical.test.ts`
Expected : PASS — l'export valide désormais contre le schéma canonique.

- [ ] **Step 2 : Toute la suite export**

Run (working_directory `editor`): `npx vitest run src/features/export`
Expected : PASS. Si un test pré-existant casse à cause de la forme canonique, le mettre à jour vers la forme attendue (et seulement ça). Ne pas modifier `transform.ts` pour re-coller à l'ancienne forme.

- [ ] **Step 3 : Commit (si des tests ont dû être ajustés)**

```bash
git add editor/src/features/export
git commit -m "test(export): align remaining export tests to canonical menu/v1"
```

---

### Task 6 : Aligner le miroir de types `docs/schema/menu/v1/types.ts`

But : `types.ts` est le miroir TS écrit à la main du schéma (consommé par de futurs lecteurs + la feature IA). Le rendre conforme au `schema.json` canonique.

**Files:**
- Modify: `docs/schema/menu/v1/types.ts`

- [ ] **Step 1 : Aligner les types sur le schéma canonique**

Appliquer ces changements (miroir exact de `docs/schema/menu/v1/schema.json`) :
1. `Menu.title: string` → `title: MenuTitleLayer[]`.
2. Ajouter les types :
```ts
export interface LText { key: string; }
export type MenuTitleLayer =
  | { kind: "background"; asset_id: string }
  | { kind: "glyph"; asset_id: string; x: number; y: number }
  | { kind: "text"; value: LText; x: number; y: number; color?: string; font_asset_id?: string; size?: 8 | 12 | 16 | 20 | 24 | 32 }
  | { kind: "plain"; value: LText; color?: string }
  | { kind: "textarea"; value: LText; x: number; y: number; width: number; line_height: number; alignment: "left" | "center" | "right"; font_asset_id?: string; size?: 8 | 12 | 16 | 20 | 24 | 32 }
  | { kind: "external_glyph"; provider: "oraxen" | "nexo" | "itemsadder"; glyph_name: string; x: number; y: number };
```
3. `Menu.contextInputs` → `context_inputs` (si présent).
4. Remplacer `ClickMap`/`ClickHandler`/`StandardClick`/`ComponentClick`/`Cooldown` par :
```ts
export interface ClickMap { left?: ClickHandler; right?: ClickHandler; shift_left?: ClickHandler; shift_right?: ClickHandler; middle?: ClickHandler; }
export interface ClickHandler { steps: Step[]; }
export type Step =
  | { kind: "action"; action: Action }
  | { kind: "if"; cases: { conditions: Condition[]; joins?: ("and" | "or")[]; steps: Step[] }[]; else?: Step[] };
```
5. `Appearance.click?: ClickMap | null;` (déjà ~le cas) ; `Appearance.if?: Condition[];` (déjà array).
6. Ajouter au union `Action` : `show_title`, `open_dialog`, `close_dialog`, `set_arg`, `set_arg_cycle_next`, `set_arg_cycle_prev` (champs miroir du schéma : `show_title { title: string; subtitle?: string; fade_in?: number; stay?: number; fade_out?: number }`, etc.).
7. Ajouter au union `Condition` : `{ type: "expression"; expr: string }`.
8. Retirer les `ACTION_TYPES`/`CONDITION_TYPES`/`isComponentClick` obsolètes ou les aligner (supprimer `isComponentClick` ; mettre à jour les listes de types si conservées).

- [ ] **Step 2 : Vérifier que le fichier compile isolément**

Run (working_directory racine): `npx tsc --noEmit --strict docs/schema/menu/v1/types.ts`
Expected : pas d'erreur dans `types.ts` (ignorer d'éventuels warnings de config ; le fichier ne doit pas référencer `StandardClick`/`ComponentClick`/`Cooldown`).

Run: `node -e "const s=require('fs').readFileSync('docs/schema/menu/v1/types.ts','utf8'); for(const t of ['StandardClick','ComponentClick','isComponentClick']){ if(s.includes(t)) throw new Error('stale ref: '+t);} console.log('clean')"`
Expected : `clean`.

- [ ] **Step 3 : Commit**

```bash
git add docs/schema/menu/v1/types.ts
git commit -m "refactor(schema): align hand-written menu/v1 types.ts mirror to canonical"
```

---

### Task 7 : Docs

**Files:**
- Modify: `docs/architecture/schemas-codegen.md` (statut P1.1)
- Modify: `CHANGELOG.md` (`[Unreleased]`)
- Modify: `docs/architecture/editor-internals.md` (note export canonique) si une section export existe ; sinon ignorer ce fichier.

- [ ] **Step 1 : MAJ docs**

- `schemas-codegen.md` : marquer **P1.1 ✅** (export éditeur conforme + types.ts aligné + oracle ajv).
- `CHANGELOG.md` `[Unreleased]` : export éditeur émet `menu/v1` canonique (conditions `of`, `if` array, title array, `paginate`→`pagination_*`) ; oracle de conformité ajv ; `types.ts` aligné.
- `editor-internals.md` : si une section décrit l'export, ajouter une phrase « l'export émet la forme canonique `menu/v1` validée par `validateMenuV1` ».

- [ ] **Step 2 : Commit**

```bash
git add docs/architecture/schemas-codegen.md CHANGELOG.md docs/architecture/editor-internals.md
git commit -m "docs(schema): P1.1 — editor export emits canonical menu/v1"
```

---

## Self-review

- **Couverture** : oracle golden (T1/T5), conditions `of`+array (T2), title array (T3), `paginate`→`pagination_*` (T4), miroir types (T6), docs (T7). ✓
- **Déjà conformes (pas de tâche)** : `show_title`/`open_dialog`/`close_dialog`/`set_arg*` et `context_inputs` snake — `transform.ts` les émet déjà au bon format ; l'oracle T5 le confirme. ✓
- **Limite assumée** : `serializeIfArray` garde la sémantique « un seul join gouverne la liste » (comme l'ancien `collapseConditions`) — le and/or mixte à précédence fine n'est pas introduit ici (inchangé vs avant). ✓
- **Pas de régression plugin** : le plugin lit déjà `of` (ConditionParser) et un `if` tableau-ou-map, et un title tableau-ou-string → l'export canonique reste lisible par le plugin. (La conformité plugin formelle = P1.2.)
- **Cohérence des noms** : `serializeIfArray`, `validateMenuV1`, `canonical.test.ts`. ✓

## Suite

- **P1.2 — conformité plugin** : remplacer les DTO Jackson à la main par des `sealed class` Kotlin écrites à la main conformes au schéma ; `ConditionParser` déjà en `of` ; décider du sort du modèle de clic plat ; fixtures partagées validées ajv + parsées en Kotlin (round-trip cross-stack).
- **P2** : command/dialog/translations/manifest/template (même patron).
- Puis **dé-parquer la feature IA** : l'oracle export↔ajv + le contrat canonique donnent au convertisseur `menu/v1 → domain` une cible stable et un harnais de test.
