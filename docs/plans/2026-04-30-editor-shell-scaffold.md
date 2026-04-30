# Editor Shell Scaffold — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing `web/` proto with a fresh React + Vite scaffold that implements the 3-level workspace drag-and-drop shell (Account home → Pack canvas → Menu editor) on mocked data, no backend.

**Architecture:** SPA frontend only at v0. TanStack Router file-based routing for the 3 levels. Zustand stores (one per scope: account, pack canvas, menu draft) with `persist` middleware → localStorage. Pack hermeticity is an invariant enforced in a single domain helper consumed by every mutation. React Flow for the pack canvas, @dnd-kit for the home grid and menu editor palette. zundo wraps the menu draft store for undo/redo. No WS, no auth, no DB at v0.

**Tech Stack:** React 19, Vite 6, TypeScript strict (`noUncheckedIndexedAccess`), Tailwind v4, shadcn/ui, TanStack Router, Zustand + zundo, React Flow (`@xyflow/react`), @dnd-kit, React Hook Form + Zod, Vitest + Playwright, Biome.

**Reference spec:** [`docs/specs/editor-shell-scaffold.md`](../specs/editor-shell-scaffold.md). All section references below (§N) point there unless noted otherwise.

---

## Task 1: Bootstrap project

Wipe the existing proto and stand up an empty Vite + React + TS app with Tailwind v4 and Biome configured. End of task: `npm run dev` serves a placeholder home, `npm run build` succeeds, `npx biome check` passes.

**Files:**
- Delete: every file under `web/` (preserve `web/` itself only)
- Create: `web/package.json`, `web/index.html`, `web/vite.config.ts`, `web/tsconfig.json`, `web/tsconfig.node.json`, `web/biome.json`, `web/src/main.tsx`, `web/src/styles/globals.css`

- [ ] **Step 1: Wipe old proto**

```bash
rm -rf web/src web/node_modules web/package.json web/package-lock.json web/tsconfig.json web/tsconfig.tsbuildinfo web/vite.config.ts web/index.html
```

- [ ] **Step 2: Create `web/package.json`**

```json
{
  "name": "interfaze-editor",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest",
    "test:e2e": "playwright test",
    "lint": "biome check .",
    "lint:fix": "biome check --write ."
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "@tailwindcss/vite": "^4.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 3: Create `web/tsconfig.json`** (strict + path alias)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src", "tests"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 4: Create `web/tsconfig.node.json`** (for vite.config.ts)

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 5: Create `web/vite.config.ts`** (with Tailwind v4 plugin and `@/` alias)

```ts
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

- [ ] **Step 6: Create `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Interfaze</title>
  </head>
  <body class="bg-zinc-950 text-zinc-100">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Create `web/src/styles/globals.css`** (Tailwind v4 import + CSS reset)

```css
@import "tailwindcss";

:root {
  color-scheme: dark;
}

html,
body,
#root {
  height: 100%;
  margin: 0;
}

