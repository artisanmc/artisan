# Assistant — Commands & Dialogs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner à l'assistant IA un CRUD complet sur les commandes et les dialogs (miroir exact du pipeline menu), pour qu'il puisse migrer une config zMenu/DeluxeMenus en entier (menus + commandes + dialogs).

**Architecture:** Backend — nouveaux tools `*_command` / `*_dialog`, `WorkingCopy` étendue, `validate.ts` ajv+vocab pour command/v1 & dialog/v1, 2 fiches de grounding. Éditeur — convertisseurs wire→domaine `commandV1ToDomain`/`dialogV1ToDomain` (réutilisant un convertisseur d'action extrait), actions store `applyAssistant*`, sérialisation pour l'envoi, wiring `AssistantChat`. On réconcilie d'abord le schéma `command/v1` publié sur le champ réel `steps` (décision validée).

**Tech Stack:** Bun + Hono + ajv (backend), React 19 + Vite + zustand/immer (éditeur), vitest des deux côtés.

**Spec:** `docs/superpowers/specs/2026-06-13-assistant-commands-dialogs-design.md`

**Conventions repo:**
- TDD strict : test rouge → vérifier l'échec → implémenter → vert → commit.
- Commits conventionnels ; `git add <chemins exacts>` (jamais `git add -A` — WIP permanent sur main).
- Éditeur : `cd editor && npx vitest run <file>` (un fichier) / `npm test` (suite).
- Backend : `cd backend && bun run test` — **JAMAIS `bun test` direct** (wipe la DB dev).
- Une autre session peut tourner sur ce checkout : stage uniquement tes fichiers, vérifie `git diff --staged` avant chaque commit.

**Décision actée (cf. question utilisateur 2026-06-13) :** le schéma `command/v1` est aligné sur `steps` (réutilise le `$def Step` de menu/v1, support `if`), pas `actions`. C'est ce que l'éditeur exporte (`serializeCommand`), ce que le backend importe (`packImport`), et ce que le domaine porte (`Command.steps`). Les dialogs gardent `actions` plat par bouton (déjà cohérent partout).

---

## File Structure

| Fichier | Rôle |
|---|---|
| `docs/schema/command/v1/schema.json` (modify) | champ exécutable `actions`→`steps` (ref menu/v1 Step, support `if`) ; `requirements`/`fallback` restent des listes d'actions/conditions plates |
| `docs/schema/command/v1/examples/*.json` (modify ×3) | `actions:`→`steps:` (wrap `{kind:"action",action:…}`) |
| `editor/src/schema/commandV1Schema.test.ts` (create) | garde-fou de forme du schéma + exemples |
| `editor/src/schema/actionV1ToDomain.ts` (create) | factory partagée action/condition/step wire→domaine |
| `editor/src/schema/menuV1ToDomain.ts` (modify) | consomme la factory (refactor sans changement de comportement) |
| `editor/src/schema/commandV1ToDomain.ts` (create) | wire command/v1 → domaine `Command` |
| `editor/src/schema/dialogV1ToDomain.ts` (create) | wire dialog/v1 → domaine `Dialog` |
| `editor/src/features/export/transform.ts` (modify) | exporter `serializeCommand`/`serializeDialog` + `packToCommandV1`/`packToDialogV1` |
| `editor/src/state/accountStore.ts` (modify) | `applyAssistantCommand` / `applyAssistantDialog` |
| `editor/src/lib/api/assistant.ts` (modify) | body `commands?` + `dialogs?` (objets complets) |
| `editor/src/features/assistant/AssistantChat.tsx` (modify) | envoi + gestion des 4 events |
| `backend/src/modules/assistant/validate.ts` (modify) | `validateCommandV1` / `validateDialogV1` + walker vocab généralisé |
| `backend/src/modules/assistant/workingCopy.ts` (modify) | maps commands + dialogs complets |
| `backend/src/modules/assistant/tools.ts` (modify) | tool defs + cases + EngineEvent |
| `backend/src/modules/assistant/grounding.ts` (modify) | inclut les 2 fiches + anti-injection |
| `backend/src/modules/assistant/grounding/command-v1-authoring-guide.md` (create) | fiche command/v1 |
| `backend/src/modules/assistant/grounding/dialog-v1-authoring-guide.md` (create) | fiche dialog/v1 |
| `backend/src/modules/assistant/routes.ts` (modify) | reçoit commands + dialogs complets |
| `CHANGELOG.md` (modify) | entrée `[Unreleased]` |

---

### Task 1: Réconcilier le schéma command/v1 sur `steps`

**Files:**
- Modify: `docs/schema/command/v1/schema.json`
- Modify: `docs/schema/command/v1/examples/pay-player.json`, `profile-with-target.json`, `simple-heal.json`
- Test: `editor/src/schema/commandV1Schema.test.ts` (create)

Contexte : aujourd'hui le schéma déclare `actions` (plat, `$ref` menu/v1 Action, minItems 1) mais l'éditeur/backend/domaine utilisent `steps` (avec `if`). On aligne le schéma + exemples sur `steps`. Le `$def Step` vit dans menu/v1 (`#/$defs/Step`, ref par `$id` `https://docs.artisanmc.net/schema/menu/v1.json#/$defs/Step`). On garde `requirements` et `fallback` en `actions` plats (ce sont des listes d'actions sans `if`, cohérent avec leur usage runtime).

- [ ] **Step 1: Écrire le test de forme (rouge)**

Créer `editor/src/schema/commandV1Schema.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import schema from "../../../docs/schema/command/v1/schema.json";
import pay from "../../../docs/schema/command/v1/examples/pay-player.json";
import profile from "../../../docs/schema/command/v1/examples/profile-with-target.json";
import heal from "../../../docs/schema/command/v1/examples/simple-heal.json";

describe("command/v1 schema shape", () => {
  it("uses `steps` (not flat `actions`) as the executable body", () => {
    const props = (schema as any).properties;
    expect(props.steps).toBeDefined();
    expect(props.actions).toBeUndefined();
    expect((schema as any).required).toContain("steps");
    expect((schema as any).required).not.toContain("actions");
  });

  it("steps items reference menu/v1 Step (if-support)", () => {
    const ref = (schema as any).properties.steps.items.$ref as string;
    expect(ref).toBe("https://docs.artisanmc.net/schema/menu/v1.json#/$defs/Step");
  });

  it("keeps requirements/fallback as flat Action arrays", () => {
    const props = (schema as any).properties;
    expect(props.requirements.items.$ref).toContain("#/$defs/Condition");
    expect(props.fallback.items.$ref).toContain("#/$defs/Action");
  });

  it("all examples use steps, not actions", () => {
    for (const ex of [pay, profile, heal] as any[]) {
      expect(Array.isArray(ex.steps)).toBe(true);
      expect(ex.actions).toBeUndefined();
      expect(ex.steps[0].kind).toBe("action");
    }
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd editor && npx vitest run src/schema/commandV1Schema.test.ts`
Expected: FAIL — le schéma a encore `actions`.

- [ ] **Step 3: Modifier le schéma**

Dans `docs/schema/command/v1/schema.json` :
- Dans `required` : remplacer `"actions"` par `"steps"`.
- Dans `properties` : supprimer le bloc `"actions": {...}` et insérer à la place :

```json
    "steps": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "https://docs.artisanmc.net/schema/menu/v1.json#/$defs/Step" },
      "description": "Séquence de steps exécutée quand la commande est appelée (actions + branches if, comme les click-handlers de menu). Les arguments résolus sont disponibles via les placeholders %args_<name>% et {arg}."
    },
```

`requirements`, `fallback`, `cooldown`, `arguments`, `metadata` inchangés.

- [ ] **Step 4: Modifier les 3 exemples**

Dans chaque `docs/schema/command/v1/examples/*.json`, renommer la clé `"actions"` en `"steps"` et envelopper chaque action dans un step :

`pay-player.json` — remplacer le bloc `"actions": [ {…}, … ]` par :

```json
  "steps": [
    { "kind": "action", "action": { "type": "take_money", "amount": 1 } },
    { "kind": "action", "action": { "type": "run_command", "command": "eco give %args_target% %args_amount%", "as": "console" } },
    { "kind": "action", "action": { "type": "send_message", "text": "§aVous avez envoyé %args_amount% pièces à %args_target%." } },
    { "kind": "action", "action": { "type": "play_sound", "sound": "entity.experience_orb.pickup" } }
  ],
```

(`requirements` et `fallback` restent inchangés — ce sont des listes d'actions plates.)

Faire le même wrap `{ "kind": "action", "action": {…} }` pour `profile-with-target.json` et `simple-heal.json` (lire chaque fichier, transformer chaque entrée de l'ancien tableau `actions` en step, renommer la clé en `steps`).

- [ ] **Step 5: Vérifier le vert**

Run: `cd editor && npx vitest run src/schema/commandV1Schema.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add docs/schema/command/v1/schema.json docs/schema/command/v1/examples/pay-player.json docs/schema/command/v1/examples/profile-with-target.json docs/schema/command/v1/examples/simple-heal.json editor/src/schema/commandV1Schema.test.ts
git commit -m "fix(schema): command/v1 uses steps (if-support), aligning schema with editor/runtime"
```

---

### Task 2: Extraire le convertisseur d'action/condition/step partagé

**Files:**
- Create: `editor/src/schema/actionV1ToDomain.ts`
- Modify: `editor/src/schema/menuV1ToDomain.ts`
- Test: `editor/src/schema/menuV1ToDomain.test.ts` (existant — doit rester vert), `editor/src/schema/actionV1ToDomain.test.ts` (create)

Objectif : sortir les fonctions `condition`, `action`, `step`, `ifArray` (lignes ~84-262 de `menuV1ToDomain.ts`) dans un module réutilisable par les 3 convertisseurs. Elles capturent aujourd'hui un contexte (i18n bridge `text`/`ref`, tableau `unsupported`). On en fait une **factory**.

- [ ] **Step 1: Écrire le test de la factory (rouge)**

Créer `editor/src/schema/actionV1ToDomain.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { makeStepConverter, type ConverterCtx } from "./actionV1ToDomain";
import type { I18nKey, LText } from "@/domain/types";

function ctx(): ConverterCtx & { unsupported: string[]; keys: Record<string, Record<string, string>> } {
  const unsupported: string[] = [];
  const keys: Record<string, Record<string, string>> = {};
  let n = 0;
  return {
    unsupported,
    keys,
    pushUnsupported: (s: string) => unsupported.push(s),
    text: (raw?: string): LText => {
      const key = `k_${n++}`;
      keys[key] = { en: raw ?? "" };
      return { key: key as I18nKey };
    },
    ref: (key: string): LText => ({ key: key as I18nKey }),
  };
}

describe("makeStepConverter", () => {
  it("converts a flat open_menu action", () => {
    const c = ctx();
    const { action } = makeStepConverter(c);
    expect(action({ type: "open_menu", menu_id: "shop" })).toEqual({ type: "open_menu", menuId: "shop" });
  });

  it("converts an if-step with conditions and nested actions", () => {
    const c = ctx();
    const { step } = makeStepConverter(c);
    const s = step({
      kind: "if",
      cases: [
        { conditions: [{ type: "has_permission", perm: "a.b" }], steps: [{ kind: "action", action: { type: "close_menu" } }] },
      ],
    });
    expect(s).toEqual({
      kind: "if",
      cases: [{ conditions: [{ type: "has_permission", perm: "a.b" }], steps: [{ kind: "action", action: { type: "close_menu" } }] }],
    });
  });

  it("records unsupported action types", () => {
    const c = ctx();
    const { action } = makeStepConverter(c);
    expect(action({ type: "bogus" })).toBeNull();
    expect(c.unsupported).toContain("action: bogus");
  });

  it("converts send_message text through the i18n bridge", () => {
    const c = ctx();
    const { action } = makeStepConverter(c);
    const a = action({ type: "send_message", text: "hi" }) as any;
    expect(c.keys[a.text.key]).toEqual({ en: "hi" });
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd editor && npx vitest run src/schema/actionV1ToDomain.test.ts`
Expected: FAIL — module absent.

- [ ] **Step 3: Créer la factory**

Créer `editor/src/schema/actionV1ToDomain.ts`. Déplacer **verbatim** les fonctions `condition`, `action`, `step`, `ifArray` de `menuV1ToDomain.ts` (lignes ~84-262), en les paramétrant par un `ConverterCtx`. Squelette :

```ts
import type {
  Action as DomainAction,
  Condition as DomainCondition,
  Step as DomainStep,
  DialogId,
  ElementId,
  LText,
  MenuId,
} from "@/domain/types";

// biome-ignore lint/suspicious/noExplicitAny: untyped wire object
type Json = Record<string, any>;

export interface ConverterCtx {
  text: (raw: string | undefined) => LText;
  ref: (key: string) => LText;
  pushUnsupported: (s: string) => void;
}

const DOMAIN_CONDITIONS = new Set([
  "has_permission", "has_money", "placeholder_equals", "placeholder_match",
  "has_item", "has_xp", "has_level", "world_is", "time_is", "random_chance",
  "cooldown_passed", "player_in_region", "pagination_at_first", "pagination_at_last",
  "not", "and", "or", "expression",
]);

export interface StepConverter {
  condition: (c: Json) => DomainCondition | null;
  action: (a: Json) => DomainAction | null;
  step: (s: Json) => DomainStep | null;
  ifArray: (arr: Json[] | undefined) => { conds: DomainCondition[]; joins: ("and" | "or")[] } | undefined;
}

export function makeStepConverter(ctx: ConverterCtx): StepConverter {
  const { text, pushUnsupported } = ctx;
  // … coller ici condition(), action(), step(), ifArray() depuis menuV1ToDomain,
  //   en remplaçant `unsupported.push(x)` → `pushUnsupported(x)` et en gardant
  //   `text(...)` (vient de ctx). NB: condition()/step() s'appellent récursivement —
  //   les garder en fonctions internes.
  return { condition, action, step, ifArray };
}
```

Copier les corps exacts (les ~40 cases d'action, les cases de condition, `step`, `ifArray`) tels quels depuis `menuV1ToDomain.ts`, en substituant `unsupported.push` → `pushUnsupported`.

- [ ] **Step 4: Refactor `menuV1ToDomain.ts`**

Dans `menuV1ToDomain.ts` : supprimer les définitions locales de `condition`, `action`, `step`, `ifArray` et le `DOMAIN_CONDITIONS` local ; à la place, après avoir défini `text`/`ref`, instancier :

```ts
import { makeStepConverter } from "./actionV1ToDomain";
// …
const { condition, action, step, ifArray } = makeStepConverter({
  text,
  ref,
  pushUnsupported: (s) => unsupported.push(s),
});
```

`clickMap`, `appearance`, etc. continuent d'appeler `step`/`condition`/`ifArray` sans changement. Le `action` n'est pas appelé directement par menuV1ToDomain hors `step`, mais l'export reste interne.

- [ ] **Step 5: Vérifier le vert (factory + non-régression menu)**

Run: `cd editor && npx vitest run src/schema/actionV1ToDomain.test.ts src/schema/menuV1ToDomain.test.ts src/schema/menuV1ToDomain.roundtrip.test.ts`
Expected: PASS — la factory + tous les tests menu existants (refactor invisible).

- [ ] **Step 6: Commit**

```bash
git add editor/src/schema/actionV1ToDomain.ts editor/src/schema/actionV1ToDomain.test.ts editor/src/schema/menuV1ToDomain.ts
git commit -m "refactor(editor): extract shared wire→domain step converter for reuse"
```

---

### Task 3: `commandV1ToDomain`

**Files:**
- Create: `editor/src/schema/commandV1ToDomain.ts`
- Test: `editor/src/schema/commandV1ToDomain.test.ts` (create)

Le domaine `Command` (types.ts:335) = `{ id, packId, name, aliases?, permission?, description?, arguments: CommandArg[], steps: Step[] }`. `CommandArg` = `{ name, type: "player"|"string"|"integer"|"number"|"boolean", required, default? }`. Le wire command/v1 (après Task 1) = `{ schema, id, name, aliases?, permission?, description?, notes?, arguments?, requirements?, steps, fallback?, cooldown?, metadata? }`.

NB domaine vs wire : le domaine `Command` n'a **pas** de champs `requirements`/`fallback`/`cooldown`/`notes`. Ces champs wire sont non représentables → les pousser dans `unsupported`. `arguments[].type` wire inclut `online_player`/`world`/`enum` que le domaine `CommandArg` ne porte pas → mapper `online_player`→`player`, et pousser `world`/`enum` dans `unsupported` en repliant sur `string`.

- [ ] **Step 1: Test (rouge)**

Créer `editor/src/schema/commandV1ToDomain.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { commandV1ToDomain } from "./commandV1ToDomain";
import { packId } from "@/domain/ids";

const opts = { packId: packId("p1"), lang: "en" };

describe("commandV1ToDomain", () => {
  it("maps id/name/aliases/permission/description and steps", () => {
    const { command } = commandV1ToDomain(
      {
        schema: "command/v1",
        id: "heal",
        name: "heal",
        aliases: ["h"],
        permission: "a.heal",
        description: "Heal",
        steps: [{ kind: "action", action: { type: "close_menu" } }],
      },
      opts,
    );
    expect(command.id).toBe("heal");
    expect(command.name).toBe("heal");
    expect(command.aliases).toEqual(["h"]);
    expect(command.permission).toBe("a.heal");
    expect(command.description).toBe("Heal");
    expect(command.packId).toBe("p1");
    expect(command.steps).toEqual([{ kind: "action", action: { type: "close_menu" } }]);
  });

  it("maps arguments, online_player→player, and extracts send_message i18n", () => {
    const { command, i18nKeys } = commandV1ToDomain(
      {
        schema: "command/v1",
        id: "pay",
        name: "pay",
        arguments: [
          { name: "target", type: "online_player", required: true },
          { name: "amount", type: "integer", required: true },
        ],
        steps: [{ kind: "action", action: { type: "send_message", text: "ok" } }],
      },
      opts,
    );
    expect(command.arguments).toEqual([
      { name: "target", type: "player", required: true },
      { name: "amount", type: "integer", required: true },
    ]);
    const a = command.steps[0] as any;
    expect(i18nKeys[a.action.text.key]).toEqual({ en: "ok" });
  });

  it("flags requirements/fallback/cooldown and unsupported arg types", () => {
    const { command, unsupported } = commandV1ToDomain(
      {
        schema: "command/v1",
        id: "c",
        name: "c",
        arguments: [{ name: "w", type: "world", required: false }],
        requirements: [{ type: "has_money", amount: 1 }],
        fallback: [{ type: "close_menu" }],
        cooldown: { id: "x", duration_seconds: 5 },
        steps: [{ kind: "action", action: { type: "close_menu" } }],
      },
      opts,
    );
    expect(command.arguments[0]).toEqual({ name: "w", type: "string", required: false });
    expect(unsupported).toEqual(expect.arrayContaining(["command.requirements", "command.fallback", "command.cooldown", "arg type: world"]));
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd editor && npx vitest run src/schema/commandV1ToDomain.test.ts`
Expected: FAIL — module absent.

- [ ] **Step 3: Implémenter**

Créer `editor/src/schema/commandV1ToDomain.ts` :

```ts
import type { Command as DomainCommand, CommandArg, I18nKey, LText, PackId, Step as DomainStep, CommandId } from "@/domain/types";
import { newI18nKey } from "@/lib/i18n";
import { makeStepConverter } from "./actionV1ToDomain";

// biome-ignore lint/suspicious/noExplicitAny: untyped wire object
type Json = Record<string, any>;

export interface CommandImportResult {
  command: DomainCommand;
  i18nKeys: Record<string, Record<string, string>>;
  unsupported: string[];
}

const ARG_TYPES = new Set(["player", "string", "integer", "number", "boolean"]);

export function commandV1ToDomain(
  src: Json,
  opts: { packId: PackId; lang: string; translations?: Record<string, Record<string, string>> },
): CommandImportResult {
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

  const { step } = makeStepConverter({ text, ref, pushUnsupported: (s) => unsupported.push(s) });

  const steps = ((src.steps as Json[]) ?? []).map(step).filter(Boolean) as DomainStep[];

  const args: CommandArg[] = ((src.arguments as Json[]) ?? []).map((a) => {
    let type = a.type as string;
    if (type === "online_player") type = "player";
    else if (!ARG_TYPES.has(type)) {
      unsupported.push(`arg type: ${type}`);
      type = "string";
    }
    return {
      name: a.name,
      type: type as CommandArg["type"],
      required: a.required ?? true,
      ...(a.default !== undefined ? { default: String(a.default) } : {}),
    };
  });

  for (const field of ["requirements", "fallback", "cooldown"]) {
    if (src[field] !== undefined) unsupported.push(`command.${field}`);
  }

  const command: DomainCommand = {
    id: src.id as CommandId,
    packId: opts.packId,
    name: src.name,
    arguments: args,
    steps,
    ...(Array.isArray(src.aliases) && src.aliases.length > 0 ? { aliases: src.aliases } : {}),
    ...(src.permission ? { permission: src.permission } : {}),
    ...(src.description ? { description: src.description } : {}),
  };

  return { command, i18nKeys, unsupported };
}
```

- [ ] **Step 4: Vérifier le vert**

Run: `cd editor && npx vitest run src/schema/commandV1ToDomain.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add editor/src/schema/commandV1ToDomain.ts editor/src/schema/commandV1ToDomain.test.ts
git commit -m "feat(editor): commandV1ToDomain converter (wire command/v1 → domain Command)"
```

---

### Task 4: `dialogV1ToDomain`

**Files:**
- Create: `editor/src/schema/dialogV1ToDomain.ts`
- Test: `editor/src/schema/dialogV1ToDomain.test.ts` (create)

Domaine `Dialog` (types.ts:416) = `{ id, packId, title: LText, canCloseWithEscape: boolean, body: DialogBody[], inputs: DialogInput[], buttons: DialogButton[] }`. `DialogButton` = `{ id, label: LText, steps: Step[] }`. Le wire dialog/v1 : `title` string (`{i18n:}` ou littéral), `body[]` (`text`|`item`), `inputs[]` (text/bool/number_range/single_option), `buttons[]` avec `actions` **plat** (pas de steps). `can_close_with_escape` émis seulement si `false`. Miroir de l'import backend `packImport.ts` (`importDialogBody`/`importDialogInput`/`importDialogButton`).

- [ ] **Step 1: Test (rouge)**

Créer `editor/src/schema/dialogV1ToDomain.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { dialogV1ToDomain } from "./dialogV1ToDomain";
import { packId } from "@/domain/ids";

const opts = { packId: packId("p1"), lang: "en" };

describe("dialogV1ToDomain", () => {
  it("maps title, escape default true, and a text button action → steps", () => {
    const { dialog, i18nKeys } = dialogV1ToDomain(
      {
        schema: "dialog/v1",
        id: "confirm",
        title: "Sure?",
        buttons: [{ id: "yes", label: "Yes", actions: [{ type: "close_dialog" }] }],
      },
      opts,
    );
    expect(dialog.id).toBe("confirm");
    expect(dialog.packId).toBe("p1");
    expect(dialog.canCloseWithEscape).toBe(true);
    expect(i18nKeys[dialog.title.key]).toEqual({ en: "Sure?" });
    expect(dialog.buttons[0]!.steps).toEqual([{ kind: "action", action: { type: "close_dialog" } }]);
    expect(i18nKeys[dialog.buttons[0]!.label.key]).toEqual({ en: "Yes" });
  });

  it("maps can_close_with_escape:false, body text+item, and a text input", () => {
    const { dialog } = dialogV1ToDomain(
      {
        schema: "dialog/v1",
        id: "d",
        title: "{i18n:dialogs.d.title}",
        can_close_with_escape: false,
        body: [
          { type: "text", text: "Hello" },
          { type: "item", material: "DIAMOND", count: 3 },
        ],
        inputs: [{ id: "name", type: "text", label: "Name", default: "x", max_length: 16 }],
        buttons: [{ id: "ok", label: "OK" }],
      },
      opts,
    );
    expect(dialog.canCloseWithEscape).toBe(false);
    expect(dialog.body[0]).toMatchObject({ type: "text" });
    expect(dialog.body[1]).toEqual({ type: "item", material: "DIAMOND", count: 3 });
    expect(dialog.inputs[0]).toMatchObject({ type: "text", id: "name", default: "x", maxLength: 16 });
    expect(dialog.buttons[0]!.steps).toEqual([]);
  });

  it("maps single_option input options + bool/number_range defaults", () => {
    const { dialog } = dialogV1ToDomain(
      {
        schema: "dialog/v1",
        id: "d",
        title: "t",
        inputs: [
          { id: "b", type: "bool", label: "B", default: "true" },
          { id: "n", type: "number_range", label: "N", min: 0, max: 10, default: "5" },
          { id: "o", type: "single_option", label: "O", options: [{ value: "a", label: "A" }], default: "a" },
        ],
        buttons: [{ id: "ok", label: "OK" }],
      },
      opts,
    );
    expect(dialog.inputs[0]).toMatchObject({ type: "bool", default: true });
    expect(dialog.inputs[1]).toMatchObject({ type: "number_range", min: 0, max: 10, default: 5 });
    const opt = dialog.inputs[2] as any;
    expect(opt.type).toBe("single_option");
    expect(opt.options[0].value).toBe("a");
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd editor && npx vitest run src/schema/dialogV1ToDomain.test.ts`
Expected: FAIL — module absent.

- [ ] **Step 3: Implémenter**

Créer `editor/src/schema/dialogV1ToDomain.ts` :

```ts
import type {
  Dialog as DomainDialog, DialogBody, DialogInput, DialogButton, DialogId,
  I18nKey, LText, PackId, Step as DomainStep,
} from "@/domain/types";
import { newI18nKey } from "@/lib/i18n";
import { makeStepConverter } from "./actionV1ToDomain";

// biome-ignore lint/suspicious/noExplicitAny: untyped wire object
type Json = Record<string, any>;

export interface DialogImportResult {
  dialog: DomainDialog;
  i18nKeys: Record<string, Record<string, string>>;
  unsupported: string[];
}

export function dialogV1ToDomain(
  src: Json,
  opts: { packId: PackId; lang: string; translations?: Record<string, Record<string, string>> },
): DialogImportResult {
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

  const { action } = makeStepConverter({ text, ref, pushUnsupported: (s) => unsupported.push(s) });
  const actionsToSteps = (actions: Json[] | undefined): DomainStep[] =>
    (actions ?? [])
      .map((a) => action(a))
      .filter(Boolean)
      .map((act) => ({ kind: "action", action: act! }) as DomainStep);

  const body: DialogBody[] = ((src.body as Json[]) ?? []).map((b) =>
    b.type === "text"
      ? { type: "text", text: text(b.text) }
      : { type: "item", material: b.material, count: b.count ?? 1 },
  );

  const inputs: DialogInput[] = ((src.inputs as Json[]) ?? []).map((i) => {
    switch (i.type) {
      case "bool":
        return { type: "bool", id: i.id, label: text(i.label), default: String(i.default) === "true" };
      case "number_range":
        return { type: "number_range", id: i.id, label: text(i.label), min: i.min ?? 0, max: i.max ?? 100, default: Number(i.default ?? 0) };
      case "single_option":
        return {
          type: "single_option", id: i.id, label: text(i.label),
          options: ((i.options as Json[]) ?? []).map((o) => ({ value: o.value, label: text(o.label) })),
          default: i.default ?? "",
        };
      default:
        return { type: "text", id: i.id, label: text(i.label), default: i.default ?? "", maxLength: i.max_length ?? 32 };
    }
  });

  const buttons: DialogButton[] = ((src.buttons as Json[]) ?? []).map((b) => ({
    id: b.id,
    label: text(b.label),
    steps: actionsToSteps(b.actions),
  }));

  const dialog: DomainDialog = {
    id: src.id as DialogId,
    packId: opts.packId,
    title: text(src.title),
    canCloseWithEscape: src.can_close_with_escape !== false,
    body,
    inputs,
    buttons,
  };

  return { dialog, i18nKeys, unsupported };
}
```

- [ ] **Step 4: Vérifier le vert**

Run: `cd editor && npx vitest run src/schema/dialogV1ToDomain.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add editor/src/schema/dialogV1ToDomain.ts editor/src/schema/dialogV1ToDomain.test.ts
git commit -m "feat(editor): dialogV1ToDomain converter (wire dialog/v1 → domain Dialog)"
```

---

### Task 5: Exporter les sérialiseurs + `packToCommandV1`/`packToDialogV1`

**Files:**
- Modify: `editor/src/features/export/transform.ts`
- Test: `editor/src/features/export/transform.test.ts` (existant — y ajouter)

`serializeCommand` (transform.ts:443) et `serializeDialog` (:509) sont privées. Les exporter + ajouter deux helpers pack-level (miroir de `packToMenuV1` :437).

- [ ] **Step 1: Test (rouge)**

Ajouter à `editor/src/features/export/transform.test.ts` (le helper `makePack` y existe ; imports `commandId`, `dialogId`, `menuId`, `packId` déjà présents) :

```ts
import { packToCommandV1, packToDialogV1 } from "./transform";

describe("packToCommandV1 / packToDialogV1", () => {
  it("serializes a command to command/v1 with steps", () => {
    const pack = makePack({
      commands: [
        {
          id: commandId("heal"), packId: packId("p_test"), name: "heal",
          arguments: [{ name: "n", type: "integer", required: true }],
          steps: [{ kind: "action", action: { type: "close_menu" } }],
        },
      ],
    });
    const [cmd] = packToCommandV1(pack);
    expect(cmd).toMatchObject({ schema: "command/v1", id: "heal", name: "heal" });
    expect((cmd as any).steps[0].kind).toBe("action");
    expect((cmd as any).arguments[0]).toEqual({ name: "n", type: "integer", required: true });
  });

  it("serializes a dialog to dialog/v1 with flat button actions", () => {
    const pack = makePack({
      i18nKeys: { ["k_t" as I18nKey]: { en: "T" }, ["k_b" as I18nKey]: { en: "OK" } },
      dialogs: [
        {
          id: dialogId("confirm"), packId: packId("p_test"),
          title: { key: "k_t" as I18nKey }, canCloseWithEscape: true,
          body: [], inputs: [],
          buttons: [{ id: "ok", label: { key: "k_b" as I18nKey }, steps: [{ kind: "action", action: { type: "close_dialog" } }] }],
        } as any,
      ],
    });
    const [dlg] = packToDialogV1(pack);
    expect(dlg).toMatchObject({ schema: "dialog/v1", id: "confirm" });
    expect((dlg as any).buttons[0].actions[0].type).toBe("close_dialog");
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd editor && npx vitest run src/features/export/transform.test.ts`
Expected: FAIL — `packToCommandV1`/`packToDialogV1` non exportés.

- [ ] **Step 3: Implémenter**

Dans `transform.ts` : changer `function serializeCommand` → `export function serializeCommand`, `function serializeDialog` → `export function serializeDialog`. Ajouter après `serializeCommand` :

```ts
/** Serialize every command in a pack to canonical command/v1 objects. */
export function packToCommandV1(pack: Pack): Record<string, unknown>[] {
  return pack.commands.map((c) => serializeCommand(c, pack));
}
```

Ajouter après `serializeDialog` :

```ts
/** Serialize every dialog in a pack to canonical dialog/v1 objects. */
export function packToDialogV1(pack: Pack): Record<string, unknown>[] {
  return pack.dialogs.map((d) => serializeDialog(d));
}
```

- [ ] **Step 4: Vérifier le vert**

Run: `cd editor && npx vitest run src/features/export/transform.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/features/export/transform.ts editor/src/features/export/transform.test.ts
git commit -m "feat(editor): export serializeCommand/serializeDialog + packToCommandV1/packToDialogV1"
```

---

### Task 6: Store — `applyAssistantCommand` / `applyAssistantDialog`

**Files:**
- Modify: `editor/src/state/accountStore.ts`
- Test: `editor/src/state/accountStore.test.ts` (existant — y ajouter)

Miroir de `applyAssistantMenu` (accountStore.ts:918). Insert-or-replace par id + merge i18n + `updatedAt`. Retourne `unsupported`.

- [ ] **Step 1: Test (rouge)**

Ajouter dans `describe("accountStore")` de `accountStore.test.ts` (`PERSONAL` + `mockAccount()` déjà en place) :

```ts
it("applyAssistantCommand inserts then replaces a command and merges i18n", () => {
  const dropped = useAccountStore.getState().applyAssistantCommand({
    packId: PERSONAL, lang: "en",
    commandV1: {
      schema: "command/v1", id: "heal", name: "heal",
      steps: [{ kind: "action", action: { type: "send_message", text: "Healed" } }],
    },
  });
  expect(dropped).toEqual([]);
  let pack = useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!;
  const cmd = pack.commands.find((c) => c.id === "heal")!;
  expect(cmd.name).toBe("heal");
  const msgKey = (cmd.steps[0] as any).action.text.key;
  expect(pack.i18nKeys[msgKey]!.en).toBe("Healed");

  useAccountStore.getState().applyAssistantCommand({
    packId: PERSONAL, lang: "en",
    commandV1: { schema: "command/v1", id: "heal", name: "heal2", steps: [{ kind: "action", action: { type: "close_menu" } }] },
  });
  pack = useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!;
  expect(pack.commands.filter((c) => c.id === "heal")).toHaveLength(1);
  expect(pack.commands.find((c) => c.id === "heal")!.name).toBe("heal2");
});

it("applyAssistantDialog inserts a dialog and merges i18n", () => {
  useAccountStore.getState().applyAssistantDialog({
    packId: PERSONAL, lang: "en",
    dialogV1: {
      schema: "dialog/v1", id: "d_confirm", title: "Sure?",
      buttons: [{ id: "yes", label: "Yes", actions: [{ type: "close_dialog" }] }],
    },
  });
  const pack = useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!;
  const dlg = pack.dialogs.find((d) => d.id === "d_confirm")!;
  expect(dlg).toBeDefined();
  expect(pack.i18nKeys[dlg.title.key]!.en).toBe("Sure?");
  expect(dlg.buttons[0]!.steps[0]).toMatchObject({ kind: "action" });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd editor && npx vitest run src/state/accountStore.test.ts`
Expected: FAIL — actions absentes.

- [ ] **Step 3: Implémenter**

a) Interface des actions (près de `applyAssistantMenu`, ~ligne 93). Importer les convertisseurs en tête du fichier :

```ts
import { commandV1ToDomain } from "@/schema/commandV1ToDomain";
import { dialogV1ToDomain } from "@/schema/dialogV1ToDomain";
```

Déclarations :

```ts
  /** Apply an AI-generated command/v1: convert + insert/replace + merge i18n. Returns dropped constructs. */
  applyAssistantCommand: (input: { packId: PackId; commandV1: Record<string, unknown>; lang: string }) => string[];
  /** Apply an AI-generated dialog/v1: convert + insert/replace + merge i18n. Returns dropped constructs. */
  applyAssistantDialog: (input: { packId: PackId; dialogV1: Record<string, unknown>; lang: string }) => string[];
```

b) Implémentations (juste après `applyAssistantMenu`, ~ligne 943) :

```ts
        applyAssistantCommand: ({ packId: pId, commandV1, lang }) => {
          let unsupported: string[] = [];
          set(
            produce((draft: AccountState) => {
              const pack = draft.account.packs.find((p) => p.id === pId);
              if (!pack) return;
              const { command, i18nKeys, unsupported: u } = commandV1ToDomain(commandV1, { packId: pId, lang });
              unsupported = u;
              command.packId = pId;
              for (const [key, langs] of Object.entries(i18nKeys)) {
                pack.i18nKeys[key as I18nKey] = { ...(pack.i18nKeys[key as I18nKey] ?? {}), ...langs };
              }
              const idx = pack.commands.findIndex((c) => c.id === command.id);
              if (idx >= 0) pack.commands[idx] = command;
              else pack.commands.push(command);
              pack.updatedAt = new Date().toISOString();
            }),
          );
          return unsupported;
        },
        applyAssistantDialog: ({ packId: pId, dialogV1, lang }) => {
          let unsupported: string[] = [];
          set(
            produce((draft: AccountState) => {
              const pack = draft.account.packs.find((p) => p.id === pId);
              if (!pack) return;
              const { dialog, i18nKeys, unsupported: u } = dialogV1ToDomain(dialogV1, { packId: pId, lang });
              unsupported = u;
              dialog.packId = pId;
              for (const [key, langs] of Object.entries(i18nKeys)) {
                pack.i18nKeys[key as I18nKey] = { ...(pack.i18nKeys[key as I18nKey] ?? {}), ...langs };
              }
              const idx = pack.dialogs.findIndex((d) => d.id === dialog.id);
              if (idx >= 0) pack.dialogs[idx] = dialog;
              else pack.dialogs.push(dialog);
              pack.updatedAt = new Date().toISOString();
            }),
          );
          return unsupported;
        },
```

- [ ] **Step 4: Vérifier le vert**

Run: `cd editor && npx vitest run src/state/accountStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/state/accountStore.ts editor/src/state/accountStore.test.ts
git commit -m "feat(editor): applyAssistantCommand / applyAssistantDialog store actions"
```

---

### Task 7: Backend — `validateCommandV1` / `validateDialogV1`

**Files:**
- Modify: `backend/src/modules/assistant/validate.ts`
- Test: `backend/src/modules/assistant/validate.test.ts` (existant — y ajouter)

Le schéma command/v1 et dialog/v1 `$ref`ent menu/v1 par `$id`. Il faut enregistrer le schéma menu/v1 dans l'instance ajv (`ajv.addSchema`) pour que les refs résolvent. On généralise `collectVocabErrors` pour exposer des walkers `vocabErrorsInSteps(steps)` et `vocabErrorsInActions(actions)` réutilisables.

- [ ] **Step 1: Test (rouge)**

Ajouter à `backend/src/modules/assistant/validate.test.ts` (imports : ajouter `validateCommandV1, validateDialogV1`) :

```ts
import { validateCommandV1, validateDialogV1 } from "./validate";

describe("validateCommandV1", () => {
  it("accepts a minimal valid command", () => {
    const r = validateCommandV1({
      schema: "command/v1", id: "heal", name: "heal",
      steps: [{ kind: "action", action: { type: "close_menu" } }],
    });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects an out-of-vocabulary action inside a step", () => {
    const r = validateCommandV1({
      schema: "command/v1", id: "c", name: "c",
      steps: [{ kind: "action", action: { type: "launch_nukes" } }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/launch_nukes/);
  });

  it("rejects a structurally invalid command (missing name)", () => {
    const r = validateCommandV1({ schema: "command/v1", id: "c", steps: [{ kind: "action", action: { type: "close_menu" } }] });
    expect(r.valid).toBe(false);
  });

  it("rejects an out-of-vocab condition in requirements", () => {
    const r = validateCommandV1({
      schema: "command/v1", id: "c", name: "c",
      requirements: [{ type: "moon_phase" }],
      steps: [{ kind: "action", action: { type: "close_menu" } }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/moon_phase/);
  });
});

describe("validateDialogV1", () => {
  it("accepts a minimal valid dialog", () => {
    const r = validateDialogV1({
      schema: "dialog/v1", id: "d", title: "T",
      buttons: [{ id: "ok", label: "OK", actions: [{ type: "close_dialog" }] }],
    });
    expect(r.valid).toBe(true);
  });

  it("rejects an out-of-vocab action in a button", () => {
    const r = validateDialogV1({
      schema: "dialog/v1", id: "d", title: "T",
      buttons: [{ id: "ok", label: "OK", actions: [{ type: "rm_rf" }] }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/rm_rf/);
  });

  it("rejects a dialog with no buttons (schema required)", () => {
    const r = validateDialogV1({ schema: "dialog/v1", id: "d", title: "T" });
    expect(r.valid).toBe(false);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd backend && bun run test` (jamais `bun test` direct)
Expected: FAIL — exports absents.

- [ ] **Step 3: Implémenter**

Dans `backend/src/modules/assistant/validate.ts` :

a) Imports + enregistrement du schéma menu/v1 comme schéma référencé (le menu schema est déjà importé comme `schema`). Ajouter les imports des deux nouveaux schémas et l'enregistrement :

```ts
import commandSchema from "../../../../docs/schema/command/v1/schema.json";
import dialogSchema from "../../../../docs/schema/dialog/v1/schema.json";
```

Après `const validateStruct = ajv.compile(schema);`, enregistrer menu/v1 par son `$id` pour résoudre les `$ref` des schémas command/dialog, puis compiler ceux-ci :

```ts
// command/v1 & dialog/v1 $ref menu/v1 by $id — register it so refs resolve.
if (!ajv.getSchema(schema.$id)) ajv.addSchema(schema, schema.$id);
const validateCommandStruct = ajv.compile(commandSchema);
const validateDialogStruct = ajv.compile(dialogSchema);
```

b) Généraliser le walker. Extraire des helpers exportables-internes à partir du `collectVocabErrors` existant. Ajouter `steps(list, path)` est déjà là ; ajouter deux entrées publiques :

```ts
function vocabErrorsInSteps(list: Json[] | undefined): string[] {
  const errors: string[] = [];
  // réutilise la logique de `steps`/`action`/`condition` — déplacer ces 3
  // fonctions au niveau module (hors de collectVocabErrors) en les faisant
  // pousser dans un tableau passé en argument, OU dupliquer le walk minimal :
  function condition(c: Json | undefined, p: string): void {
    if (!c || typeof c !== "object") return;
    if (!CONDITION_SET.has(c.type)) { errors.push(`${p} condition type "${c.type}" is not in the allowed vocabulary`); return; }
    if (c.type === "not") condition(c.of, `${p}/of`);
    if (c.type === "and" || c.type === "or") (c.of ?? []).forEach((s: Json, i: number) => condition(s, `${p}/of/${i}`));
  }
  function action(a: Json | undefined, p: string): void {
    if (!a || typeof a !== "object") return;
    if (!ACTION_SET.has(a.type)) errors.push(`${p} action type "${a.type}" is not in the allowed vocabulary`);
  }
  function steps(l: Json[] | undefined, p: string): void {
    (l ?? []).forEach((s, i) => {
      const sp = `${p}/${i}`;
      if (s?.kind === "action") action(s.action, `${sp}/action`);
      else if (s?.kind === "if") {
        (s.cases ?? []).forEach((c: Json, j: number) => {
          (c.conditions ?? []).forEach((cd: Json, k: number) => condition(cd, `${sp}/cases/${j}/conditions/${k}`));
          steps(c.steps, `${sp}/cases/${j}/steps`);
        });
        steps(s.else, `${sp}/else`);
      }
    });
  }
  steps(list, "/steps");
  return errors;
}

function vocabErrorsInActions(list: Json[] | undefined, base: string): string[] {
  const errors: string[] = [];
  (list ?? []).forEach((a, i) => {
    if (a && typeof a === "object" && !ACTION_SET.has(a.type)) {
      errors.push(`${base}/${i} action type "${a.type}" is not in the allowed vocabulary`);
    }
  });
  return errors;
}

function vocabErrorsInConditions(list: Json[] | undefined, base: string): string[] {
  const errors: string[] = [];
  function condition(c: Json | undefined, p: string): void {
    if (!c || typeof c !== "object") return;
    if (!CONDITION_SET.has(c.type)) { errors.push(`${p} condition type "${c.type}" is not in the allowed vocabulary`); return; }
    if (c.type === "not") condition(c.of, `${p}/of`);
    if (c.type === "and" || c.type === "or") (c.of ?? []).forEach((s: Json, i: number) => condition(s, `${p}/of/${i}`));
  }
  (list ?? []).forEach((c, i) => condition(c, `${base}/${i}`));
  return errors;
}
```

(NB : le `condition`/`action`/`steps` interne à `collectVocabErrors` peut rester ; on accepte une légère duplication plutôt qu'un gros refactor risqué du walker menu. Si tu préfères DRY : remonte ces 3 fonctions au niveau module en leur passant un `errors[]` — au choix, sans changer le comportement de `validateMenuV1`.)

c) Les deux validateurs :

```ts
export function validateCommandV1(cmd: unknown): MenuV1ValidationResult {
  const ok = validateCommandStruct(cmd) as boolean;
  const structErrors = (validateCommandStruct.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim());
  let vocab: string[] = [];
  if (ok) {
    const c = cmd as Json;
    vocab = [
      ...vocabErrorsInSteps(c.steps),
      ...vocabErrorsInConditions(c.requirements, "/requirements"),
      ...vocabErrorsInActions(c.fallback, "/fallback"),
    ];
  }
  const errors = [...structErrors, ...vocab];
  return { valid: errors.length === 0, errors };
}

export function validateDialogV1(dlg: unknown): MenuV1ValidationResult {
  const ok = validateDialogStruct(dlg) as boolean;
  const structErrors = (validateDialogStruct.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim());
  let vocab: string[] = [];
  if (ok) {
    const d = dlg as Json;
    (d.buttons ?? []).forEach((b: Json, i: number) => {
      vocab.push(...vocabErrorsInActions(b.actions, `/buttons/${i}/actions`));
    });
  }
  const errors = [...structErrors, ...vocab];
  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 4: Vérifier le vert**

Run: `cd backend && bun run test`
Expected: PASS (suite complète, dont les nouveaux tests). Si la résolution `$ref` échoue (`can't resolve reference`), vérifier que `schema.$id` correspond exactement aux URLs `$ref` (`https://docs.artisanmc.net/schema/menu/v1.json`).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/assistant/validate.ts backend/src/modules/assistant/validate.test.ts
git commit -m "feat(backend): validateCommandV1 / validateDialogV1 (ajv + vocab subset)"
```

---

### Task 8: Backend — `WorkingCopy` commands + dialogs complets

**Files:**
- Modify: `backend/src/modules/assistant/workingCopy.ts`
- Test: `backend/src/modules/assistant/workingCopy.test.ts` (create si absent)

Aujourd'hui la WorkingCopy tient menus (complets) + dialogs (résumés `{id,title}`) + attachments. On ajoute commands (complets) et on passe dialogs à des **objets complets**, `listDialogs()` dérivant le résumé.

- [ ] **Step 1: Test (rouge)**

Créer `backend/src/modules/assistant/workingCopy.test.ts` :

```ts
import { describe, expect, test } from "bun:test";
import { WorkingCopy } from "./workingCopy";

describe("WorkingCopy commands", () => {
  test("upsert/get/delete/list commands", () => {
    const wc = new WorkingCopy([], {}, [], [{ schema: "command/v1", id: "heal", name: "heal", steps: [] }]);
    expect(wc.listCommands()).toEqual([{ id: "heal", name: "heal" }]);
    expect((wc.getCommand("heal") as any).name).toBe("heal");
    wc.upsertCommand({ schema: "command/v1", id: "heal", name: "heal2", steps: [] });
    expect((wc.getCommand("heal") as any).name).toBe("heal2");
    expect(wc.deleteCommand("heal")).toBe(true);
    expect(wc.getCommand("heal")).toBeUndefined();
  });
});

describe("WorkingCopy dialogs (full objects)", () => {
  test("listDialogs derives id+title summary; getDialog returns full", () => {
    const wc = new WorkingCopy([], {}, [{ schema: "dialog/v1", id: "d", title: "Hi", buttons: [{ id: "ok", label: "OK" }] }]);
    expect(wc.listDialogs()).toEqual([{ id: "d", title: "Hi" }]);
    expect((wc.getDialog("d") as any).buttons[0].id).toBe("ok");
    wc.upsertDialog({ schema: "dialog/v1", id: "d2", title: "Yo", buttons: [] });
    expect(wc.listDialogs().map((x) => x.id).sort()).toEqual(["d", "d2"]);
    expect(wc.deleteDialog("d")).toBe(true);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd backend && bun run test`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Réécrire `backend/src/modules/assistant/workingCopy.ts` :

```ts
export type MenuV1 = Record<string, any>; // wire menu/v1 object
export type CommandV1 = Record<string, any>;
export type DialogV1 = Record<string, any>;

export interface DialogSummary { id: string; title: string }
export interface CommandSummary { id: string; name: string }

export class WorkingCopy {
  private menus = new Map<string, MenuV1>();
  private attachments = new Map<string, string>();
  private dialogs = new Map<string, DialogV1>();
  private commands = new Map<string, CommandV1>();

  constructor(
    menus: MenuV1[] = [],
    attachments: Record<string, string> = {},
    dialogs: DialogV1[] = [],
    commands: CommandV1[] = [],
  ) {
    for (const m of menus) if (typeof m?.id === "string") this.menus.set(m.id, m);
    for (const [k, v] of Object.entries(attachments)) this.attachments.set(k, v);
    for (const d of dialogs) if (typeof d?.id === "string") this.dialogs.set(d.id, d);
    for (const c of commands) if (typeof c?.id === "string") this.commands.set(c.id, c);
  }

  list(): { id: string; title: unknown; size: number }[] {
    return [...this.menus.values()].map((m) => ({ id: m.id, title: m.title, size: m.size }));
  }
  get(id: string): MenuV1 | undefined { return this.menus.get(id); }
  upsert(menu: MenuV1): void { this.menus.set(menu.id, menu); }
  delete(id: string): boolean { return this.menus.delete(id); }

  listDialogs(): DialogSummary[] {
    return [...this.dialogs.values()].map((d) => ({ id: d.id, title: typeof d.title === "string" ? d.title : "" }));
  }
  getDialog(id: string): DialogV1 | undefined { return this.dialogs.get(id); }
  upsertDialog(d: DialogV1): void { this.dialogs.set(d.id, d); }
  deleteDialog(id: string): boolean { return this.dialogs.delete(id); }

  listCommands(): CommandSummary[] {
    return [...this.commands.values()].map((c) => ({ id: c.id, name: c.name }));
  }
  getCommand(id: string): CommandV1 | undefined { return this.commands.get(id); }
  upsertCommand(c: CommandV1): void { this.commands.set(c.id, c); }
  deleteCommand(id: string): boolean { return this.commands.delete(id); }

  attachment(fileId: string): string | undefined { return this.attachments.get(fileId); }
  snapshot(): MenuV1[] { return [...this.menus.values()]; }
}
```

NB : le constructeur passe de `(menus, attachments, dialogs: DialogSummary[])` à `(menus, attachments, dialogs: DialogV1[], commands: CommandV1[])`. Les dialogs reçus sont désormais des objets complets — Task 11 ajuste `routes.ts` en conséquence.

- [ ] **Step 4: Vérifier le vert**

Run: `cd backend && bun run test`
Expected: PASS (les nouveaux tests + pas de régression — `tools.test.ts` reconstruit la WorkingCopy ; vérifier qu'il compile encore, sinon Task 9 l'ajuste).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/assistant/workingCopy.ts backend/src/modules/assistant/workingCopy.test.ts
git commit -m "feat(backend): WorkingCopy tracks commands + full dialog objects"
```

---

### Task 9: Backend — tools commandes & dialogs

**Files:**
- Modify: `backend/src/modules/assistant/tools.ts`
- Test: `backend/src/modules/assistant/tools.test.ts` (existant — y ajouter)

- [ ] **Step 1: Test (rouge)**

Ajouter à `backend/src/modules/assistant/tools.test.ts` (lire le fichier pour mirror le style : il instancie une `WorkingCopy` et appelle `executeTool`) :

```ts
import { WorkingCopy } from "./workingCopy";
import { executeTool, TOOL_DEFS } from "./tools";

describe("command tools", () => {
  const cmd = { schema: "command/v1", id: "heal", name: "heal", steps: [{ kind: "action", action: { type: "close_menu" } }] };

  test("tool defs expose command CRUD", () => {
    const names = TOOL_DEFS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["list_commands", "get_command", "upsert_command", "delete_command"]));
  });

  test("upsert_command validates then writes and emits command_written", () => {
    const wc = new WorkingCopy();
    const r = executeTool("upsert_command", { command: cmd }, wc);
    expect(r.ok).toBe(true);
    expect(r.event).toEqual({ type: "command_written", command: cmd });
    expect(wc.getCommand("heal")).toBeDefined();
  });

  test("upsert_command rejects invalid command with errors", () => {
    const wc = new WorkingCopy();
    const r = executeTool("upsert_command", { command: { schema: "command/v1", id: "x" } }, wc);
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/Invalid command/);
  });

  test("delete_command emits command_deleted", () => {
    const wc = new WorkingCopy([], {}, [], [cmd]);
    const r = executeTool("delete_command", { id: "heal" }, wc);
    expect(r.event).toEqual({ type: "command_deleted", id: "heal" });
  });
});

describe("dialog write tools", () => {
  const dlg = { schema: "dialog/v1", id: "d", title: "T", buttons: [{ id: "ok", label: "OK", actions: [{ type: "close_dialog" }] }] };

  test("upsert_dialog validates and emits dialog_written", () => {
    const wc = new WorkingCopy();
    const r = executeTool("upsert_dialog", { dialog: dlg }, wc);
    expect(r.ok).toBe(true);
    expect(r.event).toEqual({ type: "dialog_written", dialog: dlg });
  });

  test("get_dialog returns the full object", () => {
    const wc = new WorkingCopy([], {}, [dlg]);
    const r = executeTool("get_dialog", { id: "d" }, wc);
    expect(JSON.parse(r.content).buttons[0].id).toBe("ok");
  });

  test("delete_dialog emits dialog_deleted", () => {
    const wc = new WorkingCopy([], {}, [dlg]);
    const r = executeTool("delete_dialog", { id: "d" }, wc);
    expect(r.event).toEqual({ type: "dialog_deleted", id: "d" });
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd backend && bun run test`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Dans `tools.ts` :

a) Imports : `import { validateMenuV1, validateCommandV1, validateDialogV1 } from "./validate";`

b) `EngineEvent` — ajouter :

```ts
  | { type: "command_written"; command: Record<string, any> }
  | { type: "command_deleted"; id: string }
  | { type: "dialog_written"; dialog: Record<string, any> }
  | { type: "dialog_deleted"; id: string }
```

c) `TOOL_DEFS` — ajouter :

```ts
  { name: "list_commands", description: "List commands in the current pack (id, name).", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_command", description: "Get a command's full canonical command/v1 JSON by id.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false } },
  { name: "upsert_command", description: "Create or replace a command. The argument is a complete canonical command/v1 object. Rejected with errors if invalid — fix and retry.", parameters: { type: "object", properties: { command: { type: "object" } }, required: ["command"], additionalProperties: false } },
  { name: "delete_command", description: "Delete a command by id.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false } },
  { name: "get_dialog", description: "Get a dialog's full canonical dialog/v1 JSON by id.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false } },
  { name: "upsert_dialog", description: "Create or replace a dialog. The argument is a complete canonical dialog/v1 object. Rejected with errors if invalid — fix and retry.", parameters: { type: "object", properties: { dialog: { type: "object" } }, required: ["dialog"], additionalProperties: false } },
  { name: "delete_dialog", description: "Delete a dialog by id.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false } },
```

d) `executeTool` — ajouter les cases (avant le `default`) :

```ts
    case "list_commands":
      return { ok: true, content: JSON.stringify(wc.listCommands()) };
    case "get_command": {
      const c = wc.getCommand(String(input?.id));
      return c ? { ok: true, content: JSON.stringify(c) } : { ok: false, content: `No command with id "${input?.id}".` };
    }
    case "upsert_command": {
      const command = input?.command;
      const v = validateCommandV1(command);
      if (!v.valid) return { ok: false, content: `Invalid command/v1. Fix these and retry:\n- ${v.errors.join("\n- ")}` };
      wc.upsertCommand(command);
      return { ok: true, content: `Command "${command.id}" saved.`, event: { type: "command_written", command } };
    }
    case "delete_command": {
      const id = String(input?.id);
      return wc.deleteCommand(id)
        ? { ok: true, content: `Command "${id}" deleted.`, event: { type: "command_deleted", id } }
        : { ok: false, content: `No command with id "${id}".` };
    }
    case "get_dialog": {
      const d = wc.getDialog(String(input?.id));
      return d ? { ok: true, content: JSON.stringify(d) } : { ok: false, content: `No dialog with id "${input?.id}".` };
    }
    case "upsert_dialog": {
      const dialog = input?.dialog;
      const v = validateDialogV1(dialog);
      if (!v.valid) return { ok: false, content: `Invalid dialog/v1. Fix these and retry:\n- ${v.errors.join("\n- ")}` };
      wc.upsertDialog(dialog);
      return { ok: true, content: `Dialog "${dialog.id}" saved.`, event: { type: "dialog_written", dialog } };
    }
    case "delete_dialog": {
      const id = String(input?.id);
      return wc.deleteDialog(id)
        ? { ok: true, content: `Dialog "${id}" deleted.`, event: { type: "dialog_deleted", id } }
        : { ok: false, content: `No dialog with id "${id}".` };
    }
```

- [ ] **Step 4: Vérifier le vert**

Run: `cd backend && bun run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/assistant/tools.ts backend/src/modules/assistant/tools.test.ts
git commit -m "feat(backend): assistant command + dialog CRUD tools and events"
```

---

### Task 10: Backend — grounding (fiches command/v1 & dialog/v1)

**Files:**
- Create: `backend/src/modules/assistant/grounding/command-v1-authoring-guide.md`
- Create: `backend/src/modules/assistant/grounding/dialog-v1-authoring-guide.md`
- Modify: `backend/src/modules/assistant/grounding.ts`
- Test: `backend/src/modules/assistant/grounding.test.ts` (existant — y ajouter)

- [ ] **Step 1: Test (rouge)**

Lire `grounding.test.ts` puis ajouter :

```ts
it("system prompt includes command and dialog authoring guides + tools", () => {
  const p = buildSystemPrompt();
  expect(p).toMatch(/command\/v1/);
  expect(p).toMatch(/dialog\/v1/);
  expect(p).toMatch(/upsert_command/);
  expect(p).toMatch(/upsert_dialog/);
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd backend && bun run test`
Expected: FAIL.

- [ ] **Step 3: Écrire les fiches + câbler**

Créer `command-v1-authoring-guide.md` — contenu concret (pas de placeholder), structure miroir du guide menu : titre, rappel du format, exemple complet, champ par champ. Points clés à documenter :
- `command/v1` requiert `schema`, `id` (`^[a-z][a-z0-9_]{0,63}$`), `name` (`^[a-z][a-z0-9_-]{0,31}$`), `steps` (≥1).
- `steps` = mêmes steps que les click-handlers de menu (`{kind:"action",action:{…}}` ou `{kind:"if",cases:[…],else:[…]}`). Vocab d'actions/conditions = le sous-ensemble autorisé (rappelé par `VOCAB`).
- Optionnels : `aliases`, `permission`, `description`, `arguments` (types `player|online_player|string|integer|number|boolean|world|enum`, `online_player` recommandé pour cibler un joueur connecté ; `world`/`enum` non importés par l'éditeur → préférer `string`), `requirements` (conditions ANDées), `fallback` (actions si requirements échouent), `cooldown`.
- Placeholders d'args : `%args_<name>%` dans les textes/commandes.
- Exemple complet (reprendre `pay-player.json` au format `steps`).
- Crée toujours via le tool `upsert_command` (jamais inventer du texte hors tool).

Créer `dialog-v1-authoring-guide.md` — structure miroir. Points clés :
- `dialog/v1` requiert `schema`, `id`, `title`, `buttons`. `title`/`label`/`body.text` = `{i18n:key}` ou littéral MiniMessage.
- `body[]` : `{type:"text",text}` | `{type:"item",material,count}`.
- `inputs[]` : `text` (`default`,`max_length`) | `bool` (`default:"true"|"false"`) | `number_range` (`min`,`max`,`default`) | `single_option` (`options:[{value,label}]`,`default`). Les valeurs saisies sont exposées comme args aux actions des boutons.
- `buttons[]` : `{id,label,actions:[…]}` — `actions` est une liste **plate** (pas de `if` dans un bouton de dialog). Vocab d'actions = le sous-ensemble autorisé.
- `can_close_with_escape` : ne mettre que si `false`.
- `open_dialog` (depuis un menu/commande) référence le `id` d'un dialog existant — utiliser `list_dialogs` pour le découvrir.
- Crée via `upsert_dialog`.

Dans `grounding.ts` — `buildSystemPrompt` inclut les deux fiches après le guide menu :

```ts
  return [
    ANTI_INJECTION,
    readGrounding("menu-v1-authoring-guide.md"),
    readGrounding("command-v1-authoring-guide.md"),
    readGrounding("dialog-v1-authoring-guide.md"),
    VOCAB,
    readGrounding("zmenu-reference.md"),
    readGrounding("deluxemenus-reference.md"),
  ].join("\n\n---\n\n");
```

Et étendre `ANTI_INJECTION` (2ᵉ ligne) pour mentionner que **menus, commandes et dialogs** se produisent exclusivement via tools (`upsert_menu`, `upsert_command`, `upsert_dialog`).

- [ ] **Step 4: Vérifier le vert**

Run: `cd backend && bun run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/assistant/grounding.ts backend/src/modules/assistant/grounding/command-v1-authoring-guide.md backend/src/modules/assistant/grounding/dialog-v1-authoring-guide.md backend/src/modules/assistant/grounding.test.ts
git commit -m "feat(backend): grounding guides for command/v1 and dialog/v1 authoring"
```

---

### Task 11: Backend — `routes.ts` reçoit commands + dialogs complets

**Files:**
- Modify: `backend/src/modules/assistant/routes.ts`
- Test: `backend/src/modules/assistant/routes.test.ts` (existant — y ajouter une assertion)

- [ ] **Step 1: Test (rouge)**

Lire `routes.test.ts` pour le harnais (provider de test injecté via `__setProviderForTests`, qui peut scripter un appel de tool). Ajouter un test où le provider de test demande `list_commands` et où le body POST contient une `commands: [...]`, vérifiant que le tool voit la commande. Squelette (adapter au fake provider existant) :

```ts
it("passes commands from the request body into the working copy", async () => {
  // fake provider qui appelle le tool list_commands puis termine
  __setProviderForTests(scriptedProvider([{ tool: "list_commands", args: {} }]));
  const events = await postMessageAndCollect(app, token, convId, {
    text: "list", commands: [{ schema: "command/v1", id: "heal", name: "heal", steps: [] }],
  });
  const toolEv = events.find((e) => e.type === "tool" && e.name === "list_commands");
  expect(toolEv?.detail ?? "").toContain("heal");
});
```

(Si le harnais existant n'expose pas `detail` du résultat de tool, mirror exactement la façon dont les tests menus vérifient `list_menus` — réutiliser le même mécanisme.)

- [ ] **Step 2: Vérifier l'échec**

Run: `cd backend && bun run test`
Expected: FAIL — `commands` non passées (WorkingCopy reçoit `[]`).

- [ ] **Step 3: Implémenter**

Dans `routes.ts`, handler `POST .../messages` : lire `commands` du body et passer dialogs complets + commands à la WorkingCopy.

```ts
const commands = Array.isArray((body as any).commands) ? (body as any).commands : [];
// dialogs sont désormais des objets dialog/v1 complets (plus des résumés)
const dialogs = Array.isArray((body as any).dialogs) ? (body as any).dialogs : [];
// …
const wc = new WorkingCopy(menus, attachments, dialogs, commands);
```

(L'ordre des args matche le nouveau constructeur : `menus, attachments, dialogs, commands`.)

- [ ] **Step 4: Vérifier le vert**

Run: `cd backend && bun run test`
Expected: PASS (suite complète backend).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/assistant/routes.ts backend/src/modules/assistant/routes.test.ts
git commit -m "feat(backend): assistant route accepts commands + full dialog objects"
```

---

### Task 12: Éditeur — wiring `AssistantChat` + API client

**Files:**
- Modify: `editor/src/lib/api/assistant.ts`
- Modify: `editor/src/features/assistant/AssistantChat.tsx`
- Test: `editor/src/features/assistant/AssistantChat.test.tsx` (existant — y ajouter)

- [ ] **Step 1: Test (rouge)**

Lire `AssistantChat.test.tsx` pour le pattern (il stub `streamAssistant` pour émettre des events et vérifie que le store est appelé). Ajouter :

```ts
it("applies a command_written event via applyAssistantCommand", async () => {
  // stub streamAssistant pour émettre un command_written
  mockStream([{ type: "command_written", command: { schema: "command/v1", id: "heal", name: "heal", steps: [] } }]);
  const spy = vi.spyOn(useAccountStore.getState(), "applyAssistantCommand");
  // … rendre + envoyer un message (mirror du test menu_written existant)
  await sendMessage("migrate");
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ packId, lang: expect.any(String), commandV1: expect.objectContaining({ id: "heal" }) }));
});

it("applies a dialog_written event via applyAssistantDialog", async () => {
  mockStream([{ type: "dialog_written", dialog: { schema: "dialog/v1", id: "d", title: "T", buttons: [] } }]);
  const spy = vi.spyOn(useAccountStore.getState(), "applyAssistantDialog");
  await sendMessage("migrate");
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ packId, dialogV1: expect.objectContaining({ id: "d" }) }));
});
```

(Adapter `mockStream`/`sendMessage` au harnais réel du fichier — réutiliser exactement le mécanisme du test `menu_written` existant.)

- [ ] **Step 2: Vérifier l'échec**

Run: `cd editor && npx vitest run src/features/assistant/AssistantChat.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

