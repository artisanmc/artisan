# Canonicalisation P1.0 — menu/v1 : schéma canonique + ajv + spike codegen

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire de `docs/schema/menu/v1/schema.json` la définition canonique honnête d'un menu, la rendre validable par `ajv`, vérifier que **quicktype** génère des types exploitables (Kotlin + TS), et câbler la génération — **sans** toucher l'export éditeur ni le parseur plugin (ce sera P1.1 / P1.2).

**Architecture:** Le `schema.json` (JSON Schema 2020-12) devient la source de vérité. Un validateur `ajv` (côté éditeur, réutilisable par la future feature IA) valide des **exemples canoniques authored**. Un spike quicktype valide la qualité des `sealed class` Kotlin sur nos unions discriminées, puis un script `schema:gen` génère types TS + Kotlin avec un drift-check en CI. Les conditions sont déjà canoniques dans le schéma actuel ; les deltas portent sur `title`, `click`, `context_inputs` et l'ajout de quelques actions + la condition `expression`.

**Tech Stack:** JSON Schema 2020-12, `ajv` + `ajv-formats` (éditeur, vitest), `quicktype` (CLI via npx), Node script de génération, GitHub Actions (introduit ici).

---

## Décisions de réconciliation encodées par cette P1.0

Chaque ligne = une micro-décision explicite (le reste de la réconciliation vocab plugin↔éditeur arrive en P1.1/P1.2) :

| Sujet | Décision canonique | Conséquence |
|---|---|---|
| Conditions `and`/`or`/`not` | `of` partout (déjà dans le schéma) | l'export éditeur (`all`/`any`/collapsé) devra se conformer en **P1.1** |
| `if` d'appearance | toujours un tableau `Condition[]` (déjà dans le schéma) | export éditeur (collapse en map) → conforme en **P1.1** |
| `title` | **toujours** un tableau de `MenuTitleLayer` (on retire le raccourci string) | export éditeur (raccourci `{i18n:}` string plain-only) → conforme en **P1.1** |
| `click` | `{ steps: Step[] }` (step-tree `action`/`if`) | on retire `StandardClick`/`ComponentClick` (modèle plat `actions/requirements/fallback/cooldown/component`) du canonique ; sa réintégration éventuelle = décision **P1.2** |
| `context_inputs` | snake_case (était `contextInputs`) | aligné sur l'export |
| `paginate` (éditeur) vs `pagination_next`/`pagination_prev` (plugin/schéma) | canonique = **`pagination_next`/`pagination_prev`** | l'export éditeur migre `paginate{direction}` → `pagination_*` en **P1.1** |
| `set_arg`, `set_arg_cycle_next/prev` | inclus (constructs éditeur) | **gap runtime plugin** documenté (le plugin ne les exécute pas) |
| `expression` (condition DSL) | incluse (construct éditeur) | **gap runtime plugin** documenté |
| `show_title`, `open_dialog`, `close_dialog` | inclus | exécutés par le plugin ; manquaient au schéma |
| Valeur i18n des title-layers (`value: {key}`) | conservée telle quelle (≠ convention `{i18n:}` des autres champs) | harmonisation = cleanup futur documenté |

Gaps runtime documentés (hors P1, projets séparés) : exécution des branches `if` de clic côté plugin ; `context_inputs`/itération ; évaluation `expression`/`set_arg*`.

---

### Task 1 : Spike quicktype (porte de décision)

But : vérifier que quicktype produit des `sealed class` Kotlin propres sur une union discriminée par `type` (le point dur), **avant** de s'engager. Utilise le `schema.json` actuel (qui a déjà des `oneOf` `Condition`/`Action`).

**Files:**
- Create: `docs/schema/CODEGEN.md` (note de décision)
- Temp: `/tmp/qt-out.kt`, `/tmp/qt-out.ts` (jetables)

- [ ] **Step 1 : Générer Kotlin depuis le schéma actuel**

Run:
```bash
cd C:/Users/ibane/Documents/Minecraft/Plugins/Artisan
npx -y quicktype --src docs/schema/menu/v1/schema.json --src-lang schema --lang kotlin --framework jackson --package net.artisanmc.plugin.schema.menu -o /tmp/qt-out.kt
```
Expected : un fichier Kotlin est produit sans erreur.