body {
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
```

- [ ] **Step 8: Create `web/src/main.tsx`** (placeholder render)

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="p-8 text-2xl font-semibold">Interfaze editor — bootstrapping</div>
  </StrictMode>,
);
```

- [ ] **Step 9: Create `web/biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "files": { "ignore": ["dist", "node_modules", "playwright-report", "test-results"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": { "noNonNullAssertion": "off" },
      "suspicious": { "noExplicitAny": "warn" }
    }
  },
  "javascript": { "formatter": { "quoteStyle": "double", "semicolons": "always" } }
}
```

- [ ] **Step 10: Install deps and verify build/dev**

```bash
cd web && npm install
npm run build
```

Expected: build completes without errors, `dist/` produced.

```bash
npx biome check .
```

Expected: passes (zero diagnostics) on the bootstrapped tree.

- [ ] **Step 11: Commit**

```bash
git add web/
git commit -m "chore(web): bootstrap vite + react 19 + tailwind v4 + biome"
```

---

## Task 2: Domain types

Define every entity from §2 of the spec as a TS type in a single source file with no React or runtime dependency. End of task: types compile, `Element` (not `Slot`) is the canonical name, every entity carries the IDs needed to enforce hermeticity.

**Files:**
- Create: `web/src/domain/types.ts`
- Create: `web/src/domain/types.test.ts`

- [ ] **Step 1: Install dev deps for tests**

```bash
cd web && npm install -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 2: Create `web/vitest.config.ts`**

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

- [ ] **Step 3: Create `web/tests/setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 4: Write `web/src/domain/types.ts`**

```ts
/**
 * Domain types for the Interfaze editor scaffold.
 *
 * - Pack is hermetic: every reference (open_menu, template_ref, i18n key) must
 *   target an entity in the same pack. Enforced by `assertPackHermetic` (see
 *   invariants.ts), not by these types.
 * - "Element" is the canonical name (per main-spec §8.1); the old "Slot" name
 *   from the prior proto is dropped.
 */

export type AccountId = string & { __brand: "AccountId" };
export type PackId = string & { __brand: "PackId" };
export type MenuId = string & { __brand: "MenuId" };
export type CommandId = string & { __brand: "CommandId" };
export type TemplateId = string & { __brand: "TemplateId" };
export type AssetId = string & { __brand: "AssetId" };
export type ElementId = string & { __brand: "ElementId" };
export type LayerId = string & { __brand: "LayerId" };
export type I18nKey = string & { __brand: "I18nKey" };

export type PackSource = "user_created" | "imported" | "forked";

export interface Account {
  id: AccountId;
  packs: Pack[];
  packOrder: PackId[];
}

export interface Pack {
  id: PackId;
  name: string;
  description?: string;
  source: PackSource;
  sourcePackId?: PackId;
  sourceVersion?: string;
  createdAt: string;
  updatedAt: string;
  menus: Menu[];
  commands: Command[];
  templates: Template[];
  assets: Asset[];
  i18nKeys: Record<I18nKey, Record<string, string>>;
  defaultLang: string;
  canvasLayout: Record<MenuId | CommandId, { x: number; y: number }>;
}

export interface Menu {
  id: MenuId;
  packId: PackId;
  title: string;
  rows: 1 | 2 | 3 | 4 | 5 | 6;
  permission?: string;
  background?: { assetId: AssetId };
  layers: Layer[];
}

export interface Layer {
  id: LayerId;
  name: string;
  elements: Element[];
}

export interface Element {
  id: ElementId;
  positions: string;
  appearances: Appearance[];
  templateRef?: { id: TemplateId; vars: Record<string, string> };
  tags?: string[];
}

export interface Appearance {
  if?: Condition[];
  assetId?: AssetId;
  material?: string;
  count?: number;
  title?: string;
  lore?: string[];
  click?: ClickMap;
}

export type ClickType = "left" | "right" | "shift_left" | "shift_right" | "middle";
export type ClickMap = Partial<Record<ClickType, ClickHandler>>;

export interface ClickHandler {
  requirements?: Condition[];
  actions: Action[];
  fallback?: Action[];
}

export type Action =
  | { type: "open_menu"; menuId: MenuId; clearContext?: boolean }
  | { type: "close_menu" }
  | { type: "run_command"; command: string; as: "player" | "console" }
  | { type: "send_message"; text: string }
  | { type: "give_item"; material: string; count: number }
  | { type: "take_money"; amount: number };

export type Condition =
  | { type: "has_permission"; perm: string }
  | { type: "has_money"; amount: number }
  | { type: "not"; of: Condition };

export interface Command {
  id: CommandId;
  packId: PackId;
  name: string;
  aliases?: string[];
  permission?: string;
  description?: string;
  arguments: CommandArg[];
  actions: Action[];
}

export interface CommandArg {
  name: string;
  type: "player" | "string" | "integer" | "number" | "boolean";
  required: boolean;
  default?: string;
}

export interface Template {
  id: TemplateId;
  packId: PackId;
  name: string;
  variables: { name: string; type: string }[];
  appearances: Appearance[];
}

export interface Asset {
  id: AssetId;
  packId: PackId;
  name: string;
  url: string;
  width: number;
  height: number;
}
```

- [ ] **Step 5: Write `web/src/domain/types.test.ts`** (compile-time spot check)

```ts
import { describe, expect, it } from "vitest";
import type { Account, Pack, Menu, Element, Action } from "./types";

describe("domain types — compile-time shape", () => {
  it("an Account composes Packs", () => {
    const account: Account = {
      id: "acc_1" as Account["id"],
      packs: [],
      packOrder: [],
    };
    expect(account.packs).toHaveLength(0);
  });

  it("an open_menu Action carries a MenuId", () => {
    const a: Action = { type: "open_menu", menuId: "m_1" as Menu["id"] };
    expect(a.type).toBe("open_menu");
  });

  it("an Element holds a non-empty appearances list at runtime (type allows empty, invariant enforced separately)", () => {
    const el: Element = {
      id: "el_1" as Element["id"],
      positions: "0",
      appearances: [{ material: "DIAMOND" }],
    };
    expect(el.appearances).toHaveLength(1);
  });

  it("a Pack carries i18n keys scoped to itself", () => {
    const pack: Pack = {
      id: "p_1" as Pack["id"],
      name: "Personal",
      source: "user_created",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      menus: [],
      commands: [],
      templates: [],
      assets: [],
      i18nKeys: { ["greeting" as Pack["i18nKeys"] extends Record<infer K, unknown> ? K : never]: { en: "Hi" } },
      defaultLang: "en",
      canvasLayout: {},
    };
    expect(pack.defaultLang).toBe("en");
  });
});
```

- [ ] **Step 6: Run tests**

```bash
cd web && npm run test -- --run
```

Expected: 4 passing tests.

- [ ] **Step 7: Commit**

```bash
git add web/
git commit -m "feat(domain): define Account/Pack/Menu/Element type tree"
```

---

## Task 3: Pack hermetic invariant

Write the validator that rejects cross-pack references. This is the single source of truth invoked by every mutation in later tasks.

**Files:**
- Create: `web/src/domain/invariants.ts`
- Create: `web/src/domain/invariants.test.ts`

- [ ] **Step 1: Write the failing test `web/src/domain/invariants.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { assertPackHermetic } from "./invariants";
import type { Pack } from "./types";

const basePack = (overrides: Partial<Pack> = {}): Pack => ({
  id: "p_1" as Pack["id"],
  name: "Test",
  source: "user_created",
  createdAt: "2026-04-30T00:00:00Z",
  updatedAt: "2026-04-30T00:00:00Z",
  menus: [],
  commands: [],
  templates: [],
  assets: [],
  i18nKeys: {},
  defaultLang: "en",
  canvasLayout: {},
  ...overrides,
});

describe("assertPackHermetic", () => {
  it("accepts an empty pack", () => {
    expect(() => assertPackHermetic(basePack())).not.toThrow();
  });

  it("rejects an open_menu action targeting a menu outside the pack", () => {
    const pack = basePack({
      menus: [
        {
          id: "m_inside" as never,
          packId: "p_1" as Pack["id"],
          title: "Inside",
          rows: 3,
          layers: [
            {
              id: "l1" as never,
              name: "default",
              elements: [
                {
                  id: "el1" as never,
                  positions: "0",
                  appearances: [
                    {
                      click: {
                        left: {
                          actions: [{ type: "open_menu", menuId: "m_outside" as never }],
                        },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(() => assertPackHermetic(pack)).toThrow(/cross-pack open_menu/);
  });

  it("rejects a templateRef pointing to a template outside the pack", () => {
    const pack = basePack({
      menus: [
        {
          id: "m1" as never,
          packId: "p_1" as Pack["id"],
          title: "M",
          rows: 3,
          layers: [
            {
              id: "l1" as never,
              name: "default",
              elements: [
                {
                  id: "el1" as never,
                  positions: "0",
                  appearances: [{}],
                  templateRef: { id: "tpl_outside" as never, vars: {} },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(() => assertPackHermetic(pack)).toThrow(/cross-pack template_ref/);
  });

  it("accepts a templateRef pointing to a template inside the pack", () => {
    const pack = basePack({
      templates: [
        {
          id: "tpl_inside" as never,
          packId: "p_1" as Pack["id"],
          name: "T",
          variables: [],
          appearances: [{}],
        },
      ],
      menus: [
        {
          id: "m1" as never,
          packId: "p_1" as Pack["id"],
          title: "M",
          rows: 3,
          layers: [
            {
              id: "l1" as never,
              name: "default",
              elements: [
                {
                  id: "el1" as never,
                  positions: "0",
                  appearances: [{}],
                  templateRef: { id: "tpl_inside" as never, vars: {} },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(() => assertPackHermetic(pack)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
cd web && npm run test -- --run invariants
```

Expected: 4 failing (`assertPackHermetic` not exported).

- [ ] **Step 3: Implement `web/src/domain/invariants.ts`**

```ts
import type { Action, Appearance, Element, MenuId, Pack, TemplateId } from "./types";

/** Throws if the pack contains any reference crossing its own boundary. */
export function assertPackHermetic(pack: Pack): void {
  const menuIds = new Set<MenuId>(pack.menus.map((m) => m.id));
  const templateIds = new Set<TemplateId>(pack.templates.map((t) => t.id));

  for (const menu of pack.menus) {
    for (const layer of menu.layers) {
      for (const el of layer.elements) {
        checkElement(el, menuIds, templateIds);
      }
    }
  }

  for (const cmd of pack.commands) {
    for (const action of cmd.actions) {
      checkAction(action, menuIds);
    }
  }
}

function checkElement(el: Element, menuIds: Set<MenuId>, templateIds: Set<TemplateId>): void {
  if (el.templateRef && !templateIds.has(el.templateRef.id)) {
    throw new Error(`cross-pack template_ref: ${el.templateRef.id} not in pack`);
  }
  for (const appearance of el.appearances) {
    checkAppearance(appearance, menuIds);
  }
}

function checkAppearance(appearance: Appearance, menuIds: Set<MenuId>): void {
  if (!appearance.click) return;
  for (const handler of Object.values(appearance.click)) {
    if (!handler) continue;
    for (const action of handler.actions) checkAction(action, menuIds);
    if (handler.fallback) for (const action of handler.fallback) checkAction(action, menuIds);
  }
}

function checkAction(action: Action, menuIds: Set<MenuId>): void {
  if (action.type === "open_menu" && !menuIds.has(action.menuId)) {
    throw new Error(`cross-pack open_menu: ${action.menuId} not in pack`);
  }
}
```

- [ ] **Step 4: Run tests, verify all pass**

```bash
cd web && npm run test -- --run invariants
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add web/
git commit -m "feat(domain): enforce pack hermetic invariant via assertPackHermetic"
```

---

## Task 4: Mock fixtures

Build a realistic in-memory `Account` with 3 packs and 10ish menus, used as the seed of the account store. The fixture must satisfy `assertPackHermetic` for every pack — the test enforces it.

**Files:**
- Create: `web/src/mock/fixtures.ts`
- Create: `web/src/mock/fixtures.test.ts`
- Create: `web/src/domain/ids.ts`

- [ ] **Step 1: Create id helpers `web/src/domain/ids.ts`**

```ts
import type { AccountId, AssetId, CommandId, ElementId, LayerId, MenuId, PackId, TemplateId } from "./types";

let counter = 0;
const next = () => ++counter;

export const accountId = (s: string): AccountId => s as AccountId;
export const packId = (s: string): PackId => s as PackId;
export const menuId = (s: string): MenuId => s as MenuId;
export const commandId = (s: string): CommandId => s as CommandId;
export const templateId = (s: string): TemplateId => s as TemplateId;
export const assetId = (s: string): AssetId => s as AssetId;
export const elementId = (s: string): ElementId => s as ElementId;
export const layerId = (s: string): LayerId => s as LayerId;

export const newPackId = () => packId(`p_${next()}_${Date.now().toString(36)}`);
export const newMenuId = () => menuId(`m_${next()}_${Date.now().toString(36)}`);
export const newElementId = () => elementId(`el_${next()}_${Date.now().toString(36)}`);
export const newLayerId = () => layerId(`l_${next()}_${Date.now().toString(36)}`);
export const newCommandId = () => commandId(`c_${next()}_${Date.now().toString(36)}`);
```

- [ ] **Step 2: Create fixture `web/src/mock/fixtures.ts`**

```ts
import { accountId, commandId, elementId, layerId, menuId, packId } from "@/domain/ids";
import type { Account, Pack } from "@/domain/types";

const ts = "2026-04-30T10:00:00Z";

const personalPack = (): Pack => {
  const shopMainId = menuId("m_shop_main");
  const profileId = menuId("m_profile");
  const healCmdId = commandId("c_heal");

  return {
    id: packId("p_personal"),
    name: "Personal",
    description: "Default workspace",
    source: "user_created",
    createdAt: ts,
    updatedAt: ts,
    defaultLang: "en",
    i18nKeys: { ["greeting" as never]: { en: "Welcome" } },
    assets: [],
    templates: [],
    canvasLayout: {
      [shopMainId]: { x: 60, y: 80 },
      [profileId]: { x: 320, y: 200 },
      [healCmdId]: { x: 540, y: 80 },
    },
    menus: [
      {
        id: shopMainId,
        packId: packId("p_personal"),
        title: "Shop principal",
        rows: 3,
        layers: [
          {
            id: layerId("l_default"),
            name: "default",
            elements: [
              {
                id: elementId("el_btn_profile"),
                positions: "13",
                appearances: [
                  {
                    material: "PAPER",
                    title: "Profil",
                    click: { left: { actions: [{ type: "open_menu", menuId: profileId }] } },
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: profileId,
        packId: packId("p_personal"),
        title: "Profil",
        rows: 3,
        layers: [
          { id: layerId("l_default_2"), name: "default", elements: [] },
        ],
      },
    ],
    commands: [
      {
        id: healCmdId,
        packId: packId("p_personal"),
        name: "heal",
        permission: "interfaze.heal",
        arguments: [],
        actions: [{ type: "send_message", text: "Healed!" }],
      },
    ],
  };
};

const shopSystemPack = (): Pack => ({
  id: packId("p_shop_system"),
  name: "Shop System",
  description: "Multi-category shop with VIP rank",
  source: "user_created",
  createdAt: ts,
  updatedAt: ts,
  defaultLang: "en",
  i18nKeys: {},
  assets: [],
  templates: [],
  canvasLayout: {},
  menus: [
    {
      id: menuId("m_shop_root"),
      packId: packId("p_shop_system"),
      title: "Shop",
      rows: 6,
      layers: [{ id: layerId("l_def_3"), name: "default", elements: [] }],
    },
    {
      id: menuId("m_cat_armors"),
      packId: packId("p_shop_system"),
      title: "Armors",
      rows: 6,
      layers: [{ id: layerId("l_def_4"), name: "default", elements: [] }],
    },
    {
      id: menuId("m_cat_weapons"),
      packId: packId("p_shop_system"),
      title: "Weapons",
      rows: 6,
      layers: [{ id: layerId("l_def_5"), name: "default", elements: [] }],
    },
  ],
  commands: [
    {
      id: commandId("c_shop"),
      packId: packId("p_shop_system"),
      name: "shop",
      arguments: [],
      actions: [{ type: "open_menu", menuId: menuId("m_shop_root") }],
    },
  ],
});

const dailyQuestsPack = (): Pack => ({
  id: packId("p_daily_quests"),
  name: "Daily Quests",
  description: "Imported pack from @creator-x",
  source: "imported",
  sourcePackId: packId("p_remote_daily"),
  sourceVersion: "2.1.0",
  createdAt: ts,
  updatedAt: ts,
  defaultLang: "en",
  i18nKeys: {},
  assets: [],
  templates: [],
  canvasLayout: {},
  menus: [
    {
      id: menuId("m_quests_main"),
      packId: packId("p_daily_quests"),
      title: "Daily Quests",
      rows: 6,
      layers: [{ id: layerId("l_def_6"), name: "default", elements: [] }],
    },
  ],
  commands: [],
});

export const mockAccount = (): Account => ({
  id: accountId("acc_local"),
  packs: [personalPack(), shopSystemPack(), dailyQuestsPack()],
  packOrder: [packId("p_personal"), packId("p_shop_system"), packId("p_daily_quests")],
});
```

- [ ] **Step 3: Write failing test `web/src/mock/fixtures.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { assertPackHermetic } from "@/domain/invariants";
import { mockAccount } from "./fixtures";

describe("mockAccount fixture", () => {
  it("contains three packs in order", () => {
    const account = mockAccount();
    expect(account.packs).toHaveLength(3);
    expect(account.packs.map((p) => p.name)).toEqual(["Personal", "Shop System", "Daily Quests"]);
  });

  it("every pack passes the hermetic invariant", () => {
    for (const pack of mockAccount().packs) {
      expect(() => assertPackHermetic(pack), `pack ${pack.name}`).not.toThrow();
    }
  });
});
```

- [ ] **Step 4: Run tests**

```bash
cd web && npm run test -- --run fixtures
```

Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add web/
git commit -m "feat(mock): seed account with three packs satisfying hermetic invariant"
```

---

## Task 5: Account store

Single Zustand store holding the account, with mutations: create pack, reorder packs, move menu cross-pack, delete pack. `persist` middleware writes to localStorage. Every mutation that touches a pack revalidates with `assertPackHermetic`.

**Files:**
- Create: `web/src/state/accountStore.ts`
- Create: `web/src/state/accountStore.test.ts`

- [ ] **Step 1: Install state deps**

```bash
cd web && npm install zustand zundo immer
```

- [ ] **Step 2: Write failing test `web/src/state/accountStore.test.ts`**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useAccountStore } from "./accountStore";
import { mockAccount } from "@/mock/fixtures";
import { menuId, packId } from "@/domain/ids";

describe("accountStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useAccountStore.setState({ account: mockAccount() }, true);
  });

  it("starts with the seed account", () => {
    expect(useAccountStore.getState().account.packs).toHaveLength(3);
  });

  it("createPack appends to packs and packOrder", () => {
    useAccountStore.getState().createPack({ name: "New Pack" });
    const a = useAccountStore.getState().account;
    expect(a.packs).toHaveLength(4);
    expect(a.packOrder).toHaveLength(4);
    expect(a.packs[3]!.name).toBe("New Pack");
  });

  it("reorderPacks rewrites packOrder", () => {
    const original = useAccountStore.getState().account.packOrder;
    const reversed = [...original].reverse();
    useAccountStore.getState().reorderPacks(reversed);
    expect(useAccountStore.getState().account.packOrder).toEqual(reversed);
  });

  it("moveMenuToPack moves the menu and keeps packs hermetic", () => {
    const fromId = packId("p_personal");
    const toId = packId("p_shop_system");
    const menuToMove = menuId("m_profile");

    useAccountStore.getState().moveMenuToPack({ menuId: menuToMove, fromPackId: fromId, toPackId: toId });

    const a = useAccountStore.getState().account;
    const from = a.packs.find((p) => p.id === fromId)!;
    const to = a.packs.find((p) => p.id === toId)!;
    expect(from.menus.some((m) => m.id === menuToMove)).toBe(false);
    expect(to.menus.some((m) => m.id === menuToMove)).toBe(true);
    expect(to.menus.find((m) => m.id === menuToMove)!.packId).toBe(toId);
  });

  it("moveMenuToPack rejects when destination would break hermeticity", () => {
    const fromId = packId("p_personal");
    const toId = packId("p_shop_system");
    const sourceMenu = menuId("m_shop_main");

    expect(() =>
      useAccountStore.getState().moveMenuToPack({ menuId: sourceMenu, fromPackId: fromId, toPackId: toId }),
    ).toThrow(/cross-pack open_menu/);

    // State unchanged after failed move
    const a = useAccountStore.getState().account;
    expect(a.packs.find((p) => p.id === fromId)!.menus.some((m) => m.id === sourceMenu)).toBe(true);
  });
});
```

- [ ] **Step 3: Run, verify fail**

```bash
cd web && npm run test -- --run accountStore
```

Expected: failures (`accountStore` not yet implemented).

- [ ] **Step 4: Implement `web/src/state/accountStore.ts`**

```ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { produce } from "immer";
import type { Account, MenuId, PackId } from "@/domain/types";
import { newPackId } from "@/domain/ids";
import { assertPackHermetic } from "@/domain/invariants";
import { mockAccount } from "@/mock/fixtures";

interface AccountState {
  account: Account;
  createPack: (input: { name: string; description?: string }) => void;
  reorderPacks: (newOrder: PackId[]) => void;
  moveMenuToPack: (input: { menuId: MenuId; fromPackId: PackId; toPackId: PackId }) => void;
}

export const useAccountStore = create<AccountState>()(
  persist(
    (set, get) => ({
      account: mockAccount(),
      createPack: ({ name, description }) =>
        set(
          produce((draft: AccountState) => {
            const id = newPackId();
            draft.account.packs.push({
              id,
              name,
              description,
              source: "user_created",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              menus: [],
              commands: [],
              templates: [],
              assets: [],
              i18nKeys: {},
              defaultLang: "en",
              canvasLayout: {},
            });
            draft.account.packOrder.push(id);
          }),
        ),
      reorderPacks: (newOrder) =>
        set(
          produce((draft: AccountState) => {
            draft.account.packOrder = [...newOrder];
          }),
        ),
      moveMenuToPack: ({ menuId: mId, fromPackId, toPackId }) => {
        const next = produce(get().account, (draft) => {
          const from = draft.packs.find((p) => p.id === fromPackId);
          const to = draft.packs.find((p) => p.id === toPackId);
          if (!from || !to) throw new Error("pack not found");
          const idx = from.menus.findIndex((m) => m.id === mId);
          if (idx === -1) throw new Error("menu not found in source pack");
          const [moved] = from.menus.splice(idx, 1);
          if (!moved) return;
          moved.packId = toPackId;
          to.menus.push(moved);
        });
        // Validate before committing.
        const fromAfter = next.packs.find((p) => p.id === fromPackId)!;
        const toAfter = next.packs.find((p) => p.id === toPackId)!;
        assertPackHermetic(fromAfter);
        assertPackHermetic(toAfter);
        set({ account: next });
      },
    }),
    { name: "interfaze:account" },
  ),
);
```

- [ ] **Step 5: Run tests, verify pass**

```bash
cd web && npm run test -- --run accountStore
```

Expected: 5 passing.

- [ ] **Step 6: Commit**

```bash
git add web/
git commit -m "feat(state): account store with persist + hermetic-checked moveMenuToPack"
```

---

## Task 6: shadcn primitives + design tokens

Wire shadcn so we can use real Button / Card / Dialog. Configure tokens for the dark theme.

**Files:**
- Create: `web/components.json`
- Create: `web/src/lib/cx.ts`
- Modify: `web/src/styles/globals.css` (add tokens)
- Generated: `web/src/components/ui/button.tsx`, `web/src/components/ui/card.tsx`, `web/src/components/ui/dialog.tsx`, `web/src/components/ui/input.tsx`

- [ ] **Step 1: Create `web/src/lib/cx.ts`**

```ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cx(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 2: Install shadcn deps**

```bash
cd web && npm install clsx tailwind-merge class-variance-authority lucide-react @radix-ui/react-dialog @radix-ui/react-slot
```

- [ ] **Step 3: Create `web/components.json`**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/styles/globals.css",
    "baseColor": "zinc",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/cx",
    "ui": "@/components/ui"
  }
}
```

- [ ] **Step 4: Replace `web/src/styles/globals.css` with token-aware Tailwind v4 setup**

```css
@import "tailwindcss";

@theme {
  --color-bg: oklch(0.14 0 0);
  --color-bg-1: oklch(0.18 0 0);
  --color-bg-2: oklch(0.22 0 0);
  --color-fg: oklch(0.95 0 0);
  --color-fg-muted: oklch(0.65 0 0);
  --color-border: oklch(0.28 0 0);
  --color-accent: oklch(0.74 0.16 142);
  --color-warning: oklch(0.74 0.16 60);
  --radius-card: 0.5rem;
}

:root {
  color-scheme: dark;
}

html,
body,
#root {
  height: 100%;
  margin: 0;
  background: var(--color-bg);
  color: var(--color-fg);
}

body {
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
```

- [ ] **Step 5: Generate shadcn primitives**

```bash
cd web && npx shadcn@latest add button card dialog input --yes
```

Expected: files added under `web/src/components/ui/`. Accept the prompts using defaults.

- [ ] **Step 6: Smoke test render in `web/src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button";
import "./styles/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="p-8 flex flex-col gap-3">
      <h1 className="text-2xl font-semibold">Interfaze editor</h1>
      <Button variant="default">Smoke test</Button>
    </div>
  </StrictMode>,
);
```

- [ ] **Step 7: Verify dev build**

```bash
cd web && npm run build
```

Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add web/
git commit -m "chore(ui): wire shadcn primitives + dark theme tokens"
```

---

## Task 7: TanStack Router skeleton

Set up file-based routing with three empty routes. Verify navigation by clicking from a placeholder home into a pack and back.

**Files:**
- Create: `web/src/routes/__root.tsx`, `web/src/routes/index.tsx`, `web/src/routes/pack.$packId.tsx`, `web/src/routes/pack.$packId.menu.$menuId.tsx`
- Modify: `web/src/main.tsx`, `web/vite.config.ts`
- Generated: `web/src/routeTree.gen.ts`

- [ ] **Step 1: Install router deps**

```bash
cd web && npm install @tanstack/react-router
npm install -D @tanstack/router-plugin
```

- [ ] **Step 2: Update `web/vite.config.ts` to register the router plugin**

```ts
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

export default defineConfig({
  plugins: [TanStackRouterVite(), react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

- [ ] **Step 3: Create root route `web/src/routes/__root.tsx`**

```tsx
import { Outlet, createRootRoute } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => (
    <div className="h-full">
      <Outlet />
    </div>
  ),
});
```

- [ ] **Step 4: Create index route `web/src/routes/index.tsx`** (placeholder)

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: AccountHomePage,
});

function AccountHomePage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold mb-4">Account home (placeholder)</h1>
      <Link to="/pack/$packId" params={{ packId: "p_personal" }} className="underline">
        Go to Personal
      </Link>
    </div>
  );
}
```

- [ ] **Step 5: Create pack route `web/src/routes/pack.$packId.tsx`**

```tsx
import { createFileRoute, Link, useParams } from "@tanstack/react-router";