a) `lib/api/assistant.ts` — élargir le type du body de `streamAssistant` :

```ts
  body: {
    text: string;
    menus?: unknown[];
    attachments?: Record<string, string>;
    /** Full command/v1 objects (for get_command round-trip + editing). */
    commands?: unknown[];
    /** Full dialog/v1 objects (was summaries; now full for get_dialog/editing). */
    dialogs?: unknown[];
  },
```

b) `AssistantChat.tsx` — dans `send()` : importer `packToCommandV1`, `packToDialogV1` ; remplacer la collecte des dialogs résumés par les objets complets + ajouter les commandes :

```ts
import { packToCommandV1, packToDialogV1 } from "@/features/export/transform";
// …
const menus = pack ? packToMenuV1(pack) : [];
const commands = pack ? packToCommandV1(pack) : [];
const dialogs = pack ? packToDialogV1(pack) : [];
// …
for await (const ev of streamAssistant(token, convId.current, { text, menus, attachments, commands, dialogs })) {
```

c) Toujours dans la boucle d'events, après les branches `menu_written`/`menu_deleted`, ajouter :

```ts
        } else if (ev.type === "command_written") {
          const command = ev.command as Record<string, unknown>;
          const unsupported = useAccountStore.getState().applyAssistantCommand({ packId, commandV1: command, lang });
          if (unsupported.length > 0) {
            toast.warning(t("assistant.unsupportedDropped", { id: String(command.id), list: [...new Set(unsupported)].join(", ") }));
          }
          setEntries((e) => [...e, { role: "card", kind: "written", id: String(command.id) }]);
          dirty = true;
        } else if (ev.type === "command_deleted") {
          useAccountStore.getState().deleteFromPack({ packId, nodeIds: [String(ev.id)] });
          setEntries((e) => [...e, { role: "card", kind: "deleted", id: String(ev.id) }]);
          dirty = true;
        } else if (ev.type === "dialog_written") {
          const dialog = ev.dialog as Record<string, unknown>;
          const unsupported = useAccountStore.getState().applyAssistantDialog({ packId, dialogV1: dialog, lang });
          if (unsupported.length > 0) {
            toast.warning(t("assistant.unsupportedDropped", { id: String(dialog.id), list: [...new Set(unsupported)].join(", ") }));
          }
          setEntries((e) => [...e, { role: "card", kind: "written", id: String(dialog.id) }]);
          dirty = true;
        } else if (ev.type === "dialog_deleted") {
          useAccountStore.getState().deleteFromPack({ packId, nodeIds: [String(ev.id)] });
          setEntries((e) => [...e, { role: "card", kind: "deleted", id: String(ev.id) }]);
          dirty = true;
```

