# P1b — Editor module seam (presence-gated external module) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that a business module living in a separate npm package (`@artisan/quests-editor`) can extend the editor — its UI mounted only when the module is *present* on the current server, reusing a base component from `@artisan/editor-sdk`.

**Architecture:** Make `@artisan/editor-sdk` a real consumable workspace package (today it is only a tsconfig/vite alias). Add a second workspace package `@artisan/quests-editor` that depends on it and exports a `FrontendModule`. A host *integrator* (Zustand store + manifest) calls the **already-existing** backend presence endpoint `GET /api/v1/editor-session/:token/modules`, lazy-`import()`s active external modules, and registers them. A host-owned catch-all route `/m/$moduleId` renders the active module's component; the existing sidebar "Installed Modules" slot lists them. Core modules (menus, commands) stay hard-registered in `main.tsx` — only *external* modules are presence-gated.

**Tech Stack:** React 19, Vite 6, Vitest 4, TanStack Router (file-based), Zustand 5, npm workspaces, TypeScript 5.7 (`moduleResolution: bundler`).

**Scope boundaries (deliberately deferred):**
- The package boundary is proven with **npm workspaces** (source-level packages). The *real separate repo* + GitHub Packages publish + Gradle/npm cross-repo dev-loop is **P1c** — not here.
- The SDK exports exactly **one** base component (`Button`) + `cn`. Fattening the SDK with the full design system / `<SchemaForm>` is **P2**.
- The catch-all route is non-splat (`/m/$moduleId`, single screen). Module-internal sub-routing (splat `/m/$moduleId/$`) is **P3**.
- Presence gating runs in **session mode only** (the endpoint authenticates via the editor-session token). The cookie-auth/user-mode + network-union variant is **P3**.
- Core module registration stays in `main.tsx`; "assemble everything from the manifest" is **P3**.

**Commands:** run from `editor/`. Per repo convention, prefix tool commands with `rtk` (e.g. `rtk vitest run …`, `rtk npm run typecheck`). Targeted test = `rtk vitest run <path>`; full suite = `rtk vitest run`; typecheck = `rtk npm run typecheck` (`tsc -b`); routes = `rtk npm run generate-routes`.

---

## File Structure

**New (SDK package):**
- `editor/packages/editor-sdk/package.json` — package manifest (`@artisan/editor-sdk`)
- `editor/packages/editor-sdk/src/index.ts` — public barrel
- `editor/packages/editor-sdk/src/contract/types.ts` — moved from `editor/src/modules/api/types.ts`
- `editor/packages/editor-sdk/src/contract/registry.ts` — moved from `editor/src/modules/api/registry.ts`
- `editor/packages/editor-sdk/src/contract/registry.test.ts` — moved
- `editor/packages/editor-sdk/src/contract/eventBus.ts` — moved from `editor/src/modules/api/eventBus.ts`
- `editor/packages/editor-sdk/src/contract/eventBus.test.ts` — moved
- `editor/packages/editor-sdk/src/lib/cx.ts` — copied from `editor/src/lib/cx.ts`
- `editor/packages/editor-sdk/src/ui/button.tsx` — copied from `editor/src/components/ui/button.tsx`
- `editor/packages/editor-sdk/src/index.test.ts` — moved+extended from `editor/src/sdk/index.test.ts`

**New (external module package):**
- `editor/packages/quests-editor/package.json` — `@artisan/quests-editor`
- `editor/packages/quests-editor/src/index.ts` — default-exports `questsModule`
- `editor/packages/quests-editor/src/QuestsScreen.tsx` — trivial screen using SDK `Button`

**New (host integrator):**
- `editor/src/lib/api/modules.ts` + `.test.ts` — presence client
- `editor/src/distribution/modules.manifest.ts` — external-module manifest
- `editor/src/state/modulesStore.ts` + `.test.ts` — reactive integrator
- `editor/src/distribution/resolveModule.ts` + `.test.ts` — route resolution helper
- `editor/src/distribution/moduleNav.ts` + `.test.ts` — sidebar selection helper
- `editor/src/routes/m.$moduleId.tsx` — host-owned catch-all route

**Modified (host):**
- `editor/package.json` — add `workspaces` + the two `@artisan/*` deps
- `editor/vite.config.ts:14` — remove the `@artisan/editor-sdk` alias; add `optimizeDeps.exclude`
- `editor/vitest.config.ts:17` — remove the `@artisan/editor-sdk` alias
- `editor/tsconfig.json:20-23` — repoint `@artisan/editor-sdk` path to the package; add `@artisan/quests-editor`
- `editor/src/components/WorkspaceSidebar.tsx:273-280` — registry-driven "Installed Modules" list
- `editor/src/routes/__root.tsx` — trigger integration on session token