- [ ] **Step 2 : Inspecter la sortie Kotlin sur les unions**

Ouvrir `/tmp/qt-out.kt` et vérifier les critères d'acceptation :
- `Condition` et `Action` sont des `sealed class` (ou une classe avec discriminant `type` exploitable), pas un `Map<String, Any>` opaque ;
- les variantes (`HasPermission`, `OpenMenu`, …) sont des sous-types typés ;
- Jackson polymorphic deserialization est gérable (annotations `@JsonTypeInfo`/`@JsonSubTypes` présentes ou ajoutables).

- [ ] **Step 3 : Générer TS et l'inspecter**

Run:
```bash
npx -y quicktype --src docs/schema/menu/v1/schema.json --src-lang schema --lang typescript --just-types --prefer-unions --prefer-const-values -o /tmp/qt-out.ts
```
Expected : unions discriminées TS (`type Condition = HasPermission | HasMoney | ...`) avec `type` littéral.

- [ ] **Step 4 : Décision + note**

Écrire `docs/schema/CODEGEN.md` : la commande quicktype validée (flags), un verdict GO/NO-GO, et si NO-GO le fallback (types Kotlin écrits à la main + test de drift ajv sur fixtures plutôt que codegen). **Ne pas continuer la P1.0 sur quicktype si NO-GO** — revenir vers l'utilisateur.

Contenu minimal :
```markdown
# Codegen des schémas (quicktype)

Source de vérité : `docs/schema/<name>/v1/schema.json`.

Commande Kotlin (plugin) :
`npx quicktype --src <schema.json> --src-lang schema --lang kotlin --framework jackson --package <pkg> -o <out.kt>`

Commande TS (éditeur) :
`npx quicktype --src <schema.json> --src-lang schema --lang typescript --just-types --prefer-unions --prefer-const-values -o <out.ts>`

Verdict spike 2026-06-08 : GO / NO-GO (+ raison).
```

- [ ] **Step 5 : Commit**

```bash
git add docs/schema/CODEGEN.md
git commit -m "chore(schema): quicktype codegen spike + decision note"
```

---

### Task 2 : Réécrire `menu/v1/schema.json` en forme canonique

Édits ciblés sur le schéma existant. Après chaque groupe d'édits, le JSON doit rester parsable.

**Files:**
- Modify: `docs/schema/menu/v1/schema.json`

- [ ] **Step 1 : `title` → tableau de MenuTitleLayer**

Remplacer le bloc `"title": { "type": "string", ... }` (propriété top-level) par :
```json
    "title": {
      "type": "array",
      "items": { "$ref": "#/$defs/MenuTitleLayer" },
      "description": "Couches de titre, ordonnées. Vide = pas de titre. Format pixel-perfect (offsets, fonts) documenté dans editor-internals.md."
    },
```

- [ ] **Step 2 : `contextInputs` → `context_inputs`**

Renommer la propriété top-level `"contextInputs"` en `"context_inputs"` (garder le `$ref`/description).

- [ ] **Step 3 : `Appearance.click` → step-tree**

