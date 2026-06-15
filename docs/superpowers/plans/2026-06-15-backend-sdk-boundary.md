# Backend SDK Boundary (M1 · Plan 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish `@artisan/backend-sdk` as the single public entrypoint for the backend module contract, and prove it by routing the three in-repo backend modules (menus, commands, assistant) and the app integrator through it.

**Architecture:** A barrel module `backend/src/sdk/index.ts` re-exports the module-system contract (currently in `backend/src/modules/api/*`) without moving files. A tsconfig `paths` entry maps `@artisan/backend-sdk` to the barrel — **Bun honours tsconfig paths natively at runtime and under `bun test`**, so no separate test/build config is needed (unlike the Vite editor in Plan 1). The 4 files that import the contract switch to the barrel. A contract test pins the public runtime surface. No npm package / publishing yet — deferred to a later plan (spec §10); M1 only fixes the *boundary*.

**Tech Stack:** Bun + Hono + TypeScript, `bun test` runner, tsconfig `paths` resolution.

**Spec:** `docs/superpowers/specs/2026-06-15-modules-architecture-design.md` (§6.2 backend SDK, §11 dogfooding).

**Scope note:** This mirrors Plan 1 (editor) for the backend. Only the module *contract* surface (`BackendModule`, `DataSourceDeclaration`, `CommandDeclaration`, `mountModules`, `ModuleRegistryHandle`) goes in the barrel. No primitives beyond the contract — the backend has none to share at this layer.

**⚠️ Test command:** ALWAYS `bun run test` (via `scripts/test.ts` → `artisan_test` DB). NEVER `bun test` directly — it wipes the dev `artisan` DB (CLAUDE.md). Verified baselines for this plan: `npx tsc --noEmit` = **0 errors**, Postgres reachable on 5432.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `backend/src/sdk/index.ts` | Public SDK barrel — re-exports the module contract | Create |
| `backend/src/sdk/index.test.ts` | Pins the public runtime surface | Create |
| `backend/tsconfig.json` | `baseUrl` + `paths` for `@artisan/backend-sdk` | Modify |
| `backend/src/modules/menus/index.ts` | Import contract from SDK (dogfood) | Modify |
| `backend/src/modules/commands/index.ts` | Import contract from SDK (dogfood) | Modify |
| `backend/src/modules/assistant/index.ts` | Import contract from SDK (dogfood) | Modify |
| `backend/src/app.ts` | Import integrator from SDK | Modify |
| `docs/architecture/modules.md` | Note the SDK barrel in §3.2 | Modify |

**Unchanged on purpose:** `backend/src/modules/api/{types,moduleRegistry}.ts` (the implementation stays; the barrel re-exports it). Their existing tests keep importing the deep paths.

---

## Task 1: SDK barrel + tsconfig path + contract test

**Files:**
- Create: `backend/src/sdk/index.ts`
- Create: `backend/src/sdk/index.test.ts`
- Modify: `backend/tsconfig.json`

- [ ] **Step 1: Write the contract test**

Create `backend/src/sdk/index.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import * as sdk from "@artisan/backend-sdk";

describe("@artisan/backend-sdk public surface", () => {
  test("exposes the module-system integrator", () => {
    expect(typeof sdk.mountModules).toBe("function");
  });
});
```

(`BackendModule`, `DataSourceDeclaration`, `CommandDeclaration`, `ModuleRegistryHandle` are types — erased at runtime, checked by `tsc` in Task 2. `mountModules` is the only runtime export.)

- [ ] **Step 2: Red — verify the import does not resolve yet**

Run (no DB needed; does NOT use the test wrapper): `cd backend && bun -e 'await import("@artisan/backend-sdk")'`
Expected: FAIL — `Cannot find module "@artisan/backend-sdk"` / `Could not resolve`.

- [ ] **Step 3: Create the barrel**

Create `backend/src/sdk/index.ts`:

```ts
/**
 * `@artisan/backend-sdk` — the public surface a backend module compiles
 * against. Modules import ONLY from this entrypoint, never from deep backend
 * paths (`../modules/api/...`).
 *
 * M1 scope: module-system contract only, re-exported from the in-repo
 * implementation. No physical npm package / publish yet (cf. spec §6.2, §10).
 *
 * Resolved via the `@artisan/backend-sdk` tsconfig path — Bun honours tsconfig
 * paths natively, including under `bun test`.
 */
export type { BackendModule, DataSourceDeclaration, CommandDeclaration } from "../modules/api/types";
export { mountModules } from "../modules/api/moduleRegistry";
export type { ModuleRegistryHandle } from "../modules/api/moduleRegistry";
```