NB : `getText` n'est plus utilisé pour les dialogs résumés — si l'import devient inutilisé, le retirer (sinon lint). Vérifier que `deleteFromPack` accepte bien un id de commande/dialog (il prune menus/commands/dialogs par nodeId — déjà le cas, cf. canvasEdges pruning).

- [ ] **Step 4: Vérifier le vert + non-régression**

Run: `cd editor && npx vitest run src/features/assistant/ src/lib/api/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/lib/api/assistant.ts editor/src/features/assistant/AssistantChat.tsx editor/src/features/assistant/AssistantChat.test.tsx
git commit -m "feat(editor): assistant sends commands+dialogs and applies command/dialog events"
```

---

### Task 13: Docs + suites complètes

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: CHANGELOG**

Ajouter sous `## [Unreleased]` une entrée :

```markdown
### Added
- Assistant IA : support complet des commandes et dialogs (création/édition/suppression via tools `*_command` / `*_dialog`), en plus des menus. Migration zMenu/DeluxeMenus désormais bout-en-bout.

### Fixed
- Schéma `command/v1` aligné sur `steps` (avec branches `if`), cohérent avec l'éditeur, le backend et le runtime.
```

- [ ] **Step 2: Suites complètes**

```bash
cd editor && npm test
cd ../backend && bun run test   # JAMAIS bun test direct
```

Expected: tout vert (le flake connu `FullSyncIntegrationTest` côté plugin n'est pas concerné ; côté editor le flake `SignupForm` passe en isolation). Zéro régression liée à l'assistant.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): assistant commands + dialogs support"
```

---

## Couverture spec → tasks

| Exigence spec | Task |
|---|---|
| Réconciliation command/v1 sur `steps` (décision) | 1 |
| Convertisseur d'action partagé | 2 |
| `commandV1ToDomain` | 3 |
| `dialogV1ToDomain` | 4 |
| Export `serializeCommand/Dialog` + `packToCommandV1/DialogV1` | 5 |
| `applyAssistantCommand` / `applyAssistantDialog` | 6 |
| `validateCommandV1` / `validateDialogV1` + vocab | 7 |
| WorkingCopy commands + dialogs complets | 8 |
| Tools CRUD + EngineEvents | 9 |
| Grounding (2 fiches + anti-injection) | 10 |
| `routes.ts` reçoit commands + dialogs complets | 11 |
| Wiring `AssistantChat` + API client (envoi + 4 events) | 12 |
| CHANGELOG + suites | 13 |