Dans `$defs.Appearance.properties.click`, remplacer le `oneOf` actuel par :
```json
        "click": {
          "oneOf": [
            { "$ref": "#/$defs/ClickMap" },
            { "type": "null" }
          ]
        },
```
puis remplacer entièrement les `$defs` `ClickMap`, `ClickHandler`, `StandardClick`, `ComponentClick`, `Cooldown` par :
```json
    "ClickMap": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "left":        { "$ref": "#/$defs/ClickHandler" },
        "right":       { "$ref": "#/$defs/ClickHandler" },
        "shift_left":  { "$ref": "#/$defs/ClickHandler" },
        "shift_right": { "$ref": "#/$defs/ClickHandler" },
        "middle":      { "$ref": "#/$defs/ClickHandler" }
      }
    },
    "ClickHandler": {
      "type": "object",
      "additionalProperties": false,
      "required": ["steps"],
      "properties": {
        "steps": { "type": "array", "items": { "$ref": "#/$defs/Step" } }
      }
    },
    "Step": {
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["kind", "action"],
          "properties": {
            "kind": { "const": "action" },
            "action": { "$ref": "#/$defs/Action" }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["kind", "cases"],
          "properties": {
            "kind": { "const": "if" },
            "cases": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": ["conditions", "steps"],
                "properties": {
                  "conditions": { "type": "array", "items": { "$ref": "#/$defs/Condition" } },
                  "joins": { "type": "array", "items": { "type": "string", "enum": ["and", "or"] } },
                  "steps": { "type": "array", "items": { "$ref": "#/$defs/Step" } }
                }
              }
            },
            "else": { "type": "array", "items": { "$ref": "#/$defs/Step" } }
          }
        }
      ]
    },
```
(Note : `Cooldown` n'est plus référencé — le supprimer de `$defs`.)

- [ ] **Step 4 : Ajouter le `$def` `MenuTitleLayer` + `LText`**

Ajouter dans `$defs` :
```json
    "LText": {
      "type": "object",
      "additionalProperties": false,
      "required": ["key"],
      "properties": { "key": { "type": "string" } },
      "description": "Référence i18n. La valeur résolue vit dans lang/<lang>.yaml. (Note: les title-layers utilisent cette forme {key} ; les autres champs texte utilisent la string {i18n:key} — harmonisation future.)"
    },
    "MenuTitleLayer": {
      "oneOf": [
        { "type": "object", "additionalProperties": false, "required": ["kind", "asset_id"], "properties": { "kind": { "const": "background" }, "asset_id": { "type": "string" } } },
        { "type": "object", "additionalProperties": false, "required": ["kind", "asset_id", "x", "y"], "properties": { "kind": { "const": "glyph" }, "asset_id": { "type": "string" }, "x": { "type": "integer" }, "y": { "type": "integer" } } },
        { "type": "object", "additionalProperties": false, "required": ["kind", "value", "x", "y"], "properties": { "kind": { "const": "text" }, "value": { "$ref": "#/$defs/LText" }, "x": { "type": "integer" }, "y": { "type": "integer" }, "color": { "type": "string" }, "font_asset_id": { "type": "string" }, "size": { "type": "integer", "enum": [8, 12, 16, 20, 24, 32] } } },
        { "type": "object", "additionalProperties": false, "required": ["kind", "value"], "properties": { "kind": { "const": "plain" }, "value": { "$ref": "#/$defs/LText" }, "color": { "type": "string" } } },
        { "type": "object", "additionalProperties": false, "required": ["kind", "value", "x", "y", "width", "line_height", "alignment"], "properties": { "kind": { "const": "textarea" }, "value": { "$ref": "#/$defs/LText" }, "x": { "type": "integer" }, "y": { "type": "integer" }, "width": { "type": "integer" }, "line_height": { "type": "integer" }, "alignment": { "type": "string", "enum": ["left", "center", "right"] }, "font_asset_id": { "type": "string" }, "size": { "type": "integer", "enum": [8, 12, 16, 20, 24, 32] } } },
        { "type": "object", "additionalProperties": false, "required": ["kind", "provider", "glyph_name", "x", "y"], "properties": { "kind": { "const": "external_glyph" }, "provider": { "type": "string", "enum": ["oraxen", "nexo", "itemsadder"] }, "glyph_name": { "type": "string" }, "x": { "type": "integer" }, "y": { "type": "integer" } } }
      ]
    },
```

- [ ] **Step 5 : Ajouter les actions manquantes au `$defs.Action.oneOf`**

Ajouter ces entrées au tableau `oneOf` de `Action` :
```json
        { "additionalProperties": false, "required": ["type", "title"], "properties": { "type": { "const": "show_title" }, "title": { "type": "string" }, "subtitle": { "type": "string" }, "fade_in": { "type": "integer", "minimum": 0 }, "stay": { "type": "integer", "minimum": 0 }, "fade_out": { "type": "integer", "minimum": 0 } } },
        { "additionalProperties": false, "required": ["type", "dialog_id"], "properties": { "type": { "const": "open_dialog" }, "dialog_id": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$" }, "context": { "type": "object", "additionalProperties": { "type": "string" } }, "clear_context": { "type": "boolean", "default": false } } },
        { "additionalProperties": false, "required": ["type"], "properties": { "type": { "const": "close_dialog" } } },
        { "additionalProperties": false, "required": ["type", "arg", "value"], "properties": { "type": { "const": "set_arg" }, "arg": { "type": "string" }, "value": { "type": "string" } } },
        { "additionalProperties": false, "required": ["type", "arg", "list"], "properties": { "type": { "const": "set_arg_cycle_next" }, "arg": { "type": "string" }, "list": { "type": "string" } } },
        { "additionalProperties": false, "required": ["type", "arg", "list"], "properties": { "type": { "const": "set_arg_cycle_prev" }, "arg": { "type": "string" }, "list": { "type": "string" } } }
```

- [ ] **Step 6 : Ajouter la condition `expression` au `$defs.Condition.oneOf`**

Ajouter :
```json
        { "additionalProperties": false, "required": ["type", "expr"], "properties": { "type": { "const": "expression" }, "expr": { "type": "string" } } }
```

- [ ] **Step 7 : Vérifier que le JSON parse**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('docs/schema/menu/v1/schema.json','utf8')); console.log('OK')"
```
Expected : `OK`.

- [ ] **Step 8 : Commit**

```bash
git add docs/schema/menu/v1/schema.json
git commit -m "feat(schema): canonical menu/v1 — title array, click step-tree, context_inputs, +actions/expression"
```

---

### Task 3 : Validateur ajv + exemples canoniques (TDD)

But : un validateur réutilisable + des exemples canoniques qui valident (vert). Vit côté éditeur (réutilisé plus tard par le gate IA).

**Files:**
- Modify: `editor/package.json` (devDeps `ajv`, `ajv-formats`)
- Create: `editor/src/schema/validateMenuV1.ts`
- Create: `editor/src/schema/validateMenuV1.test.ts`
- Create: `docs/schema/menu/v1/examples/canonical-button.json`
- Create: `docs/schema/menu/v1/examples/canonical-conditional.json`

- [ ] **Step 1 : Installer ajv**

Run (working_directory `editor`):
```bash
npm install -D ajv ajv-formats
```
Expected : ajv + ajv-formats ajoutés à devDependencies.

- [ ] **Step 2 : Écrire le test (RED)**

`editor/src/schema/validateMenuV1.test.ts` :
```ts
import { describe, expect, it } from "vitest";
import canonicalButton from "../../../docs/schema/menu/v1/examples/canonical-button.json";
import canonicalConditional from "../../../docs/schema/menu/v1/examples/canonical-conditional.json";
import { validateMenuV1 } from "./validateMenuV1";