**Deleted (host, moved into the SDK package):**
- `editor/src/modules/api/types.ts`, `registry.ts`, `registry.test.ts`, `eventBus.ts`, `eventBus.test.ts`
- `editor/src/sdk/index.ts`, `editor/src/sdk/index.test.ts`

---

## Task 1: Stand up `@artisan/editor-sdk` as a real workspace package

This is an atomic refactor: it relocates the module contract into a real package and must leave the **entire existing test suite green** (consumers `main.tsx`, `wsStore.ts`, `menus/index.ts`, `commands/index.ts` resolve the SDK by package name afterward). No behavior change.

**Files:** see "New (SDK package)" + the host config edits + deletions above.

- [ ] **Step 1: Create the package manifest**

Create `editor/packages/editor-sdk/package.json`:

```json
{
  "name": "@artisan/editor-sdk",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@radix-ui/react-slot": "^1.2.4",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "tailwind-merge": "^3.5.0"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```

- [ ] **Step 2: Move the contract files into the package**

Move (not copy) these files, preserving their **exact** contents — only the location changes:
- `editor/src/modules/api/types.ts` → `editor/packages/editor-sdk/src/contract/types.ts`
- `editor/src/modules/api/registry.ts` → `editor/packages/editor-sdk/src/contract/registry.ts`
- `editor/src/modules/api/registry.test.ts` → `editor/packages/editor-sdk/src/contract/registry.test.ts`
- `editor/src/modules/api/eventBus.ts` → `editor/packages/editor-sdk/src/contract/eventBus.ts`
- `editor/src/modules/api/eventBus.test.ts` → `editor/packages/editor-sdk/src/contract/eventBus.test.ts`

The two test files import via relative `./registry` / `./eventBus`, which stay valid in the new location. After moving, delete the now-empty `editor/src/modules/api/` directory.

- [ ] **Step 3: Copy `cn` + `Button` into the package**

Create `editor/packages/editor-sdk/src/lib/cx.ts` (exact copy of `editor/src/lib/cx.ts`):

```ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cx(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export { cx as cn };
```

Create `editor/packages/editor-sdk/src/ui/button.tsx` — copy of `editor/src/components/ui/button.tsx` with the **one** import changed (`@/lib/cx` → `../lib/cx`):

```tsx
import { Slot } from "@radix-ui/react-slot";
import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";

import { cn } from "../lib/cx";

const buttonVariants = cva("btn", {
  variants: {
    variant: {
      default: "",
      primary: "btn-primary",
      destructive: "btn-danger",
      outline: "btn-outline",
      secondary: "btn-outline",
      ghost: "btn-ghost",
      link: "btn-ghost underline-offset-4 hover:underline",
    },
    size: {
      default: "",
      sm: "btn-sm",
      lg: "h-[44px] px-7 text-[14px]",
      icon: "btn-icon",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
```

> Note: this is a deliberate temporary duplicate of the host's `components/ui/button.tsx`. P2 dedupes by having the host import `Button` from the SDK. Recorded as known debt.

- [ ] **Step 4: Create the public barrel**

Create `editor/packages/editor-sdk/src/index.ts`:

```ts
/**
 * `@artisan/editor-sdk` — the public surface a frontend module compiles
 * against. Modules import ONLY from this entrypoint.
 *
 * P1b scope: module-system contract + ONE base component (Button) + cn, as a
 * real workspace package. Fattening with the full design system / SchemaForm
 * is P2 (cf. docs/superpowers/specs/2026-06-17-first-party-module-extensibility-design.md).
 *
 * Test-only helpers (clearRegistry, clearModuleBus) are deliberately NOT
 * re-exported here.
 */
export type { FrontendModule, ModuleSidebarEntry, ModuleRouteDecl } from "./contract/types";
export { registerModule, listModules, getModule } from "./contract/registry";
export type { ModuleEvent } from "./contract/eventBus";
export { onModuleEvent, emitModuleEvent } from "./contract/eventBus";
export { Button, buttonVariants, type ButtonProps } from "./ui/button";
export { cn } from "./lib/cx";
```

- [ ] **Step 5: Move + extend the public-surface test**