export const Route = createFileRoute("/pack/$packId")({
  component: PackCanvasPage,
});

function PackCanvasPage() {
  const { packId } = useParams({ from: "/pack/$packId" });
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold mb-4">Pack: {packId}</h1>
      <Link to="/" className="underline">
        ← back
      </Link>
      <div className="mt-4">
        <Link to="/pack/$packId/menu/$menuId" params={{ packId, menuId: "m_profile" }} className="underline">
          Open profile menu
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create menu route `web/src/routes/pack.$packId.menu.$menuId.tsx`**

```tsx
import { createFileRoute, Link, useParams } from "@tanstack/react-router";

export const Route = createFileRoute("/pack/$packId/menu/$menuId")({
  component: MenuEditorPage,
});

function MenuEditorPage() {
  const { packId, menuId } = useParams({ from: "/pack/$packId/menu/$menuId" });
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold mb-4">Menu editor: {menuId}</h1>
      <Link to="/pack/$packId" params={{ packId }} className="underline">
        ← back to pack
      </Link>
    </div>
  );
}
```

- [ ] **Step 7: Replace `web/src/main.tsx`** to render the router

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import "./styles/globals.css";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
```

- [ ] **Step 8: Run dev once to generate route tree, then verify build**

```bash
cd web && npm run dev
```

Open http://localhost:5173 — verify 3 levels navigate. Stop the dev server.

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 9: Commit**

```bash
git add web/
git commit -m "feat(routes): three-level TanStack Router skeleton"
```

---

## Task 8: Account home (Niveau 1)

Replace the placeholder at `/` with a real grid of pack cards driven by the account store. Wire @dnd-kit Sortable for reordering. Each card links into the pack canvas.

**Files:**
- Modify: `web/src/routes/index.tsx`
- Create: `web/src/features/account/PackGrid.tsx`, `web/src/features/account/PackCard.tsx`, `web/src/features/account/NewPackDialog.tsx`
- Create: `web/src/features/account/PackGrid.test.tsx`

- [ ] **Step 1: Install @dnd-kit**

```bash
cd web && npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

- [ ] **Step 2: Create `web/src/features/account/PackCard.tsx`**

```tsx
import { Link } from "@tanstack/react-router";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Pack } from "@/domain/types";

interface PackCardProps {
  pack: Pack;
}

export function PackCard({ pack }: PackCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: pack.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const sourceLabel = pack.source === "imported" ? "imported" : pack.source === "forked" ? "forked" : "user";
  const sourceColor =
    pack.source === "imported"
      ? "bg-blue-500/15 text-blue-300"
      : pack.source === "forked"
        ? "bg-amber-500/15 text-amber-300"
        : "bg-emerald-500/15 text-emerald-300";

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} data-testid={`pack-card-${pack.id}`}>
      <Link to="/pack/$packId" params={{ packId: pack.id }}>
        <Card className="hover:border-emerald-600 transition-colors cursor-pointer">
          <CardHeader>
            <CardTitle className="text-base font-mono flex items-center gap-2">
              {pack.name}
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${sourceColor}`}>{sourceLabel}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-zinc-400">
            {pack.menus.length} menus · {pack.commands.length} cmds
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
```

- [ ] **Step 3: Create `web/src/features/account/NewPackDialog.tsx`**

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAccountStore } from "@/state/accountStore";

export function NewPackDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const createPack = useAccountStore((s) => s.createPack);

  const submit = () => {
    if (!name.trim()) return;
    createPack({ name: name.trim() });
    setName("");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">+ New pack</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New pack</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            placeholder="Pack name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit}>Create</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Create `web/src/features/account/PackGrid.tsx`**

```tsx
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import { useAccountStore } from "@/state/accountStore";
import type { PackId } from "@/domain/types";
import { PackCard } from "./PackCard";
import { NewPackDialog } from "./NewPackDialog";

