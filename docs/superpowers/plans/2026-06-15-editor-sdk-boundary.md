# Editor SDK Boundary (M1 · Plan 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish `@artisan/editor-sdk` as the single public entrypoint for the frontend module contract, and prove it by routing the two core modules (menus, commands) and the app integrator through it.

**Architecture:** A barrel module `editor/src/sdk/index.ts` re-exports the module-system contract (currently in `editor/src/modules/api/*`) without moving files. A path alias `@artisan/editor-sdk` resolves the barrel in Vite, Vitest, and tsconfig. The 4 files that import the contract switch to the barrel. A contract test pins the public surface (including that test-only helpers do NOT leak). No npm package / publishing yet — that is deferred to a later plan (cf. spec §10); M1 only fixes the *boundary*.

**Tech Stack:** React 19 + Vite 6 + Vitest + TypeScript, path aliases.

**Spec:** `docs/superpowers/specs/2026-06-15-modules-architecture-design.md` (§6.3 editor SDK, §11 dogfooding).

**Scope note:** The shared UI primitives the spec lists for the SDK (`SchemaForm`, `MiniMessageInline`, `RevealField`, placeholder catalog) are intentionally **NOT** added to the barrel in this plan — they join it when the first module UI consumes them (M2), to avoid a speculative public surface. This plan delivers the module *contract* surface only.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `editor/src/sdk/index.ts` | Public SDK barrel — re-exports the module contract | Create |
| `editor/src/sdk/index.test.ts` | Pins the public surface (positive + negative) | Create |
| `editor/vite.config.ts` | Dev/build alias `@artisan/editor-sdk` | Modify |
| `editor/vitest.config.ts` | Test alias `@artisan/editor-sdk` | Modify |
| `editor/tsconfig.json` | TS path `@artisan/editor-sdk` | Modify |
| `editor/src/modules/menus/index.ts` | Import contract from SDK (dogfood) | Modify |
| `editor/src/modules/commands/index.ts` | Import contract from SDK (dogfood) | Modify |
| `editor/src/main.tsx` | Import registry from SDK (integrator) | Modify |
| `editor/src/state/wsStore.ts` | Import event bus from SDK | Modify |
| `docs/architecture/modules.md` | Note the SDK barrel in §3.1 | Modify |

**Unchanged on purpose:** `editor/src/modules/api/{types,registry,eventBus}.ts` (the implementation stays where it is; the barrel re-exports it). Their existing tests (`registry.test.ts`, `eventBus.test.ts`) keep importing the deep paths — they test the implementation, not the public surface.

---

## Task 1: SDK barrel + alias + contract test

**Files:**
- Create: `editor/src/sdk/index.ts`
- Create: `editor/src/sdk/index.test.ts`
- Modify: `editor/vite.config.ts`
- Modify: `editor/vitest.config.ts`
- Modify: `editor/tsconfig.json`

- [ ] **Step 1: Write the failing contract test**

Create `editor/src/sdk/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as sdk from "@artisan/editor-sdk";

describe("@artisan/editor-sdk public surface", () => {
  it("exposes the module-system contract", () => {
    expect(typeof sdk.registerModule).toBe("function");
    expect(typeof sdk.listModules).toBe("function");
    expect(typeof sdk.getModule).toBe("function");
    expect(typeof sdk.onModuleEvent).toBe("function");
    expect(typeof sdk.emitModuleEvent).toBe("function");
  });

  it("does not leak test-only helpers", () => {
    expect("clearRegistry" in sdk).toBe(false);
    expect("clearModuleBus" in sdk).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd editor && npx vitest run src/sdk/index.test.ts`