Move `editor/src/sdk/index.test.ts` → `editor/packages/editor-sdk/src/index.test.ts` and extend it to assert the new exports. Full new contents:

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

  it("exposes shared base primitives", () => {
    expect(sdk.Button).toBeDefined();
    expect(typeof sdk.cn).toBe("function");
  });

  it("does not leak test-only helpers", () => {
    expect("clearRegistry" in sdk).toBe(false);
    expect("clearModuleBus" in sdk).toBe(false);
  });
});
```

Then delete the now-empty `editor/src/sdk/` directory (its `index.ts` is superseded by the package barrel; `index.test.ts` moved).

- [ ] **Step 6: Wire npm workspaces + dependency in the host manifest**

Edit `editor/package.json`. Add a top-level `"workspaces"` key (after `"type": "module",`) and add the SDK to `dependencies`:

```json
  "type": "module",
  "workspaces": ["packages/*"],
```

In `"dependencies"`, add (keep alphabetical-ish; npm doesn't care):

```json
    "@artisan/editor-sdk": "*",
```

- [ ] **Step 7: Install so the workspace symlink is created**

Run: `rtk npm install`
Expected: completes; `editor/node_modules/@artisan/editor-sdk` now symlinks to `editor/packages/editor-sdk`.

- [ ] **Step 8: Remove the three aliases so resolution uses the real package**

Edit `editor/vite.config.ts` — delete the `@artisan/editor-sdk` alias line (line 14) and add an `optimizeDeps.exclude` so Vite serves the linked package as source. Resulting file:

```ts
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  plugins: [TanStackRouterVite(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": srcDir,
    },
  },
  optimizeDeps: {
    exclude: ["@artisan/editor-sdk", "@artisan/quests-editor"],
  },
  server: {
    watch: {
      usePolling: true,
      interval: 1000,
    },
  },
});
```

Edit `editor/vitest.config.ts` — delete the `@artisan/editor-sdk` alias line (line 17). Resulting `resolve.alias`:

```ts
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
```

Edit `editor/tsconfig.json` — repoint the path from `src/sdk/index.ts` to the package source (keep tsc resolution simple and explicit). Resulting `paths`:

```json
    "paths": {
      "@/*": ["src/*"],
      "@artisan/editor-sdk": ["packages/editor-sdk/src/index.ts"]
    },
```

> Runtime (vite/vitest) now resolves `@artisan/editor-sdk` via the workspace `node_modules` symlink → package `exports` → `src/index.ts` (proving the real boundary). tsc uses the path as a dev convenience pointing at the same source file. P1c drops the tsc path when publishing to a registry.

- [ ] **Step 9: Verify the whole suite + typecheck stay green**

Run: `rtk vitest run`
Expected: PASS — including the moved `contract/registry.test.ts`, `contract/eventBus.test.ts`, `editor-sdk/src/index.test.ts`, and every existing test that imports `@artisan/editor-sdk` (notably `editor/src/state/wsStore.ts` via its consumers). No "cannot resolve @artisan/editor-sdk".

Run: `rtk npm run typecheck`
Expected: PASS. If tsc reports an unresolved `@artisan/editor-sdk`, confirm Step 8's tsconfig path edit; if it reports unused-locals in moved files, they were already clean — re-check the move was byte-exact.

Run: `rtk grep -n "@/modules/api" src` (or use the editor Grep) — Expected: **no matches** (the only former consumer, `src/sdk/index.ts`, is deleted).

- [ ] **Step 10: Commit**

```bash
rtk git add editor/packages/editor-sdk editor/package.json editor/package-lock.json editor/vite.config.ts editor/vitest.config.ts editor/tsconfig.json
rtk git add -A editor/src/modules/api editor/src/sdk
rtk git commit -m "refactor(editor): extract @artisan/editor-sdk into a real workspace package"
```

(The second `git add -A` on those two specific deleted dirs stages the deletions; paths are explicit, no repo-wide sweep.)

---

## Task 2: `@artisan/quests-editor` skeleton package

A separate package that depends on the SDK and default-exports a `FrontendModule` rendering a trivial screen with an SDK `Button`. Created before the manifest (Task 4) so the manifest's `import("@artisan/quests-editor")` resolves.

**Files:** `editor/packages/quests-editor/{package.json, src/index.ts, src/QuestsScreen.tsx}`; edit `editor/package.json`, `editor/tsconfig.json`.

- [ ] **Step 1: Package manifest**

Create `editor/packages/quests-editor/package.json`:

```json
{
  "name": "@artisan/quests-editor",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@artisan/editor-sdk": "*"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```

- [ ] **Step 2: The trivial screen (consumes the SDK Button + host tokens)**

Create `editor/packages/quests-editor/src/QuestsScreen.tsx`:

```tsx
import { Button } from "@artisan/editor-sdk";

export function QuestsScreen() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="font-display text-2xl font-semibold text-[var(--text)]">Quests</h1>
      <p className="text-[var(--text-mut)]">
        Tracer-bullet module loaded from <code>@artisan/quests-editor</code>.
      </p>
      <Button variant="primary">A base-component button from the SDK</Button>
    </div>
  );
}
```

- [ ] **Step 3: The module entry (default export)**

Create `editor/packages/quests-editor/src/index.ts`:

```ts
import type { FrontendModule } from "@artisan/editor-sdk";
import { QuestsScreen } from "./QuestsScreen";

/**
 * Tracer-bullet external module. Lives in its own package, consumes the SDK as
 * a dependency. P1c promotes this to a separate repo + published packages.
 */
const questsModule: FrontendModule = {
  id: "quests",
  displayName: "Quests",
  schemaVersion: "quests/v1",
  sidebar: { icon: () => null, label: "Quests", to: "/m/quests" },
  routes: [{ path: "/", component: QuestsScreen }],
};

export default questsModule;
```

- [ ] **Step 4: Register the package as a host dependency + tsc path**

Edit `editor/package.json` `dependencies`, add:

```json
    "@artisan/quests-editor": "*",
```

Edit `editor/tsconfig.json` `paths`, add the line so tsc resolves the dynamic import's types:

```json
      "@artisan/quests-editor": ["packages/quests-editor/src/index.ts"]
```

(Resulting `paths` has three entries: `@/*`, `@artisan/editor-sdk`, `@artisan/quests-editor`.)

- [ ] **Step 5: Install + typecheck**

Run: `rtk npm install`
Expected: `editor/node_modules/@artisan/quests-editor` symlinks to the package.

Run: `rtk npm run typecheck`
Expected: PASS (the package compiles against the SDK; `QuestsScreen` typechecks `Button`).

- [ ] **Step 6: Commit**

```bash
rtk git add editor/packages/quests-editor editor/package.json editor/package-lock.json editor/tsconfig.json
rtk git commit -m "feat(editor): add @artisan/quests-editor tracer-bullet module package"
```

---

## Task 3: Presence API client (TDD)

**Files:** Create `editor/src/lib/api/modules.ts`, `editor/src/lib/api/modules.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `editor/src/lib/api/modules.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchActiveModules } from "./modules";