export function PackGrid() {
  const account = useAccountStore((s) => s.account);
  const reorderPacks = useAccountStore((s) => s.reorderPacks);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const orderedPacks = account.packOrder
    .map((id) => account.packs.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = account.packOrder.indexOf(active.id as PackId);
    const newIndex = account.packOrder.indexOf(over.id as PackId);
    reorderPacks(arrayMove(account.packOrder, oldIndex, newIndex));
  };

  return (
    <div className="p-8">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Packs</h1>
        <NewPackDialog />
      </header>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={account.packOrder} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {orderedPacks.map((pack) => (
              <PackCard key={pack.id} pack={pack} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
```

- [ ] **Step 5: Replace `web/src/routes/index.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { PackGrid } from "@/features/account/PackGrid";

export const Route = createFileRoute("/")({
  component: PackGrid,
});
```

- [ ] **Step 6: Write component test `web/src/features/account/PackGrid.test.tsx`**

```tsx
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { PackGrid } from "./PackGrid";
import { useAccountStore } from "@/state/accountStore";
import { mockAccount } from "@/mock/fixtures";

const renderWithRouter = () => {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: PackGrid });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(<RouterProvider router={router} />);
};

describe("<PackGrid />", () => {
  beforeEach(() => {
    localStorage.clear();
    useAccountStore.setState({ account: mockAccount() }, true);
  });

  it("renders a card per seed pack", () => {
    renderWithRouter();
    expect(screen.getByText("Personal")).toBeInTheDocument();
    expect(screen.getByText("Shop System")).toBeInTheDocument();
    expect(screen.getByText("Daily Quests")).toBeInTheDocument();
  });

  it("shows the New pack button", () => {
    renderWithRouter();
    expect(screen.getByText("+ New pack")).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run tests**

```bash
cd web && npm run test -- --run PackGrid
```

Expected: 2 passing.

- [ ] **Step 8: Commit**

```bash
git add web/
git commit -m "feat(account): pack grid home with reorder DnD and new pack dialog"
```

---

## Task 9: Pack canvas (Niveau 2)

Replace the pack route placeholder with a React Flow canvas. Menu nodes and command nodes are rendered, edges are derived from `open_menu` actions, positions persist per pack via the account store's `canvasLayout`.

**Files:**
- Modify: `web/src/routes/pack.$packId.tsx`
- Create: `web/src/features/pack-canvas/Canvas.tsx`, `web/src/features/pack-canvas/nodes/MenuNode.tsx`, `web/src/features/pack-canvas/nodes/CommandNode.tsx`, `web/src/features/pack-canvas/deriveEdges.ts`, `web/src/features/pack-canvas/autoLayout.ts`
- Create: `web/src/features/pack-canvas/deriveEdges.test.ts`
- Modify: `web/src/state/accountStore.ts` (add `setCanvasPosition`)

- [ ] **Step 1: Install React Flow**

```bash
cd web && npm install @xyflow/react
```

- [ ] **Step 2: Write failing test `web/src/features/pack-canvas/deriveEdges.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { deriveEdges } from "./deriveEdges";
import { mockAccount } from "@/mock/fixtures";
import { packId } from "@/domain/ids";

describe("deriveEdges", () => {
  it("emits an edge for each open_menu action found in the pack", () => {
    const personal = mockAccount().packs.find((p) => p.id === packId("p_personal"))!;
    const edges = deriveEdges(personal);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: "m_shop_main", target: "m_profile" });
  });

  it("emits a command→menu edge when a command opens a menu", () => {
    const shop = mockAccount().packs.find((p) => p.id === packId("p_shop_system"))!;
    const edges = deriveEdges(shop);
    expect(edges.find((e) => e.source === "c_shop" && e.target === "m_shop_root")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Implement `web/src/features/pack-canvas/deriveEdges.ts`**

```ts
import type { Edge } from "@xyflow/react";
import type { Pack } from "@/domain/types";

export function deriveEdges(pack: Pack): Edge[] {
  const edges: Edge[] = [];
  const seen = new Set<string>();

  const push = (source: string, target: string) => {
    const id = `${source}->${target}`;
    if (seen.has(id)) return;
    seen.add(id);
    edges.push({ id, source, target, animated: false });
  };

  for (const menu of pack.menus) {
    for (const layer of menu.layers) {
      for (const el of layer.elements) {
        for (const appearance of el.appearances) {
          if (!appearance.click) continue;
          for (const handler of Object.values(appearance.click)) {
            if (!handler) continue;
            for (const action of [...handler.actions, ...(handler.fallback ?? [])]) {
              if (action.type === "open_menu") push(menu.id, action.menuId);
            }
          }
        }
      }
    }
  }

  for (const cmd of pack.commands) {
    for (const action of cmd.actions) {
      if (action.type === "open_menu") push(cmd.id, action.menuId);
    }
  }

  return edges;
}
```

- [ ] **Step 4: Run, verify pass**

```bash
cd web && npm run test -- --run deriveEdges
```

Expected: 2 passing.

- [ ] **Step 5: Implement `web/src/features/pack-canvas/autoLayout.ts`** (deterministic grid fallback)

```ts
import type { Pack } from "@/domain/types";

/** Deterministic auto-layout: lays nodes out in a grid for any node missing a saved position. */
export function autoLayout(pack: Pack): Record<string, { x: number; y: number }> {
  const layout: Record<string, { x: number; y: number }> = { ...pack.canvasLayout };
  const cellW = 220;
  const cellH = 160;
  const cols = 4;
  const ids = [...pack.menus.map((m) => m.id), ...pack.commands.map((c) => c.id)];
  let i = 0;
  for (const id of ids) {
    if (layout[id]) continue;
    const x = (i % cols) * cellW + 40;
    const y = Math.floor(i / cols) * cellH + 40;
    layout[id] = { x, y };
    i++;
  }
  return layout;
}
```

- [ ] **Step 6: Implement `web/src/features/pack-canvas/nodes/MenuNode.tsx`**

```tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Link } from "@tanstack/react-router";
import type { Menu, PackId } from "@/domain/types";

export interface MenuNodeData extends Record<string, unknown> {
  menu: Menu;
  packId: PackId;
}

export function MenuNode({ data }: NodeProps<{ data: MenuNodeData; type: "menu" }>) {
  const { menu, packId } = data;
  return (
    <div className="bg-zinc-800 border border-zinc-600 rounded-md p-2 min-w-[140px]">
      <Handle type="target" position={Position.Left} className="!bg-zinc-500" />
      <Link
        to="/pack/$packId/menu/$menuId"
        params={{ packId, menuId: menu.id }}
        className="block"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-xs font-mono text-zinc-200 font-semibold mb-1">{menu.title}</div>
        <div className="text-[10px] text-zinc-500">
          {menu.id} · {menu.rows}×9
        </div>
      </Link>
      <Handle type="source" position={Position.Right} className="!bg-zinc-500" />
    </div>
  );
}
```

- [ ] **Step 7: Implement `web/src/features/pack-canvas/nodes/CommandNode.tsx`**

```tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Command } from "@/domain/types";

export interface CommandNodeData extends Record<string, unknown> {
  command: Command;
}

export function CommandNode({ data }: NodeProps<{ data: CommandNodeData; type: "command" }>) {
  const { command } = data;
  return (
    <div className="bg-zinc-800 border border-amber-600 rounded-md p-2 min-w-[140px]">
      <div className="text-xs font-mono text-amber-300 font-semibold">/{command.name}</div>
      <div className="text-[10px] text-zinc-500">command</div>
      <Handle type="source" position={Position.Right} className="!bg-amber-600" />
    </div>
  );
}
```

- [ ] **Step 8: Add `setCanvasPosition` to `web/src/state/accountStore.ts`**

Append to the `interface AccountState` and the `create` factory:

```ts
// In the interface:
setCanvasPosition: (input: { packId: PackId; nodeId: string; x: number; y: number }) => void;

// In the implementation (add as a property of the store object):
setCanvasPosition: ({ packId: pId, nodeId, x, y }) =>
  set(
    produce((draft: AccountState) => {
      const pack = draft.account.packs.find((p) => p.id === pId);
      if (!pack) return;
      pack.canvasLayout[nodeId] = { x, y };
    }),
  ),
```

- [ ] **Step 9: Implement `web/src/features/pack-canvas/Canvas.tsx`**

```tsx
import { useMemo } from "react";
import { ReactFlow, Background, Controls, type Node, type NodeChange, applyNodeChanges } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useAccountStore } from "@/state/accountStore";
import type { PackId } from "@/domain/types";
import { deriveEdges } from "./deriveEdges";
import { autoLayout } from "./autoLayout";
import { MenuNode, type MenuNodeData } from "./nodes/MenuNode";
import { CommandNode, type CommandNodeData } from "./nodes/CommandNode";

const nodeTypes = { menu: MenuNode, command: CommandNode };

interface CanvasProps {
  packId: PackId;
}

export function Canvas({ packId }: CanvasProps) {
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const setCanvasPosition = useAccountStore((s) => s.setCanvasPosition);

  const layout = useMemo(() => (pack ? autoLayout(pack) : {}), [pack]);

  const nodes: Node[] = useMemo(() => {
    if (!pack) return [];
    const menuNodes: Node[] = pack.menus.map((menu) => ({
      id: menu.id,
      type: "menu",
      position: layout[menu.id] ?? { x: 0, y: 0 },
      data: { menu, packId } satisfies MenuNodeData,
    }));
    const cmdNodes: Node[] = pack.commands.map((command) => ({
      id: command.id,
      type: "command",
      position: layout[command.id] ?? { x: 0, y: 0 },
      data: { command } satisfies CommandNodeData,
    }));
    return [...menuNodes, ...cmdNodes];
  }, [pack, layout, packId]);

  const edges = useMemo(() => (pack ? deriveEdges(pack) : []), [pack]);

  const onNodesChange = (changes: NodeChange[]) => {
    const updated = applyNodeChanges(changes, nodes);
    for (const change of changes) {
      if (change.type === "position" && change.position && !change.dragging) {
        setCanvasPosition({ packId, nodeId: change.id, x: change.position.x, y: change.position.y });
      }
    }
    void updated; // we re-derive nodes from store on next render
  };

  if (!pack) return <div className="p-8">Pack not found</div>;

  return (
    <div className="h-full w-full">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} fitView>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
```

- [ ] **Step 10: Replace `web/src/routes/pack.$packId.tsx`**

```tsx
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { Canvas } from "@/features/pack-canvas/Canvas";
import type { PackId } from "@/domain/types";

export const Route = createFileRoute("/pack/$packId")({
  component: PackCanvasPage,
});

function PackCanvasPage() {
  const { packId } = useParams({ from: "/pack/$packId" });
  return (
    <div className="h-screen flex flex-col">
      <header className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2 text-sm">
        <Link to="/" className="text-zinc-400 hover:text-zinc-100">
          ← Packs
        </Link>
        <span className="text-zinc-500">/</span>
        <span className="font-mono">{packId}</span>
      </header>
      <main className="flex-1">
        <Canvas packId={packId as PackId} />
      </main>
    </div>
  );
}
```

- [ ] **Step 11: Run all unit tests**

```bash
cd web && npm run test -- --run
```

Expected: all tests still pass.

- [ ] **Step 12: Visual smoke check**

```bash
cd web && npm run dev
```

Open `/pack/p_personal` — verify nodes and one edge render. Stop the dev server.

- [ ] **Step 13: Commit**

```bash
git add web/
git commit -m "feat(pack-canvas): React Flow canvas with derived edges and persistent layout"
```

---

## Task 10: Move-to-pack DnD

Allow dragging a menu node out of the canvas onto a pack drop-zone (sidebar of other packs) to invoke `moveMenuToPack`. Hermetic checks already in store.

**Files:**
- Create: `web/src/features/pack-canvas/MovePackSidebar.tsx`
- Modify: `web/src/routes/pack.$packId.tsx`
- Create: `web/src/features/pack-canvas/MovePackSidebar.test.tsx`

- [ ] **Step 1: Implement `web/src/features/pack-canvas/MovePackSidebar.tsx`**

```tsx
import { useDroppable } from "@dnd-kit/core";
import { useAccountStore } from "@/state/accountStore";
import type { PackId } from "@/domain/types";
import { cx } from "@/lib/cx";

interface DropTargetProps {
  packId: PackId;
  name: string;
}

function DropTarget({ packId, name }: DropTargetProps) {
  const { isOver, setNodeRef } = useDroppable({ id: `pack-target:${packId}`, data: { packId } });
  return (
    <div
      ref={setNodeRef}
      data-testid={`drop-target-${packId}`}
      className={cx(
        "px-3 py-2 rounded-md border text-sm font-mono",
        isOver ? "bg-emerald-900/40 border-emerald-500" : "border-zinc-700",
      )}
    >
      {name}
    </div>
  );
}

interface MovePackSidebarProps {
  currentPackId: PackId;
}

export function MovePackSidebar({ currentPackId }: MovePackSidebarProps) {
  const packs = useAccountStore((s) => s.account.packs);
  const others = packs.filter((p) => p.id !== currentPackId);
  if (others.length === 0) return null;
  return (
    <aside className="w-56 border-l border-zinc-800 p-3 flex flex-col gap-2 bg-zinc-950">
      <div className="text-xs uppercase text-zinc-500 mb-1">Drop to move</div>
      {others.map((p) => (
        <DropTarget key={p.id} packId={p.id} name={p.name} />
      ))}
    </aside>
  );
}
```

- [ ] **Step 2: Update pack route to wrap canvas + sidebar in a `<DndContext>` that fires `moveMenuToPack`**

Replace `web/src/routes/pack.$packId.tsx`:

```tsx
import { useState } from "react";
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { Canvas } from "@/features/pack-canvas/Canvas";
import { MovePackSidebar } from "@/features/pack-canvas/MovePackSidebar";
import { useAccountStore } from "@/state/accountStore";
import type { MenuId, PackId } from "@/domain/types";

export const Route = createFileRoute("/pack/$packId")({
  component: PackCanvasPage,
});

function PackCanvasPage() {
  const { packId } = useParams({ from: "/pack/$packId" });
  const [error, setError] = useState<string | null>(null);
  const moveMenuToPack = useAccountStore((s) => s.moveMenuToPack);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const overData = event.over?.data.current as { packId?: PackId } | undefined;
    const activeData = event.active.data.current as { kind?: "menu"; menuId?: MenuId } | undefined;
    if (!overData?.packId || !activeData?.menuId) return;
    try {
      moveMenuToPack({
        menuId: activeData.menuId,
        fromPackId: packId as PackId,
        toPackId: overData.packId,
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "move failed");
    }
  };

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="h-screen flex flex-col">
        <header className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2 text-sm">
          <Link to="/" className="text-zinc-400 hover:text-zinc-100">
            ← Packs
          </Link>
          <span className="text-zinc-500">/</span>
          <span className="font-mono">{packId}</span>
          {error && <span className="ml-auto text-red-400 text-xs">{error}</span>}
        </header>
        <div className="flex-1 flex">
          <main className="flex-1">
            <Canvas packId={packId as PackId} />
          </main>
          <MovePackSidebar currentPackId={packId as PackId} />
        </div>
      </div>
    </DndContext>
  );
}
```

- [ ] **Step 3: Update `MenuNode` to expose itself as a draggable via `@dnd-kit/core`**

Replace `web/src/features/pack-canvas/nodes/MenuNode.tsx`:

```tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useDraggable } from "@dnd-kit/core";
import { Link } from "@tanstack/react-router";
import type { Menu, PackId } from "@/domain/types";

export interface MenuNodeData extends Record<string, unknown> {
  menu: Menu;
  packId: PackId;
}

export function MenuNode({ data }: NodeProps<{ data: MenuNodeData; type: "menu" }>) {
  const { menu, packId } = data;
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `menu-drag:${menu.id}`,
    data: { kind: "menu", menuId: menu.id },
  });
  return (
    <div
      ref={setNodeRef}
      className="bg-zinc-800 border border-zinc-600 rounded-md p-2 min-w-[140px]"
      style={{ opacity: isDragging ? 0.4 : 1 }}
      {...listeners}
      {...attributes}
    >
      <Handle type="target" position={Position.Left} className="!bg-zinc-500" />
      <Link
        to="/pack/$packId/menu/$menuId"
        params={{ packId, menuId: menu.id }}
        className="block"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-xs font-mono text-zinc-200 font-semibold mb-1">{menu.title}</div>
        <div className="text-[10px] text-zinc-500">{menu.id}</div>
      </Link>
      <Handle type="source" position={Position.Right} className="!bg-zinc-500" />
    </div>
  );
}
```

- [ ] **Step 4: Write component test `web/src/features/pack-canvas/MovePackSidebar.test.tsx`**

```tsx
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { useAccountStore } from "@/state/accountStore";
import { mockAccount } from "@/mock/fixtures";
import { packId } from "@/domain/ids";
import { MovePackSidebar } from "./MovePackSidebar";

describe("<MovePackSidebar />", () => {
  beforeEach(() => {
    localStorage.clear();
    useAccountStore.setState({ account: mockAccount() }, true);
  });

  it("lists every pack except the current one as a drop target", () => {
    render(
      <DndContext>
        <MovePackSidebar currentPackId={packId("p_personal")} />
      </DndContext>,
    );
    expect(screen.getByTestId("drop-target-p_shop_system")).toBeInTheDocument();
    expect(screen.getByTestId("drop-target-p_daily_quests")).toBeInTheDocument();
    expect(screen.queryByTestId("drop-target-p_personal")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run tests**

```bash
cd web && npm run test -- --run MovePackSidebar
```

Expected: 1 passing.

- [ ] **Step 6: Commit**

```bash
git add web/
git commit -m "feat(pack-canvas): drag-out menu node onto sidebar pack target to move"
```

---

## Task 11: Menu editor stub (Niveau 3)

Replace the menu editor placeholder with a 3-pane layout (palette / inventory grid / properties). Drag a vanilla material from the palette onto a slot to set its `material`.

**Files:**
- Modify: `web/src/routes/pack.$packId.menu.$menuId.tsx`
- Create: `web/src/features/menu-editor/MenuEditor.tsx`, `web/src/features/menu-editor/Palette.tsx`, `web/src/features/menu-editor/InventoryGrid.tsx`, `web/src/features/menu-editor/Properties.tsx`
- Create: `web/src/state/menuDraftStore.ts`, `web/src/state/menuDraftStore.test.ts`
- Create: `web/src/features/menu-editor/InventoryGrid.test.tsx`

- [ ] **Step 1: Implement `web/src/state/menuDraftStore.ts`** with zundo undo/redo

```ts
import { create } from "zustand";
import { temporal } from "zundo";
import { produce } from "immer";
import type { Element, ElementId, Layer, Menu, MenuId, PackId } from "@/domain/types";
import { newElementId, newLayerId } from "@/domain/ids";
import { useAccountStore } from "./accountStore";

interface MenuDraftState {
  menuId: MenuId | null;
  packId: PackId | null;
  draft: Menu | null;
  selectedElementId: ElementId | null;
  selectedPosition: number | null;
  load: (input: { menu: Menu; packId: PackId }) => void;
  selectPosition: (pos: number) => void;
  setMaterialAtPosition: (input: { position: number; material: string }) => void;
  setElementField: (input: { elementId: ElementId; field: "title" | "lore" | "count"; value: string }) => void;
  commit: () => void;
}

const findElementAtPosition = (menu: Menu, position: number): { element: Element; layer: Layer } | null => {
  for (const layer of menu.layers) {
    for (const el of layer.elements) {
      if (el.positions === String(position)) return { element: el, layer };
    }
  }
  return null;
};

const ensureLayer = (menu: Menu): Layer => {
  if (menu.layers[0]) return menu.layers[0];
  const layer: Layer = { id: newLayerId(), name: "default", elements: [] };
  menu.layers.push(layer);
  return layer;
};

export const useMenuDraftStore = create<MenuDraftState>()(
  temporal(
    (set, get) => ({
      menuId: null,
      packId: null,
      draft: null,
      selectedElementId: null,
      selectedPosition: null,
      load: ({ menu, packId }) =>
        set({
          menuId: menu.id,
          packId,
          draft: structuredClone(menu),
          selectedElementId: null,
          selectedPosition: null,
        }),
      selectPosition: (pos) =>
        set(
          produce((draft: MenuDraftState) => {
            draft.selectedPosition = pos;
            const found = draft.draft ? findElementAtPosition(draft.draft, pos) : null;
            draft.selectedElementId = found?.element.id ?? null;
          }),
        ),
      setMaterialAtPosition: ({ position, material }) =>
        set(
          produce((draft: MenuDraftState) => {
            if (!draft.draft) return;
            const found = findElementAtPosition(draft.draft, position);
            if (found) {
              const appearance = found.element.appearances[0];
              if (appearance) appearance.material = material;
              return;
            }
            const layer = ensureLayer(draft.draft);
            const el: Element = {
              id: newElementId(),
              positions: String(position),
              appearances: [{ material }],
            };
            layer.elements.push(el);
            draft.selectedElementId = el.id;
          }),
        ),
      setElementField: ({ elementId, field, value }) =>
        set(
          produce((draft: MenuDraftState) => {
            if (!draft.draft) return;
            for (const layer of draft.draft.layers) {
              for (const el of layer.elements) {
                if (el.id !== elementId) continue;
                const appearance = el.appearances[0];
                if (!appearance) return;
                if (field === "title") appearance.title = value;
                else if (field === "lore") appearance.lore = value.split("\n");
                else if (field === "count") appearance.count = Number(value) || 1;
              }
            }
          }),
        ),
      commit: () => {
        const { draft, packId } = get();
        if (!draft || !packId) return;
        useAccountStore.setState((s) =>
          produce(s, (acc) => {
            const pack = acc.account.packs.find((p) => p.id === packId);
            if (!pack) return;
            const idx = pack.menus.findIndex((m) => m.id === draft.id);
            if (idx === -1) return;
            pack.menus[idx] = draft;
          }),
        );
      },
    }),
    { partialize: (s) => ({ draft: s.draft }) },
  ),
);
```

- [ ] **Step 2: Write failing test `web/src/state/menuDraftStore.test.ts`**

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { useMenuDraftStore } from "./menuDraftStore";
import { useAccountStore } from "./accountStore";
import { mockAccount } from "@/mock/fixtures";
import { menuId, packId } from "@/domain/ids";

describe("menuDraftStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useAccountStore.setState({ account: mockAccount() }, true);
    const menu = useAccountStore.getState().account.packs[0]!.menus[0]!;
    useMenuDraftStore.getState().load({ menu, packId: packId("p_personal") });
  });

  it("setMaterialAtPosition updates an existing element", () => {
    useMenuDraftStore.getState().setMaterialAtPosition({ position: 13, material: "DIAMOND" });
    const draft = useMenuDraftStore.getState().draft!;
    const el = draft.layers[0]!.elements.find((e) => e.positions === "13")!;
    expect(el.appearances[0]!.material).toBe("DIAMOND");
  });

  it("setMaterialAtPosition creates an element at an empty position", () => {
    useMenuDraftStore.getState().setMaterialAtPosition({ position: 22, material: "PAPER" });
    const draft = useMenuDraftStore.getState().draft!;
    const el = draft.layers[0]!.elements.find((e) => e.positions === "22")!;
    expect(el.appearances[0]!.material).toBe("PAPER");
  });

  it("commit writes the draft back to the account store", () => {
    useMenuDraftStore.getState().setMaterialAtPosition({ position: 13, material: "GOLD_INGOT" });
    useMenuDraftStore.getState().commit();
    const updated = useAccountStore.getState().account.packs[0]!.menus[0]!;
    const el = updated.layers[0]!.elements.find((e) => e.positions === "13")!;
    expect(el.appearances[0]!.material).toBe("GOLD_INGOT");
  });
});
```

- [ ] **Step 3: Run, verify pass**

```bash
cd web && npm run test -- --run menuDraftStore
```

Expected: 3 passing.

- [ ] **Step 4: Implement `web/src/features/menu-editor/Palette.tsx`**

```tsx
import { useDraggable } from "@dnd-kit/core";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { cx } from "@/lib/cx";

const VANILLA_MATERIALS = [
  "DIAMOND",
  "DIAMOND_SWORD",
  "DIAMOND_PICKAXE",
  "IRON_INGOT",
  "IRON_PICKAXE",
  "GOLD_INGOT",
  "PAPER",
  "BOOK",
  "EMERALD",
  "NETHERITE_INGOT",
  "ENDER_PEARL",
  "BARRIER",
];

function MaterialItem({ name }: { name: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette:${name}`,
    data: { kind: "material", material: name },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cx(
        "px-2 py-1.5 rounded text-xs font-mono cursor-grab bg-zinc-900 border border-zinc-800 hover:border-zinc-600",
        isDragging && "opacity-50",
      )}
    >
      {name}
    </div>
  );
}

export function Palette() {
  const [search, setSearch] = useState("");
  const filtered = VANILLA_MATERIALS.filter((m) => m.toLowerCase().includes(search.toLowerCase()));
  return (
    <aside className="w-56 border-r border-zinc-800 p-3 flex flex-col gap-2 bg-zinc-950">
      <div className="text-xs uppercase text-zinc-500">Palette · Vanilla</div>
      <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="flex flex-col gap-1 overflow-auto">
        {filtered.map((m) => (
          <MaterialItem key={m} name={m} />
        ))}
      </div>
    </aside>
  );
}
```

- [ ] **Step 5: Implement `web/src/features/menu-editor/InventoryGrid.tsx`**

```tsx
import { useDroppable } from "@dnd-kit/core";
import { useMenuDraftStore } from "@/state/menuDraftStore";
import { cx } from "@/lib/cx";

function Slot({ position }: { position: number }) {
  const draft = useMenuDraftStore((s) => s.draft);
  const selected = useMenuDraftStore((s) => s.selectedPosition);
  const select = useMenuDraftStore((s) => s.selectPosition);
  const { isOver, setNodeRef } = useDroppable({ id: `slot:${position}`, data: { kind: "slot", position } });

  const element = draft?.layers
    .flatMap((l) => l.elements)
    .find((e) => e.positions === String(position));
  const filled = Boolean(element?.appearances[0]?.material);
  const isSelected = selected === position;

  return (
    <button
      ref={setNodeRef}
      onClick={() => select(position)}
      data-testid={`slot-${position}`}
      className={cx(
        "aspect-square rounded border text-[10px] font-mono flex items-center justify-center transition-colors",
        filled ? "bg-zinc-800 border-zinc-600 text-zinc-300" : "bg-zinc-900 border-zinc-800 text-zinc-600",
        isSelected && "ring-2 ring-emerald-500",
        isOver && "border-emerald-500 bg-emerald-900/30",
      )}
    >
      {element?.appearances[0]?.material?.slice(0, 6) ?? position}
    </button>
  );
}

export function InventoryGrid() {
  const draft = useMenuDraftStore((s) => s.draft);
  if (!draft) return <div className="p-8 text-zinc-500">No menu loaded</div>;
  const total = draft.rows * 9;
  return (
    <div className="flex-1 p-8 flex items-center justify-center">
      <div className="grid grid-cols-9 gap-1 w-[480px]">
        {Array.from({ length: total }, (_, i) => (
          <Slot key={i} position={i} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Implement `web/src/features/menu-editor/Properties.tsx`**

```tsx
import { Input } from "@/components/ui/input";
import { useMenuDraftStore } from "@/state/menuDraftStore";

export function Properties() {
  const draft = useMenuDraftStore((s) => s.draft);
  const selectedId = useMenuDraftStore((s) => s.selectedElementId);
  const setField = useMenuDraftStore((s) => s.setElementField);

  const element = draft?.layers.flatMap((l) => l.elements).find((e) => e.id === selectedId);
  const appearance = element?.appearances[0];

  return (
    <aside className="w-72 border-l border-zinc-800 p-3 flex flex-col gap-3 bg-zinc-950 text-sm">
      <div className="text-xs uppercase text-zinc-500">Properties</div>
      {!element ? (
        <div className="text-zinc-500 text-xs">Select a slot to edit.</div>
      ) : (
        <>
          <Field label="material" value={appearance?.material ?? ""} disabled />
          <Field
            label="title"
            value={appearance?.title ?? ""}
            onChange={(v) => setField({ elementId: element.id, field: "title", value: v })}
          />
          <Field
            label="count"
            value={String(appearance?.count ?? 1)}
            onChange={(v) => setField({ elementId: element.id, field: "count", value: v })}
          />
          <div>
            <div className="text-[10px] uppercase text-zinc-500 mb-1">lore</div>
            <textarea
              className="w-full bg-zinc-900 border border-zinc-800 rounded p-2 text-xs font-mono"
              rows={4}
              value={(appearance?.lore ?? []).join("\n")}
              onChange={(e) => setField({ elementId: element.id, field: "lore", value: e.target.value })}
            />
          </div>
        </>
      )}
    </aside>
  );
}

interface FieldProps {
  label: string;
  value: string;
  disabled?: boolean;
  onChange?: (v: string) => void;
}

function Field({ label, value, disabled, onChange }: FieldProps) {
  return (
    <div>
      <div className="text-[10px] uppercase text-zinc-500 mb-1">{label}</div>
      <Input
        value={value}
        disabled={disabled}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      />
    </div>
  );
}
```

- [ ] **Step 7: Implement `web/src/features/menu-editor/MenuEditor.tsx`** with the DndContext that wires palette → slot

```tsx
import { useEffect } from "react";
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { Link } from "@tanstack/react-router";
import { useAccountStore } from "@/state/accountStore";
import { useMenuDraftStore } from "@/state/menuDraftStore";
import type { MenuId, PackId } from "@/domain/types";
import { Palette } from "./Palette";
import { InventoryGrid } from "./InventoryGrid";
import { Properties } from "./Properties";
import { Button } from "@/components/ui/button";

interface MenuEditorProps {
  packId: PackId;
  menuId: MenuId;
}

export function MenuEditor({ packId, menuId }: MenuEditorProps) {
  const menu = useAccountStore((s) =>
    s.account.packs.find((p) => p.id === packId)?.menus.find((m) => m.id === menuId),
  );
  const load = useMenuDraftStore((s) => s.load);
  const commit = useMenuDraftStore((s) => s.commit);
  const setMaterial = useMenuDraftStore((s) => s.setMaterialAtPosition);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    if (menu) load({ menu, packId });
  }, [menu, packId, load]);

  const onDragEnd = (e: DragEndEvent) => {
    const overData = e.over?.data.current as { kind?: "slot"; position?: number } | undefined;
    const activeData = e.active.data.current as { kind?: "material"; material?: string } | undefined;
    if (overData?.kind !== "slot" || activeData?.kind !== "material" || overData.position == null) return;
    setMaterial({ position: overData.position, material: activeData.material! });
  };

  if (!menu) return <div className="p-8 text-zinc-500">Menu not found.</div>;

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="h-screen flex flex-col">
        <header className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2 text-sm">
          <Link to="/" className="text-zinc-400 hover:text-zinc-100">
            Packs
          </Link>
          <span className="text-zinc-500">/</span>
          <Link to="/pack/$packId" params={{ packId }} className="text-zinc-400 hover:text-zinc-100">
            {packId}
          </Link>
          <span className="text-zinc-500">/</span>
          <span className="font-mono">{menuId}</span>
          <Button onClick={() => commit()} className="ml-auto">
            Commit
          </Button>
        </header>
        <div className="flex-1 flex">
          <Palette />
          <InventoryGrid />
          <Properties />
        </div>
      </div>
    </DndContext>
  );
}
```

- [ ] **Step 8: Replace `web/src/routes/pack.$packId.menu.$menuId.tsx`**

```tsx
import { createFileRoute, useParams } from "@tanstack/react-router";
import { MenuEditor } from "@/features/menu-editor/MenuEditor";
import type { MenuId, PackId } from "@/domain/types";

export const Route = createFileRoute("/pack/$packId/menu/$menuId")({
  component: MenuEditorPage,
});

function MenuEditorPage() {
  const { packId, menuId } = useParams({ from: "/pack/$packId/menu/$menuId" });
  return <MenuEditor packId={packId as PackId} menuId={menuId as MenuId} />;
}
```

- [ ] **Step 9: Write `web/src/features/menu-editor/InventoryGrid.test.tsx`**

```tsx
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { useMenuDraftStore } from "@/state/menuDraftStore";
import { mockAccount } from "@/mock/fixtures";
import { packId } from "@/domain/ids";
import { InventoryGrid } from "./InventoryGrid";

describe("<InventoryGrid />", () => {
  beforeEach(() => {
    const menu = mockAccount().packs[0]!.menus[0]!;
    useMenuDraftStore.getState().load({ menu, packId: packId("p_personal") });
  });

  it("renders rows × 9 slots", () => {
    render(
      <DndContext>
        <InventoryGrid />
      </DndContext>,
    );
    expect(screen.getAllByTestId(/^slot-/)).toHaveLength(27);
  });
});
```

- [ ] **Step 10: Run all tests**

```bash
cd web && npm run test -- --run
```

Expected: every test passes.

- [ ] **Step 11: Commit**

```bash
git add web/
git commit -m "feat(menu-editor): three-pane editor with palette → slot DnD and properties"
```

---

## Task 12: Undo/redo wired to keyboard

zundo middleware is already in `menuDraftStore`. Add Ctrl+Z / Ctrl+Shift+Z keyboard handlers and verify with a unit test.

**Files:**
- Create: `web/src/features/menu-editor/useUndoShortcut.ts`
- Modify: `web/src/features/menu-editor/MenuEditor.tsx` (call the hook)
- Create: `web/src/features/menu-editor/useUndoShortcut.test.tsx`

- [ ] **Step 1: Implement `web/src/features/menu-editor/useUndoShortcut.ts`**

```ts
import { useEffect } from "react";
import { useMenuDraftStore } from "@/state/menuDraftStore";

export function useUndoShortcut(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const cmdOrCtrl = e.ctrlKey || e.metaKey;
      if (!cmdOrCtrl) return;
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        useMenuDraftStore.temporal.getState().undo();
      } else if ((e.key === "z" && e.shiftKey) || e.key === "y") {
        e.preventDefault();
        useMenuDraftStore.temporal.getState().redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
```

- [ ] **Step 2: Call the hook in `MenuEditor`**

In `web/src/features/menu-editor/MenuEditor.tsx`, add right after `useEffect(...load)`:

```tsx
import { useUndoShortcut } from "./useUndoShortcut";
// ... inside component:
useUndoShortcut();
```

- [ ] **Step 3: Write test `web/src/features/menu-editor/useUndoShortcut.test.tsx`**

```tsx
import { describe, expect, it, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMenuDraftStore } from "@/state/menuDraftStore";
import { useAccountStore } from "@/state/accountStore";
import { mockAccount } from "@/mock/fixtures";
import { packId } from "@/domain/ids";
import { useUndoShortcut } from "./useUndoShortcut";

describe("useUndoShortcut", () => {
  beforeEach(() => {
    localStorage.clear();
    useAccountStore.setState({ account: mockAccount() }, true);
    const menu = useAccountStore.getState().account.packs[0]!.menus[0]!;
    useMenuDraftStore.getState().load({ menu, packId: packId("p_personal") });
  });

  it("Ctrl+Z reverts the last setMaterialAtPosition", () => {
    renderHook(() => useUndoShortcut());

    useMenuDraftStore.getState().setMaterialAtPosition({ position: 0, material: "DIAMOND" });
    expect(useMenuDraftStore.getState().draft!.layers[0]!.elements.find((e) => e.positions === "0")?.appearances[0]!.material).toBe("DIAMOND");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true }));

    const stillThere = useMenuDraftStore
      .getState()
      .draft!.layers[0]!.elements.find((e) => e.positions === "0");
    expect(stillThere?.appearances[0]?.material).not.toBe("DIAMOND");
  });
});
```

- [ ] **Step 4: Run test**

```bash
cd web && npm run test -- --run useUndoShortcut
```

Expected: 1 passing.

- [ ] **Step 5: Commit**

```bash
git add web/
git commit -m "feat(menu-editor): Ctrl+Z / Ctrl+Shift+Z undo/redo shortcut"
```

---

## Task 13: Smoke E2E with Playwright

One end-to-end test: load app → see 3 packs → click Personal → see canvas with menu nodes → click `m_profile` → see menu editor.

**Files:**
- Create: `web/playwright.config.ts`
- Create: `web/tests/e2e/smoke.spec.ts`

- [ ] **Step 1: Install Playwright**

```bash
cd web && npm install -D @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Create `web/playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: "http://localhost:5173", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
  },
});
```