- [ ] **Step 4: Add the tsconfig path**

In `backend/tsconfig.json`, replace the `compilerOptions` block:

```json
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "types": ["bun-types"]
  },
```

with (adds `baseUrl` + `paths`):

```json
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "types": ["bun-types"],
    "baseUrl": ".",
    "paths": { "@artisan/backend-sdk": ["src/sdk/index.ts"] }
  },
```

- [ ] **Step 5: Green — verify the barrel resolves and exposes `mountModules`**

Run: `cd backend && bun -e 'console.log(Object.keys(await import("@artisan/backend-sdk")))'`
Expected: prints `[ "mountModules" ]`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/sdk/index.ts backend/src/sdk/index.test.ts backend/tsconfig.json
git commit -m "feat(backend): add @artisan/backend-sdk barrel for the module contract

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Dogfood the 4 contract importers + doc note

**Files:**
- Modify: `backend/src/modules/menus/index.ts:2`
- Modify: `backend/src/modules/commands/index.ts:2`
- Modify: `backend/src/modules/assistant/index.ts:2`
- Modify: `backend/src/app.ts:25`
- Modify: `docs/architecture/modules.md` (§3.2)

- [ ] **Step 1: Point the three module entries at the SDK**

In each of `backend/src/modules/menus/index.ts`, `backend/src/modules/commands/index.ts`, and `backend/src/modules/assistant/index.ts`, replace line 2:

```ts
import type { BackendModule } from "../api/types";
```

with:

```ts
import type { BackendModule } from "@artisan/backend-sdk";
```

- [ ] **Step 2: Point the integrator at the SDK**

In `backend/src/app.ts`, replace line 25:

```ts
import { mountModules } from "./modules/api/moduleRegistry";
```

with:

```ts
import { mountModules } from "@artisan/backend-sdk";
```

- [ ] **Step 3: Note the boundary in modules.md §3.2**

In `docs/architecture/modules.md`, insert this block immediately **before** the line `## 3. Module abstraction`'s subsection header `### 3.3 Plugin Paper : architecture multi-plugins`:

```markdown
> **SDK barrel (depuis 2026-06-15)** — le contrat `BackendModule` + l'intégrateur `mountModules` sont exposés via un point d'entrée unique `@artisan/backend-sdk` (path tsconfig interne `backend/src/sdk/index.ts`, résolu nativement par Bun y compris sous `bun test`). Les modules importent **uniquement** depuis ce barrel, jamais depuis `../modules/api/...`. En M1 c'est un re-export interne (pas encore un package npm publié) ; cf. `docs/superpowers/specs/2026-06-15-modules-architecture-design.md`. Les modules core menus/commands/assistant consomment déjà le barrel (dogfooding).

```

- [ ] **Step 4: Type-check — must stay at 0 errors**

Run: `cd backend && npx tsc --noEmit`
Expected: **0 errors** (baseline was 0). A non-zero count means the `@artisan/backend-sdk` path didn't resolve — re-check `backend/tsconfig.json` from Task 1 Step 4.

- [ ] **Step 5: Run the full backend suite — green**

Run: `cd backend && bun run test`
Expected: all tests pass, including the new `src/sdk/index.test.ts`. (`bun run test` → `scripts/test.ts` → `artisan_test` DB. Do NOT run `bun test` directly.)

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/menus/index.ts backend/src/modules/commands/index.ts backend/src/modules/assistant/index.ts backend/src/app.ts docs/architecture/modules.md
git commit -m "refactor(backend): route core modules + integrator through @artisan/backend-sdk

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §6.2 (backend SDK = single entrypoint, `BackendModule` + `mountModules` + migrations/tables surface) → barrel (Task 1) + dogfood (Task 2). The migration-registration mechanism the spec flags (§13 open question) is NOT in scope here — that is feature work for Plan 5/M2; this plan only establishes the *contract* entrypoint that already exists.
- §11 (dogfooding: in-repo modules consume the SDK as an external module would) → Task 2 (all three: menus, commands, assistant).
- Publishing / npm package → out of scope (spec §10, Plan 6).

**Placeholder scan:** none — exact paths, full code, exact before/after for the tsconfig edit.

**Type consistency:** the barrel re-exports exactly the symbols defined in `modules/api/types.ts` (`BackendModule`, `DataSourceDeclaration`, `CommandDeclaration`) and `moduleRegistry.ts` (`mountModules`, `ModuleRegistryHandle`). The contract test asserts the single runtime export (`mountModules`); `tsc` (Task 2 Step 4) covers the type re-exports. The 4 importers use names present on the barrel (`BackendModule`, `mountModules`).