describe("validateMenuV1", () => {
  it("accepts the canonical button example", () => {
    const r = validateMenuV1(canonicalButton);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("accepts the canonical conditional example", () => {
    expect(validateMenuV1(canonicalConditional).valid).toBe(true);
  });

  it("rejects a menu with a bad size", () => {
    const bad = { ...(canonicalButton as object), size: 13 };
    const r = validateMenuV1(bad);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/size/);
  });

  it("rejects a string title (legacy form is no longer canonical)", () => {
    const bad = { ...(canonicalButton as object), title: "Shop" };
    expect(validateMenuV1(bad).valid).toBe(false);
  });

  it("rejects a click with flat actions instead of steps", () => {
    const bad = JSON.parse(JSON.stringify(canonicalButton));
    bad.layers[0].elements[0].appearances[0].click.left = { actions: [] };
    expect(validateMenuV1(bad).valid).toBe(false);
  });
});
```

- [ ] **Step 3 : Run le test (FAIL)**

Run (working_directory `editor`): `npx vitest run src/schema/validateMenuV1.test.ts`
Expected : FAIL — `validateMenuV1` / les exemples n'existent pas encore.

- [ ] **Step 4 : Écrire le validateur**

`editor/src/schema/validateMenuV1.ts` :
```ts
import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "../../../docs/schema/menu/v1/schema.json";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateFn = ajv.compile(schema);

export interface MenuV1ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Validate an object against the canonical menu/v1 JSON Schema. */
export function validateMenuV1(menu: unknown): MenuV1ValidationResult {
  const valid = validateFn(menu) as boolean;
  const errors = (validateFn.errors ?? []).map(
    (e: ErrorObject) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim(),
  );
  return { valid, errors };
}
```

- [ ] **Step 5 : Écrire les exemples canoniques**

`docs/schema/menu/v1/examples/canonical-button.json` :
```json
{
  "schema": "menu/v1",
  "id": "shop",
  "title": [{ "kind": "plain", "value": { "key": "menus.shop.title" } }],
  "size": 27,
  "layers": [
    {
      "id": "main",
      "name": "default",
      "elements": [
        {
          "id": "buy_btn",
          "positions": "13",
          "appearances": [
            {
              "material": "DIAMOND",
              "title": "{i18n:menus.shop.buy.title}",
              "lore": ["{i18n:menus.shop.buy.lore}"],
              "click": {
                "left": {
                  "steps": [
                    { "kind": "action", "action": { "type": "run_command", "command": "buy diamond", "as": "player" } },
                    { "kind": "action", "action": { "type": "send_message", "text": "{i18n:menus.shop.buy.msg}" } }
                  ]
                }
              }
            }
          ]
        }
      ]
    }
  ]
}
```

`docs/schema/menu/v1/examples/canonical-conditional.json` :
```json
{
  "schema": "menu/v1",
  "id": "vip",
  "title": [
    { "kind": "background", "asset_id": "asset_bg1" },
    { "kind": "text", "value": { "key": "menus.vip.title" }, "x": 8, "y": 5, "color": "#FFAA00" }
  ],
  "size": 54,
  "permission": "artisan.vip",
  "layers": [
    {
      "id": "items",
      "name": "items",
      "elements": [
        {
          "id": "vip_slot",
          "positions": "0-8",
          "appearances": [
            {
              "if": [{ "type": "has_permission", "perm": "artisan.vip.gold" }],
              "material": "GOLD_INGOT",
              "title": "VIP Gold",
              "click": {
                "left": {
                  "steps": [
                    {
                      "kind": "if",
                      "cases": [
                        {
                          "conditions": [{ "type": "has_money", "amount": 100 }],
                          "steps": [{ "kind": "action", "action": { "type": "take_money", "amount": 100 } }]
                        }
                      ],
                      "else": [{ "kind": "action", "action": { "type": "send_message", "text": "Not enough money" } }]
                    }
                  ]
                }
              }
            },
            { "material": "STONE", "title": "Locked" }
          ]
        }
      ]
    }
  ]
}
```

- [ ] **Step 6 : Run le test (PASS)**

Run (working_directory `editor`): `npx vitest run src/schema/validateMenuV1.test.ts`
Expected : PASS (5 tests).

- [ ] **Step 7 : Vérifier que le tsconfig autorise l'import JSON hors `editor/`**

Si le test échoue à l'import de `../../../docs/...`, vérifier `editor/tsconfig*.json` : `resolveJsonModule: true` (déjà attendu) et que `rootDir`/`include` n'excluent pas le chemin relatif (vite/vitest résout par chemin réel, pas par alias). Si bloqué, ajouter `../docs/schema/**/*.json` à `include` du tsconfig de l'app. Re-run le test.

- [ ] **Step 8 : Commit**

```bash
git add editor/package.json editor/package-lock.json editor/src/schema/validateMenuV1.ts editor/src/schema/validateMenuV1.test.ts docs/schema/menu/v1/examples/canonical-button.json docs/schema/menu/v1/examples/canonical-conditional.json
git commit -m "feat(schema): ajv validator for canonical menu/v1 + canonical examples"
```

---

### Task 4 : Câbler `schema:gen` (quicktype → TS + Kotlin)

But : un script qui génère les types depuis `schema.json` + un drift-check. (P1.0 : on génère et on **commit** les fichiers générés ; leur *consommation* par l'éditeur/plugin = P1.1/P1.2.)

**Files:**
- Create: `tools/schema-gen.mjs`
- Modify: `editor/package.json` (script `schema:gen` + devDep `quicktype`)
- Generated: `editor/src/schema/menu/v1.gen.ts`
- Generated: `plugin/src/main/kotlin/net/artisanmc/plugin/schema/menu/MenuV1.gen.kt`

- [ ] **Step 1 : Ajouter quicktype en devDep**

Run (working_directory `editor`): `npm install -D quicktype`

- [ ] **Step 2 : Écrire le script de génération**

`tools/schema-gen.mjs` (exécuté depuis la racine repo) :
```js
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// (schemaPath, tsOut, ktOut, ktPackage)
const targets = [
  [
    "docs/schema/menu/v1/schema.json",
    "editor/src/schema/menu/v1.gen.ts",
    "plugin/src/main/kotlin/net/artisanmc/plugin/schema/menu/MenuV1.gen.kt",
    "net.artisanmc.plugin.schema.menu",
  ],
];

const qt = (args) =>
  execFileSync("npx", ["--yes", "quicktype", ...args], { stdio: "inherit", cwd: process.cwd() });

for (const [schemaPath, tsOut, ktOut, ktPkg] of targets) {
  mkdirSync(dirname(tsOut), { recursive: true });
  mkdirSync(dirname(ktOut), { recursive: true });
  qt(["--src", schemaPath, "--src-lang", "schema", "--lang", "typescript",
      "--just-types", "--prefer-unions", "--prefer-const-values", "-o", tsOut]);
  qt(["--src", schemaPath, "--src-lang", "schema", "--lang", "kotlin",
      "--framework", "jackson", "--package", ktPkg, "-o", ktOut]);
  console.log(`generated ${tsOut} + ${ktOut}`);
}
```

- [ ] **Step 3 : Ajouter le script npm**

Dans `editor/package.json` `scripts`, ajouter :
```json
    "schema:gen": "node ../tools/schema-gen.mjs"
```

- [ ] **Step 4 : Générer**

Run (working_directory `editor`): `npm run schema:gen`
Expected : `editor/src/schema/menu/v1.gen.ts` et `plugin/.../MenuV1.gen.kt` créés. (Contenu = sortie quicktype, déterministe — ne pas l'éditer à la main.)

- [ ] **Step 5 : Vérifier l'idempotence (drift-check local)**

Run (working_directory `editor`):
```bash
npm run schema:gen
git diff --exit-code editor/src/schema/menu/v1.gen.ts plugin/src/main/kotlin/net/artisanmc/plugin/schema/menu/MenuV1.gen.kt
```
Expected : exit 0 (aucun diff après regénération).

- [ ] **Step 6 : Commit**

```bash
git add tools/schema-gen.mjs editor/package.json editor/package-lock.json editor/src/schema/menu/v1.gen.ts plugin/src/main/kotlin/net/artisanmc/plugin/schema/menu/MenuV1.gen.kt
git commit -m "feat(schema): schema:gen wiring (quicktype) + generated menu/v1 TS+Kotlin types"
```

---

### Task 5 : CI anti-dérive (GitHub Actions — introduit ici)

But : empêcher la redérive. CI minimale P1.0 : drift codegen + ajv. (Le drift Kotlin/JVM s'ajoutera quand le plugin consommera le généré en P1.2.)

**Files:**
- Create: `.github/workflows/schema.yml`

- [ ] **Step 1 : Écrire le workflow**

`.github/workflows/schema.yml` :
```yaml
name: schema
on:
  push: { branches: [main] }
  pull_request:
jobs:
  schema:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22" }
      - name: install editor deps
        working-directory: editor
        run: npm ci
      - name: codegen drift
        working-directory: editor
        run: |
          npm run schema:gen
          git diff --exit-code editor/src/schema plugin/src/main/kotlin/net/artisanmc/plugin/schema
      - name: ajv validation
        working-directory: editor
        run: npx vitest run src/schema/validateMenuV1.test.ts
```

- [ ] **Step 2 : Vérifier localement les commandes du job**

Run (working_directory `editor`): `npm ci && npm run schema:gen && git diff --exit-code editor/src/schema plugin/src/main/kotlin/net/artisanmc/plugin/schema && npx vitest run src/schema/validateMenuV1.test.ts`
Expected : tout vert, exit 0.

- [ ] **Step 3 : Commit**

```bash
git add .github/workflows/schema.yml
git commit -m "ci(schema): drift-check codegen + ajv validation on PR"
```

---

### Task 6 : Docs

**Files:**
- Create: `docs/architecture/schemas-codegen.md`
- Modify: `CLAUDE.md` (commande + règle)
- Modify: `CHANGELOG.md` (`[Unreleased]`)

- [ ] **Step 1 : Doc d'architecture**

`docs/architecture/schemas-codegen.md` : source de vérité = `docs/schema/<name>/v1/schema.json` ; pipeline `npm run schema:gen` (quicktype → TS éditeur + Kotlin plugin) ; CI drift + ajv ; règle « modifier un schéma = regen + commit du généré » ; **gaps runtime documentés** (branches if de clic, `context_inputs`/itération, `expression`, `set_arg*` non exécutés par le plugin) ; statut : P1.0 = menu (schéma + ajv + codegen) ; P1.1 = conformité éditeur ; P1.2 = conformité plugin ; P2 = autres schémas.

- [ ] **Step 2 : CLAUDE.md**

Ajouter dans la section commandes (Editor) : `npm run schema:gen` — régénère les types depuis `docs/schema/*/v1/schema.json`. Ajouter dans le tableau de mise à jour des docs : « Tu touches `docs/schema/*/v1/schema.json` → `npm run schema:gen` + commit le généré + `docs/architecture/schemas-codegen.md` ».

- [ ] **Step 3 : CHANGELOG**

Sous `[Unreleased]` : `menu/v1` canonicalisé (title array, click step-tree, context_inputs snake_case, +show_title/open_dialog/close_dialog/set_arg*/expression) ; validateur ajv ; codegen quicktype TS+Kotlin ; CI drift.

- [ ] **Step 4 : Commit**

```bash
git add docs/architecture/schemas-codegen.md CLAUDE.md CHANGELOG.md
git commit -m "docs(schema): canonicalization P1.0 — codegen pipeline, rule, changelog"
```

---

## Self-review (rempli pendant l'écriture)

- **Couverture spec P1.0** : schema canonique (T2), ajv (T3), spike quicktype (T1), wiring codegen (T4), CI anti-dérive (T5), docs (T6). ✓
- **Pas de conformité éditeur/plugin ici** : volontaire — T2 retire des formes que l'export éditeur émet encore (string title, `paginate`, `all`/`any`, collapse if), donc **valider l'export éditeur contre ce schéma échouerait** : c'est l'objet de **P1.1**. P1.0 ne valide que des exemples canoniques authored (verts).
- **Types générés non consommés** : volontaire — la consommation est P1.1 (TS) / P1.2 (Kotlin). Ici on génère + commit + drift-check seulement.
- **Dépendance spike** : T1 est une porte ; si NO-GO, suivre le fallback de `CODEGEN.md` et revenir vers l'utilisateur avant T4.
- **Cohérence des noms** : `validateMenuV1`, `schema:gen`, `v1.gen.ts`, `MenuV1.gen.kt` utilisés de façon cohérente entre tâches. ✓

## Suite (hors P1.0)

- **P1.1 — conformité éditeur** : `transform.ts` émet la forme canonique (title toujours array, conditions `of`/tableau, `paginate`→`pagination_*`) ; l'éditeur consomme `v1.gen.ts` ; test « export d'un pack golden valide contre `schema.json` » (RED→GREEN).
- **P1.2 — conformité plugin** : remplacer les DTO Jackson à la main par `MenuV1.gen.kt` ; `ConditionParser` `all`/`any`→`of` ; décision sur le modèle de clic plat (StandardClick) ; drift Kotlin en CI.
- **P2** : command/dialog/translations/manifest/template — même patron.