- [ ] **Step 3: Create `web/tests/e2e/smoke.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

test("3-level navigation smoke", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");

  await expect(page.getByText("Personal")).toBeVisible();
  await expect(page.getByText("Shop System")).toBeVisible();
  await expect(page.getByText("Daily Quests")).toBeVisible();

  await page.getByText("Personal").click();
  await expect(page).toHaveURL(/\/pack\/p_personal/);
  await expect(page.locator(".react-flow__node")).toHaveCount(3); // 2 menus + 1 command

  await page.getByText("Profil").click();
  await expect(page).toHaveURL(/\/pack\/p_personal\/menu\/m_profile/);
  await expect(page.getByText("Palette · Vanilla")).toBeVisible();
  await expect(page.getByText("Properties")).toBeVisible();
});
```

- [ ] **Step 4: Run e2e**

```bash
cd web && npm run test:e2e
```

Expected: 1 passing test.

- [ ] **Step 5: Commit**

```bash
git add web/
git commit -m "test(e2e): playwright smoke for 3-level nav"
```

---

## Task 14: Final verification pass

Run everything together and ensure the scaffold is shippable.

- [ ] **Step 1: All unit tests pass**

```bash
cd web && npm run test -- --run
```

Expected: every suite green.

- [ ] **Step 2: Build succeeds**