Expected: FAIL — `Failed to resolve import "@artisan/editor-sdk"` (alias + barrel don't exist yet).

- [ ] **Step 3: Create the barrel**

Create `editor/src/sdk/index.ts`:

```ts
/**
 * `@artisan/editor-sdk` — the public surface a frontend module compiles
 * against. Modules import ONLY from this entrypoint, never from deep editor
 * paths (`@/modules/api/...`, `@/components/...`).
 *
 * M1 scope: module-system contract only, re-exported from the in-repo
 * implementation. No physical npm package / publish yet (cf. spec §6.3, §10).
 * Shared UI primitives (SchemaForm, MiniMessageInline, RevealField, placeholder
 * catalog) join this barrel when the first module UI consumes them (M2).
 *
 * Test-only helpers (`clearRegistry`, `clearModuleBus`) are deliberately NOT
 * re-exported — they are implementation details of the in-repo tests.
 */
export type { FrontendModule, ModuleSidebarEntry, ModuleRouteDecl } from "@/modules/api/types";
export { registerModule, listModules, getModule } from "@/modules/api/registry";
export type { ModuleEvent } from "@/modules/api/eventBus";
export { onModuleEvent, emitModuleEvent } from "@/modules/api/eventBus";
```

- [ ] **Step 4: Add the alias in all three configs**

In `editor/vite.config.ts`, replace the `resolve.alias` block:

```ts
  resolve: {
    alias: { "@": srcDir },
  },
```

with:

```ts
  resolve: {
    alias: {
      "@": srcDir,
      "@artisan/editor-sdk": fileURLToPath(new URL("./src/sdk/index.ts", import.meta.url)),
    },
  },
```

In `editor/vitest.config.ts`, replace the `resolve.alias` block:

```ts
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
```

with:

```ts
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@artisan/editor-sdk": path.resolve(__dirname, "./src/sdk/index.ts"),
    },
  },
```

In `editor/tsconfig.json`, replace the `paths` line:

```json
    "paths": { "@/*": ["src/*"] },
```

with:

```json
    "paths": {
      "@/*": ["src/*"],
      "@artisan/editor-sdk": ["src/sdk/index.ts"]
    },
```

- [ ] **Step 5: Run the contract test to verify it passes**

Run: `cd editor && npx vitest run src/sdk/index.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add editor/src/sdk/index.ts editor/src/sdk/index.test.ts editor/vite.config.ts editor/vitest.config.ts editor/tsconfig.json
git commit -m "feat(editor): add @artisan/editor-sdk barrel for the module contract

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Dogfood the 4 contract importers + doc note

**Files:**
- Modify: `editor/src/modules/menus/index.ts:1`
- Modify: `editor/src/modules/commands/index.ts:1`
- Modify: `editor/src/main.tsx:9`
- Modify: `editor/src/state/wsStore.ts:4`
- Modify: `docs/architecture/modules.md` (§3.1)

- [ ] **Step 1: Point menus/commands at the SDK**

In `editor/src/modules/menus/index.ts`, replace line 1:

```ts
import type { FrontendModule } from "../api/types";
```

with:

```ts
import type { FrontendModule } from "@artisan/editor-sdk";
```

In `editor/src/modules/commands/index.ts`, replace line 1 identically:

```ts
import type { FrontendModule } from "@artisan/editor-sdk";
```

- [ ] **Step 2: Point the integrator + ws store at the SDK**

In `editor/src/main.tsx`, replace line 9:

```ts
import { registerModule, listModules } from "./modules/api/registry";
```

with:

```ts
import { registerModule, listModules } from "@artisan/editor-sdk";
```

In `editor/src/state/wsStore.ts`, replace line 4:

```ts
import { emitModuleEvent, type ModuleEvent } from "@/modules/api/eventBus";
```

with:

```ts
import { emitModuleEvent, type ModuleEvent } from "@artisan/editor-sdk";
```

- [ ] **Step 3: Type-check — no NEW errors in touched files**

Run: `cd editor && npx tsc --noEmit`
Expected: The only error is the pre-existing, unrelated WIP error `src/state/uiStore.ts(327,...)` (persist `migrate` signature). There must be **no** error mentioning `sdk/`, `modules/menus`, `modules/commands`, `main.tsx`, or `wsStore.ts`. If a new error references the `@artisan/editor-sdk` import not resolving, re-check the `tsconfig.json` path from Task 1 Step 4.

- [ ] **Step 4: Run the full editor suite — green**

Run: `cd editor && npx vitest run`
Expected: PASS. The contract test, `registry.test.ts`, `eventBus.test.ts`, and all module/route tests stay green (the 4 refactored files behave identically; only the import source changed).

- [ ] **Step 5: Note the boundary in modules.md §3.1**

In `docs/architecture/modules.md`, find the end of section **3.1 Frontend module** (just before `### 3.2 Backend module`, after the `Le core charge ce registry au boot...` paragraph). Insert:

```markdown
> **SDK barrel (depuis 2026-06-15)** — le contrat `FrontendModule` + le registre + l'event bus sont exposés via un point d'entrée unique `@artisan/editor-sdk` (alias interne `editor/src/sdk/index.ts`). Les modules importent **uniquement** depuis ce barrel, jamais depuis `@/modules/api/...` en profondeur. En M1 c'est un re-export interne (pas encore un package npm publié) ; cf. `docs/superpowers/specs/2026-06-15-modules-architecture-design.md`. Les modules core menus/commands consomment déjà le barrel (dogfooding).
```

- [ ] **Step 6: Commit**

```bash
git add editor/src/modules/menus/index.ts editor/src/modules/commands/index.ts editor/src/main.tsx editor/src/state/wsStore.ts docs/architecture/modules.md
git commit -m "refactor(editor): route core modules + integrator through @artisan/editor-sdk

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §6.3 (editor SDK = single entrypoint, module imports only from barrel, lazy-import seam) → barrel created (Task 1) + dogfood (Task 2). Lazy-import gating is a later plan (Plan 5, presence); the *contract* entrypoint it needs exists here.
- §11 (dogfooding: core modules consume the SDK as an external module would) → Task 2.
- Primitives tier (SchemaForm, MiniMessageInline, RevealField, placeholder) → explicitly deferred (scope note); added when M2's first module UI consumes them. Not a gap — a deliberate YAGNI boundary.
- Publishing / npm package / Maven → out of scope here (spec §10, Plan 6).

**Placeholder scan:** none — every step has exact paths, full code, and the precise before/after for each config edit.

**Type consistency:** the barrel re-exports exactly the symbols defined in `modules/api/types.ts` (`FrontendModule`, `ModuleSidebarEntry`, `ModuleRouteDecl`), `registry.ts` (`registerModule`, `listModules`, `getModule`), and `eventBus.ts` (`ModuleEvent`, `onModuleEvent`, `emitModuleEvent`). The contract test asserts the runtime function exports; the negative test (`clearRegistry`/`clearModuleBus` absent) matches the barrel deliberately omitting them. The 4 importers use names that exist on the barrel (`FrontendModule`, `registerModule`, `listModules`, `emitModuleEvent`, `ModuleEvent`).