afterEach(() => vi.restoreAllMocks());

describe("fetchActiveModules", () => {
  it("calls the session modules endpoint with the token in the path", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ modules: [{ id: "quests", version: "1.0.0" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchActiveModules("tok123");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/editor-session/tok123/modules"),
    );
    expect(result).toEqual([{ id: "quests", version: "1.0.0" }]);
  });

  it("returns [] on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await fetchActiveModules("bad")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `rtk vitest run src/lib/api/modules.test.ts`
Expected: FAIL — `fetchActiveModules` is not exported / module not found.

- [ ] **Step 3: Implement**

Create `editor/src/lib/api/modules.ts`:

```ts
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface ActiveModule {
  id: string;
  version: string | null;
}

/**
 * Active modules for the current plugin session (presence activation). Source:
 * server_modules, populated at each plugin `hello`. Session-mode only — the
 * endpoint authenticates via the editor-session access token in the path.
 * Returns [] on any non-OK response (treat "no presence info" as "no modules").
 */
export async function fetchActiveModules(accessToken: string): Promise<ActiveModule[]> {
  const res = await fetch(`${API_URL}/api/v1/editor-session/${accessToken}/modules`);
  if (!res.ok) return [];
  const data = (await res.json()) as { modules?: ActiveModule[] };
  return data.modules ?? [];
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `rtk vitest run src/lib/api/modules.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
rtk git add editor/src/lib/api/modules.ts editor/src/lib/api/modules.test.ts
rtk git commit -m "feat(editor): add presence client for active server modules"
```

---

## Task 4: Manifest + reactive integrator store (TDD)

**Files:** Create `editor/src/distribution/modules.manifest.ts`, `editor/src/state/modulesStore.ts`, `editor/src/state/modulesStore.test.ts`.

- [ ] **Step 1: Create the manifest (external modules only)**

Create `editor/src/distribution/modules.manifest.ts`:

```ts
import type { FrontendModule } from "@artisan/editor-sdk";

/**
 * Presence-gated EXTERNAL modules. Core modules (menus, commands) stay
 * hard-registered in main.tsx; only entries here are lazy-loaded and gated on
 * presence. Each `load` resolves the module's default export.
 */
export interface ModuleManifestEntry {
  id: string;
  load: () => Promise<FrontendModule>;
}

export const MODULE_MANIFEST: ModuleManifestEntry[] = [
  { id: "quests", load: () => import("@artisan/quests-editor").then((m) => m.default) },
];
```

- [ ] **Step 2: Write the failing store test**

Create `editor/src/state/modulesStore.test.ts`. It mocks the three collaborators so the integrator logic is tested in isolation (no real registry, no real fetch, no real package):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const registered = new Map<string, unknown>();
const questsMod = {
  id: "quests",
  displayName: "Quests",
  schemaVersion: "quests/v1",
  sidebar: { icon: () => null, label: "Quests", to: "/m/quests" },
  routes: [{ path: "/", component: () => null }],
};
const loadQuests = vi.fn(async () => questsMod);

vi.mock("@artisan/editor-sdk", () => ({
  getModule: (id: string) => registered.get(id),
  registerModule: (m: { id: string }) => registered.set(m.id, m),
}));
vi.mock("@/lib/api/modules", () => ({ fetchActiveModules: vi.fn() }));
vi.mock("@/distribution/modules.manifest", () => ({
  MODULE_MANIFEST: [{ id: "quests", load: loadQuests }],
}));

import { fetchActiveModules } from "@/lib/api/modules";
import { useModulesStore } from "./modulesStore";

beforeEach(() => {
  registered.clear();
  loadQuests.mockClear();
  useModulesStore.setState({ mountedIds: [], status: "idle" });
});

describe("useModulesStore.integrate", () => {
  it("loads + registers an active external module and lists it", async () => {
    vi.mocked(fetchActiveModules).mockResolvedValue([{ id: "quests", version: "1.0.0" }]);

    await useModulesStore.getState().integrate("tok");

    expect(loadQuests).toHaveBeenCalledTimes(1);
    expect(registered.has("quests")).toBe(true);
    expect(useModulesStore.getState().mountedIds).toEqual(["quests"]);
    expect(useModulesStore.getState().status).toBe("ready");
  });

  it("does not load a module that is not active", async () => {
    vi.mocked(fetchActiveModules).mockResolvedValue([]);

    await useModulesStore.getState().integrate("tok");

    expect(loadQuests).not.toHaveBeenCalled();
    expect(useModulesStore.getState().mountedIds).toEqual([]);
  });

  it("is idempotent — a second call is a no-op while not idle", async () => {
    vi.mocked(fetchActiveModules).mockResolvedValue([{ id: "quests", version: "1.0.0" }]);

    await useModulesStore.getState().integrate("tok");
    await useModulesStore.getState().integrate("tok");

    expect(loadQuests).toHaveBeenCalledTimes(1);
    expect(fetchActiveModules).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run it — verify it fails**

Run: `rtk vitest run src/state/modulesStore.test.ts`
Expected: FAIL — `./modulesStore` has no `integrate` / module not found.

- [ ] **Step 4: Implement the store**

Create `editor/src/state/modulesStore.ts`:

```ts
import { create } from "zustand";
import { getModule, registerModule } from "@artisan/editor-sdk";
import { fetchActiveModules } from "@/lib/api/modules";
import { MODULE_MANIFEST } from "@/distribution/modules.manifest";

interface ModulesState {
  /** Ids of external modules currently mounted (active + registered). */
  mountedIds: string[];
  status: "idle" | "loading" | "ready";
  /** Fetch presence for the session, then lazy-load + register active externals. */
  integrate: (accessToken: string) => Promise<void>;
}

export const useModulesStore = create<ModulesState>((set, get) => ({
  mountedIds: [],
  status: "idle",
  async integrate(accessToken: string) {
    // Idempotent: tolerate StrictMode double-invoke / re-render churn.
    if (get().status !== "idle") return;
    set({ status: "loading" });

    const active = await fetchActiveModules(accessToken);
    const activeIds = new Set(active.map((m) => m.id));
    const mounted: string[] = [];

    for (const entry of MODULE_MANIFEST) {
      if (!activeIds.has(entry.id)) continue;
      if (!getModule(entry.id)) {
        const mod = await entry.load();
        registerModule(mod);
      }
      mounted.push(entry.id);
    }

    set({ mountedIds: mounted, status: "ready" });
  },
}));
```

- [ ] **Step 5: Run it — verify it passes**

Run: `rtk vitest run src/state/modulesStore.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 6: Commit**

```bash
rtk git add editor/src/distribution/modules.manifest.ts editor/src/state/modulesStore.ts editor/src/state/modulesStore.test.ts
rtk git commit -m "feat(editor): add module manifest + presence-gated integrator store"
```

---

## Task 5: Catch-all route + resolution helper (TDD for the helper)

**Files:** Create `editor/src/distribution/resolveModule.ts` + `.test.ts`, `editor/src/routes/m.$moduleId.tsx`. Regenerate routes.

- [ ] **Step 1: Write the failing resolver test**

Create `editor/src/distribution/resolveModule.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const registered = new Map<string, unknown>();
vi.mock("@artisan/editor-sdk", () => ({
  getModule: (id: string) => registered.get(id),
}));

import { resolveModule } from "./resolveModule";

const Screen = () => null;

beforeEach(() => registered.clear());

describe("resolveModule", () => {
  it("returns the module's component when registered with a route", () => {
    registered.set("quests", { id: "quests", routes: [{ path: "/", component: Screen }] });
    expect(resolveModule("quests", "ready")).toEqual({ kind: "component", component: Screen });
  });

  it("returns loading when the module is absent and integration is in flight", () => {
    expect(resolveModule("quests", "loading")).toEqual({ kind: "loading" });
  });

  it("returns missing when absent and integration settled", () => {
    expect(resolveModule("quests", "ready")).toEqual({ kind: "missing" });
  });

  it("returns missing when the module has no routes", () => {
    registered.set("quests", { id: "quests", routes: [] });
    expect(resolveModule("quests", "ready")).toEqual({ kind: "missing" });
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `rtk vitest run src/distribution/resolveModule.test.ts`
Expected: FAIL — `resolveModule` not found.

- [ ] **Step 3: Implement the resolver**

Create `editor/src/distribution/resolveModule.ts`:

```ts
import type { ComponentType } from "react";
import { getModule } from "@artisan/editor-sdk";

export type ModuleResolution =
  | { kind: "component"; component: ComponentType }
  | { kind: "loading" }
  | { kind: "missing" };

/** Resolve the host catch-all route to the active module's root component. */
export function resolveModule(
  moduleId: string,
  status: "idle" | "loading" | "ready",
): ModuleResolution {
  const mod = getModule(moduleId);
  if (mod && mod.routes.length > 0) {
    return { kind: "component", component: mod.routes[0].component };
  }
  return status === "loading" ? { kind: "loading" } : { kind: "missing" };
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `rtk vitest run src/distribution/resolveModule.test.ts`
Expected: PASS (all four cases).

- [ ] **Step 5: Create the host-owned catch-all route**

Create `editor/src/routes/m.$moduleId.tsx`:

```tsx
import { createFileRoute, useParams } from "@tanstack/react-router";
import { resolveModule } from "@/distribution/resolveModule";
import { useModulesStore } from "@/state/modulesStore";

export const Route = createFileRoute("/m/$moduleId")({ component: ModuleHost });

function ModuleHost() {
  const { moduleId } = useParams({ from: "/m/$moduleId" });
  // Subscribe to status so the host re-renders when async integration settles.
  const status = useModulesStore((s) => s.status);
  const r = resolveModule(moduleId, status);

  if (r.kind === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center text-[var(--text-mut)]">
        Loading module…
      </div>
    );
  }
  if (r.kind === "missing") {
    return (
      <div className="flex flex-1 items-center justify-center text-[var(--text-mut)]">
        Module not available on this server.
      </div>
    );
  }
  const Cmp = r.component;
  return <Cmp />;
}
```

- [ ] **Step 6: Regenerate the route tree + typecheck**

Run: `rtk npm run generate-routes`
Expected: completes; `editor/src/routeTree.gen.ts` now includes a `MModuleIdRoute` (the `/m/$moduleId` route).

Run: `rtk npm run typecheck`
Expected: PASS — `useParams({ from: "/m/$moduleId" })` typechecks against the regenerated tree.

- [ ] **Step 7: Commit**

```bash
rtk git add editor/src/distribution/resolveModule.ts editor/src/distribution/resolveModule.test.ts editor/src/routes/m.\$moduleId.tsx editor/src/routeTree.gen.ts
rtk git commit -m "feat(editor): host catch-all route /m/\$moduleId renders the active module"
```

---

## Task 6: Registry-driven sidebar "Installed Modules" list (TDD for selection)

**Files:** Create `editor/src/distribution/moduleNav.ts` + `.test.ts`; modify `editor/src/components/WorkspaceSidebar.tsx`.

- [ ] **Step 1: Write the failing selection test**

Create `editor/src/distribution/moduleNav.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const registered = new Map<string, unknown>();
vi.mock("@artisan/editor-sdk", () => ({
  getModule: (id: string) => registered.get(id),
}));

import { selectModuleNavEntries } from "./moduleNav";

beforeEach(() => registered.clear());

describe("selectModuleNavEntries", () => {
  it("returns registered modules that have a route, in id order", () => {
    registered.set("quests", {
      id: "quests",
      sidebar: { icon: () => null, label: "Quests", to: "/m/quests" },
      routes: [{ path: "/", component: () => null }],
    });
    const entries = selectModuleNavEntries(["quests"]);
    expect(entries.map((m) => m.id)).toEqual(["quests"]);
  });

  it("skips ids that are not registered", () => {
    expect(selectModuleNavEntries(["ghost"])).toEqual([]);
  });

  it("skips registered modules with no routes (e.g. core menus/commands)", () => {
    registered.set("menus", {
      id: "menus",
      sidebar: { icon: () => null, label: "Menus", to: "/networks" },
      routes: [],
    });
    expect(selectModuleNavEntries(["menus"])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `rtk vitest run src/distribution/moduleNav.test.ts`
Expected: FAIL — `selectModuleNavEntries` not found.

- [ ] **Step 3: Implement the selection helper**

Create `editor/src/distribution/moduleNav.ts`:

```ts
import { type FrontendModule, getModule } from "@artisan/editor-sdk";

/** Active module ids → the FrontendModules that have a routable screen. */
export function selectModuleNavEntries(ids: string[]): FrontendModule[] {
  return ids
    .map((id) => getModule(id))
    .filter((m): m is FrontendModule => !!m && m.routes.length > 0);
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `rtk vitest run src/distribution/moduleNav.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the list into the sidebar**

Edit `editor/src/components/WorkspaceSidebar.tsx`.

(a) Add imports near the other imports (top of file, after line 32):

```tsx
import { useModulesStore } from "@/state/modulesStore";
import { selectModuleNavEntries } from "@/distribution/moduleNav";
```

(b) Inside `WorkspaceSidebar()`, after the existing store reads (e.g. after line 43 `const reorderPacks = ...`), add:

```tsx
  const mountedModuleIds = useModulesStore((s) => s.mountedIds);
  const moduleNav = selectModuleNavEntries(mountedModuleIds);
```

(c) Replace the placeholder block at lines 273-280:

```tsx
        <div className="mt-4 flex flex-col">
          <div className="px-2 pt-0.5 pb-2 text-[9.5px] font-bold uppercase tracking-[.14em] text-[var(--text-faint)]">
            {t("sidebar.installedModules")}
          </div>
          <div className="rounded-[14px] border border-dashed border-[var(--border)] px-3 py-3 text-center text-[11px] text-[var(--text-faint)]">
            {t("sidebar.noModules")}
          </div>
        </div>
```

with:

```tsx
        <div className="mt-4 flex flex-col">
          <div className="px-2 pt-0.5 pb-2 text-[9.5px] font-bold uppercase tracking-[.14em] text-[var(--text-faint)]">
            {t("sidebar.installedModules")}
          </div>
          {moduleNav.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-[var(--border)] px-3 py-3 text-center text-[11px] text-[var(--text-faint)]">
              {t("sidebar.noModules")}
            </div>
          ) : (
            <ul className="flex flex-col">
              {moduleNav.map((m) => (
                <li key={m.id}>
                  <Link
                    to="/m/$moduleId"
                    params={{ moduleId: m.id }}
                    onClick={() => useSidebarStore.getState().close()}
                    className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] font-medium text-[var(--text-mut)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                  >
                    <span className="truncate flex-1">{m.sidebar.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
```

- [ ] **Step 6: Typecheck + run the sidebar's existing test**

Run: `rtk npm run typecheck`
Expected: PASS — the `<Link to="/m/$moduleId" params={{ moduleId }}>` typechecks against the route added in Task 5.

Run: `rtk vitest run src/components/WorkspaceSidebar.test.tsx`
Expected: PASS — with no active modules `mountedIds` is `[]`, so the placeholder ("noModules") still renders and existing assertions hold.

- [ ] **Step 7: Commit**

```bash
rtk git add editor/src/distribution/moduleNav.ts editor/src/distribution/moduleNav.test.ts editor/src/components/WorkspaceSidebar.tsx
rtk git commit -m "feat(editor): render presence-gated modules in the sidebar"
```

---

## Task 7: Trigger integration on the session token

**Files:** Modify `editor/src/routes/__root.tsx`.

- [ ] **Step 1: Add the integration effect**

Edit `editor/src/routes/__root.tsx`.

(a) Add the import (after line 8, the `useSidebarStore` import):

```tsx
import { useModulesStore } from "@/state/modulesStore";
```

(b) `RootLayoutInner` already reads `const sessionToken = useSessionStore((s) => s.accessToken);` (line 37) and has a `useEffect` at lines 40-43. Add a second effect directly after it:

```tsx
  useEffect(() => {
    if (sessionToken) {
      useModulesStore.getState().integrate(sessionToken);
    }
  }, [sessionToken]);
```

The store's `integrate` is idempotent (guards on `status !== "idle"`), so StrictMode's double-invoke and re-renders are safe.

- [ ] **Step 2: Typecheck**

Run: `rtk npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
rtk git add editor/src/routes/__root.tsx
rtk git commit -m "feat(editor): integrate presence-gated modules when a session token is present"
```

---

## Task 8: Full verification + manual E2E

- [ ] **Step 1: Full suite + typecheck + routes + build**

Run: `rtk vitest run`
Expected: PASS — entire editor suite (≥126 files) green, including the new `modules.test.ts`, `modulesStore.test.ts`, `resolveModule.test.ts`, `moduleNav.test.ts`, and the relocated SDK tests.

Run: `rtk npm run typecheck`
Expected: PASS.

Run: `rtk npm run build`
Expected: PASS — Vite bundles the host + both linked workspace packages (the `optimizeDeps.exclude` keeps them as source). If the build fails resolving `@artisan/quests-editor`, confirm Task 2 Step 5's `npm install` created the symlink and the package's `exports` points at `./src/index.ts`.

- [ ] **Step 2: Manual E2E — module appears when present**

The plugin doesn't ship a quests JAR yet (that's P1c), so seed presence directly in the dev DB.

1. Start the stack (backend on 3001, editor on 5173) and connect a dev Minecraft server via the trust dance (`/artisan editor` in-game → open the printed URL). This puts the editor in **session mode** (a `server_modules` row already exists for `menus`/`commands`).
2. Find the session's `server_key` id:
   ```sql
   SELECT id, label FROM server_keys ORDER BY created_at DESC LIMIT 5;
   ```
3. Seed a `quests` presence row for that server key:
   ```sql
   INSERT INTO server_modules (server_key_id, module_id, version, last_seen)
   VALUES ('<server_key_id>', 'quests', '0.1.0', now())
   ON CONFLICT (server_key_id, module_id) DO UPDATE SET last_seen = now();
   ```
4. Reload the editor. **Expected:** the sidebar "Installed Modules" section lists **Quests**. Click it → URL `/m/quests` → the `QuestsScreen` renders with the heading and a **primary-styled SDK `Button`** (proves the external package consumed `@artisan/editor-sdk`'s `Button` and inherited the host's `globals.css` `.btn-primary` tokens).
5. Delete the row and reload:
   ```sql
   DELETE FROM server_modules WHERE module_id = 'quests';
   ```
   **Expected:** "Quests" disappears; navigating to `/m/quests` shows "Module not available on this server."

> Caveat: the seeded row is pruned on the plugin's next `hello` (the plugin doesn't report `quests`). For a stable manual run, seed right before testing or pause the plugin's reconnect. Real plugin-driven presence is P1c.

- [ ] **Step 3: Final commit (if any verification fixes were needed)**

```bash
rtk git add -A editor
rtk git commit -m "test(editor): verify P1b editor module seam end-to-end"
```

(Only if Step 1/2 required fixes; otherwise skip.)

---

## Self-Review notes (for the executor)

- **Spec coverage** (against `2026-06-17-first-party-module-extensibility-design.md` §5 P1, editor slice): real `@artisan/editor-sdk` package ✓ (Task 1); skeleton external `@artisan/quests-editor` ✓ (Task 2); integrator + manifest replacing hard wiring for externals ✓ (Tasks 3-4, 7); presence read + conditional mount ✓ (Tasks 3-4, 7); catch-all route ✓ (Task 5); sidebar-from-registry ✓ (Task 6); lazy `import()` ✓ (Task 4). Deferred-by-design items are listed under "Scope boundaries" (real repo/publish = P1c; SDK fattening = P2; splat sub-routing + user-mode presence + full manifest assembly = P3).
- **Idempotency:** the registry `registerModule` throws on duplicate; `modulesStore.integrate` guards with `getModule(id)` before registering and with `status !== "idle"` against re-entry — both StrictMode-safe.
- **Type names are consistent across tasks:** `fetchActiveModules`, `ActiveModule`, `ModuleManifestEntry`, `MODULE_MANIFEST`, `useModulesStore` (`mountedIds`, `status`, `integrate`), `resolveModule`/`ModuleResolution`, `selectModuleNavEntries`. Route id `/m/$moduleId`. Module id `quests`.
- **No host behavior change for core modules:** `main.tsx` keeps registering `menus`/`commands`; they have `routes: []` so they never appear in the catch-all nav and keep their existing file-based routes + workspace sidebar.