```bash
cd web && npm run build
```

Expected: no errors, `dist/` populated.

- [ ] **Step 3: Lint clean**

```bash
cd web && npm run lint
```

Expected: zero diagnostics.

- [ ] **Step 4: E2E passes**

```bash
cd web && npm run test:e2e
```

Expected: smoke green.

- [ ] **Step 5: Manual sanity in dev**

```bash
cd web && npm run dev
```

Walk:
1. Home shows 3 packs.
2. Reorder packs by drag — order persists across reload.
3. Click Personal → canvas shows `shop_main`, `profile`, `/heal` nodes with one edge.
4. Drag a node position → reload → position persists.
5. Drag the `profile` menu onto Shop System sidebar drop target → it disappears from Personal canvas, appears in Shop System.
6. Open `m_profile` from the canvas → drag DIAMOND from palette to a slot → see slot fill → click slot → properties show DIAMOND.
7. Ctrl+Z → slot reverts.
8. Click Commit → reload → change persists in account store.

- [ ] **Step 6: Tag the scaffold**

```bash
git tag -a v0.1.0-scaffold -m "Editor shell scaffold v0 — 3-level shell with mocked data"
```

---

## Out of scope (deferred to later plans)

Per spec §7, the following are explicitly NOT in this plan:

- Backend (Fastify, Drizzle, Postgres, R2)
- Auth Discord OAuth
- WebSocket broadcast and mutation taxonomy
- MiniMessage parser and preview live
- i18n editor inline (`{` autocomplete, "+ Nouvelle clé")
- Layers and Apparences conditionnelles UI (data ready)
- Templates user-defined with variables
- Real asset upload, normalization, dedup
- Plugin tiers palette, Nexo / ItemAdder integration
- Resource pack generation
- Java plugin
- Command editor
- Multi-user / teams / billing / Stripe
- Onboarding wizard
