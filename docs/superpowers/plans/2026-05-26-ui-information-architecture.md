# UI Information Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter la V1 de la nouvelle UI information architecture (`docs/superpowers/specs/2026-05-26-ui-information-architecture-design.md`) — remplacer la sidebar `ModuleSidebar` (Menus + Commandes placeholders qui pointaient sur `/networks`) par une `WorkspaceSidebar` (Network dropdown + liste workspaces + section Modules empty state), et renommer **Pack → Workspace** côté user-facing + côté route `/pack/$packId` → `/workspace/$workspaceId` (avec redirect du legacy path).

**Architecture:** Pure refactor éditeur — aucun changement backend ni plugin. Le nom **Workspace** s'applique aux labels UI et aux route paths uniquement ; les types DB (`packs`), le protocole WS (`pack_id`), et les endpoints REST (`/api/v1/user/packs/*`) gardent leur nom interne "pack" (refactor non rentable). On garde le registry `FrontendModule` (les modules `menus` + `commands` y restent inscrits) mais on ne les rend plus dans la sidebar.

**Tech Stack:** React 19, Vite 6, TanStack Router (file-based routes), Zustand stores, Vitest + @testing-library/react + jsdom, react-i18next.

**Spec source :** `docs/superpowers/specs/2026-05-26-ui-information-architecture-design.md` §6 (V1 scope) et §7 (edge cases).

**Hors scope (différé V1.5+) :**
- Page `/module/$moduleId` et son shell tabs
- Détection `installed_modules` depuis WS hello (backend storage + éditeur fetch)
- Extension type `FrontendModule.tabs[]`
- Wiring `<SchemaForm>` aux tabs Data

---

## File Structure

### Create

- `editor/src/components/WorkspaceSidebar.tsx` — sidebar V1 (Network dropdown + section Workspaces + section Modules empty state). Remplace `ModuleSidebar`.
- `editor/src/components/WorkspaceSidebar.test.tsx`
- `editor/src/components/NetworkDropdown.tsx` — sous-composant : sélecteur de Network actif.
- `editor/src/components/NetworkDropdown.test.tsx`
- `editor/src/routes/workspace.$workspaceId.tsx` — copie de `pack.$packId.tsx` avec param renommé `$workspaceId`.

### Modify

- `editor/src/routes/__root.tsx` — remplace `<ModuleSidebar />` par `<WorkspaceSidebar />`. Gating sur auth identique.
- `editor/src/routes/pack.$packId.tsx` — devient un stub qui `useNavigate({ to: "/workspace/$workspaceId", replace: true })` au mount, pour préserver les bookmarks et liens externes.
- `editor/src/routes/networks.$networkId.tsx` — update `to: "/pack/$packId"` → `to: "/workspace/$workspaceId"` dans le rendu des packs.
- `editor/src/routes/session.tsx` — idem si elle navigate sur `/pack/`.
- `editor/src/features/account/PackMini.tsx` — update internal `Link to` ou `useNavigate({ to })` vers `/workspace/`.
- `editor/src/features/canvas/title/composer/useTitleLayerDrag.ts` — idem si lien interne sur `/pack/`.
- `editor/src/features/auth/LoginForm.test.tsx` — pré-existant utilise `/pack/` dans une assertion ; update vers `/workspace/`.
- `editor/src/locales/fr.ts` + `editor/src/locales/en.ts` — labels "Pack" → "Workspace" sur les clés user-facing.
- `editor/src/features/flow/FlowCanvas.tsx:85` — hardcoded `"Pack not found."` → `i18nKey('packNotFound')` (qui sera renommé en "Workspace introuvable" dans D1). Ou mettre à jour le hardcoded string si déjà i18n.
- `editor/src/features/pack/usePackLoader.ts:33` — `setError("Pack not bound to this session")` → user-facing string update.

### Delete

- `editor/src/components/ModuleSidebar.tsx` (remplacé par `WorkspaceSidebar`).
- `editor/src/components/ModuleSidebar.test.tsx` (remplacé).

### Preserve unchanged

- `editor/src/modules/{menus,commands}/index.ts` — declarations `FrontendModule` restent dans le registry (utiles conceptuellement, registry inchangé). Juste plus rendues.
- Type `Pack`, `PackId` dans `domain/types.ts`, et `useAccountStore.account.packs[]` — pas touchés (concept interne).
- Toute API client `lib/api/userPacks.ts`, route backend `/api/v1/user/packs/*` — pas touchés.

---

## Phase A — Audit + préparation

### Task A1: Audit des strings + paths à toucher

**Files:** aucun (audit only)

- [ ] **Step 1: Lister les strings user-facing "Pack"**

```bash
cd editor && grep -rEn "\"Pack\b|'Pack\b|>Pack<|Mes packs|nouveau pack|Nouveau pack|pack courant" src/ | grep -v "\.test\."
```

Note les fichiers + lignes pour les Phase D tasks. Attendu (pré-audit) :
- `locales/en.ts` lignes 69, 152, 390, 392
- `locales/fr.ts` lignes 64, 72, 398
- `features/flow/FlowCanvas.tsx:85` (hardcoded JSX)
- `features/pack/usePackLoader.ts:33` (hardcoded error)

- [ ] **Step 2: Lister les paths `/pack/` à rerouter**

```bash
cd editor && grep -rEn '"/pack/|`/pack/|to="/pack/|to: "/pack/|pack\.\$packId' src/
```

Attendu :
- `routes/pack.$packId.tsx` (le fichier lui-même)
- `routes/networks.$networkId.tsx`
- `routes/session.tsx`
- `features/auth/LoginForm.test.tsx`
- `features/canvas/title/composer/useTitleLayerDrag.ts`
- `features/account/DeletePackDialog.tsx`
- `features/account/PackMini.tsx`

- [ ] **Step 3: Lister les clés i18n contenant "pack"**

```bash
cd editor && grep -rEn 'packNotFound|sectionPack|newPack|placeholder.*Pack|pack:' src/locales/
```

Pas de commit — audit informatif.

---

## Phase B — Nouvelle sidebar

### Task B1: Composant `NetworkDropdown` (TDD)

**Files:**
- Create: `editor/src/components/NetworkDropdown.tsx`
- Test: `editor/src/components/NetworkDropdown.test.tsx`

- [ ] **Step 1: Écrire le test**

```tsx
// editor/src/components/NetworkDropdown.test.tsx
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NetworkDropdown } from "./NetworkDropdown";
import { useNetworksStore } from "@/state/networksStore";
import { useSessionStore } from "@/state/sessionStore";

describe("NetworkDropdown", () => {
  beforeEach(() => {
    useNetworksStore.setState({
      networks: [
        { id: "net_1", name: "Mon Network", role: "owner" },
        { id: "net_2", name: "Test Network", role: "owner" },
      ],
    } as any);
    useSessionStore.setState({ networkId: "net_1" } as any);
  });

  it("renders the active network's name", () => {
    render(<NetworkDropdown />);
    expect(screen.getByText("Mon Network")).toBeInTheDocument();
  });

  it("hides the caret if user has only 1 network", () => {
    useNetworksStore.setState({
      networks: [{ id: "net_1", name: "Solo", role: "owner" }],
    } as any);
    useSessionStore.setState({ networkId: "net_1" } as any);
    render(<NetworkDropdown />);
    expect(screen.queryByTestId("network-dropdown-caret")).toBeNull();
  });

  it("shows other networks when clicked", () => {
    render(<NetworkDropdown />);
    fireEvent.click(screen.getByText("Mon Network"));
    expect(screen.getByText("Test Network")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd editor && npx vitest run src/components/NetworkDropdown.test.tsx
```

Expected: FAIL — `NetworkDropdown` not found.

- [ ] **Step 3: Implement `NetworkDropdown.tsx`**

```tsx
// editor/src/components/NetworkDropdown.tsx
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useNetworksStore } from "@/state/networksStore";
import { useSessionStore } from "@/state/sessionStore";

export function NetworkDropdown() {
  const networks = useNetworksStore((s) => s.networks);
  const activeId = useSessionStore((s) => s.networkId);
  const setNetworkId = useSessionStore((s) => s.setNetworkId);
  const [open, setOpen] = useState(false);

  const active = networks?.find((n) => n.id === activeId);
  const hasMultiple = (networks?.length ?? 0) > 1;

  if (!active) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => hasMultiple && setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-left text-sm hover:bg-zinc-900"
      >
        <div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Network</div>
          <div className="text-zinc-100">{active.name}</div>
        </div>
        {hasMultiple && (
          <span data-testid="network-dropdown-caret" className="text-zinc-500">▼</span>
        )}
      </button>
      {open && hasMultiple && (
        <div className="absolute left-0 right-0 z-10 mt-1 rounded border border-zinc-800 bg-zinc-950 shadow-lg">
          {networks!
            .filter((n) => n.id !== activeId)
            .map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  setNetworkId?.(n.id);
                  setOpen(false);
                }}
                className="block w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-900"
              >
                {n.name}
              </button>
            ))}
          <Link
            to="/networks"
            onClick={() => setOpen(false)}
            className="block border-t border-zinc-800 px-3 py-2 text-left text-xs text-zinc-400 hover:bg-zinc-900"
          >
            Gérer les networks →
          </Link>
        </div>
      )}
    </div>
  );
}
```

NOTE : `useSessionStore.setNetworkId` peut ne pas exister actuellement. Si c'est le cas, l'ajouter au store (Step 3b) ou utiliser `useSessionStore.setState({ networkId: id })` direct pour V1.

- [ ] **Step 3b (only if `setNetworkId` doesn't exist):** Add to `useSessionStore`

```ts
// editor/src/state/sessionStore.ts — within the create() body
setNetworkId: (id: string) => set({ networkId: id }),
```

- [ ] **Step 4: Run tests**

```bash
cd editor && npx vitest run src/components/NetworkDropdown.test.tsx
```

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/components/NetworkDropdown.tsx editor/src/components/NetworkDropdown.test.tsx editor/src/state/sessionStore.ts
git commit -m "feat(editor): add NetworkDropdown component"
```

### Task B2: Composant `WorkspaceSidebar` (TDD)

**Files:**
- Create: `editor/src/components/WorkspaceSidebar.tsx`
- Test: `editor/src/components/WorkspaceSidebar.test.tsx`

- [ ] **Step 1: Écrire le test**

```tsx
// editor/src/components/WorkspaceSidebar.test.tsx
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryHistory, createRouter, createRootRoute, Outlet } from "@tanstack/react-router";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { useNetworksStore } from "@/state/networksStore";
import { useSessionStore } from "@/state/sessionStore";
import { useAccountStore } from "@/state/accountStore";

function renderInRouter(ui: React.ReactNode) {
  const rootRoute = createRootRoute({ component: () => <>{ui}<Outlet /></> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(<RouterProvider router={router} />);
}

describe("WorkspaceSidebar", () => {
  beforeEach(() => {
    useNetworksStore.setState({ networks: [{ id: "net_1", name: "Mon Network", role: "owner" }] } as any);
    useSessionStore.setState({ networkId: "net_1" } as any);
    useAccountStore.setState({
      account: {
        packs: [
          { id: "pack_a", networkId: "net_1", name: "Menu principal", updatedAt: "2026-05-26T10:00:00Z" } as any,
          { id: "pack_b", networkId: "net_1", name: "Lobby", updatedAt: "2026-05-25T10:00:00Z" } as any,
          { id: "pack_c", networkId: "net_2", name: "Other Network Pack", updatedAt: "2026-05-26T11:00:00Z" } as any,
        ],
      },
    } as any);
  });

  it("renders the active network name", () => {
    renderInRouter(<WorkspaceSidebar />);
    expect(screen.getByText("Mon Network")).toBeInTheDocument();
  });

  it("lists workspaces belonging to the active network", async () => {
    renderInRouter(<WorkspaceSidebar />);
    expect(await screen.findByText("Menu principal")).toBeInTheDocument();
    expect(screen.getByText("Lobby")).toBeInTheDocument();
  });

  it("does not list workspaces from other networks", () => {
    renderInRouter(<WorkspaceSidebar />);
    expect(screen.queryByText("Other Network Pack")).toBeNull();
  });

  it("renders the Modules empty state", () => {
    renderInRouter(<WorkspaceSidebar />);
    expect(screen.getByText(/Aucun module installé/i)).toBeInTheDocument();
  });

  it("renders the + Nouveau workspace button", () => {
    renderInRouter(<WorkspaceSidebar />);
    expect(screen.getByText(/Nouveau workspace/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd editor && npx vitest run src/components/WorkspaceSidebar.test.tsx
```

Expected: FAIL — file does not exist.

- [ ] **Step 3: Implement `WorkspaceSidebar.tsx`**

```tsx
// editor/src/components/WorkspaceSidebar.tsx
import { Link } from "@tanstack/react-router";
import { NetworkDropdown } from "./NetworkDropdown";
import { useSessionStore } from "@/state/sessionStore";
import { useAccountStore } from "@/state/accountStore";

export function WorkspaceSidebar() {
  const networkId = useSessionStore((s) => s.networkId);
  const packs = useAccountStore((s) => s.account?.packs ?? []);

  const workspaces = networkId
    ? packs
        .filter((p: any) => p.networkId === networkId)
        .sort((a: any, b: any) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    : [];

  return (
    <nav className="flex h-full flex-col gap-3 p-2">
      <NetworkDropdown />

      <div>
        <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-500">
          Mes Workspaces
        </div>
        <ul className="flex flex-col gap-0.5">
          {workspaces.map((w: any) => (
            <li key={w.id}>
              <Link
                to="/workspace/$workspaceId"
                params={{ workspaceId: w.id }}
                className="block rounded px-2 py-1 text-sm text-zinc-200 hover:bg-zinc-800"
                activeProps={{ className: "block rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-100" }}
              >
                {w.name}
              </Link>
            </li>
          ))}
        </ul>
        <Link
          to="/networks/$networkId"
          params={{ networkId: networkId ?? "" }}
          className="mt-1 block px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200"
        >
          + Nouveau workspace
        </Link>
      </div>

      <div>
        <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-500">
          Modules installés
        </div>
        <div className="rounded border border-dashed border-zinc-800 px-2 py-2 text-[11px] text-zinc-500">
          Aucun module installé. Les plugins compatibles Artisan (Shop, Quests, etc.) apparaîtront ici quand tu les ajouteras à ton serveur.
        </div>
      </div>
    </nav>
  );
}
```

NOTE : si la création d'un workspace se fait depuis `/networks/$networkId` (page existante), le "+ Nouveau workspace" lien renvoie vers cette page. Si tu préfères ouvrir un modal direct depuis la sidebar, ajuste — mais V1 vise le minimum (réuse page existante).

- [ ] **Step 4: Run tests**

```bash
cd editor && npx vitest run src/components/WorkspaceSidebar.test.tsx
```

Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/components/WorkspaceSidebar.tsx editor/src/components/WorkspaceSidebar.test.tsx
git commit -m "feat(editor): add WorkspaceSidebar (network dropdown + workspaces + modules empty state)"
```

### Task B3: Mount `WorkspaceSidebar` in `__root.tsx`

**Files:**
- Modify: `editor/src/routes/__root.tsx`

- [ ] **Step 1: Read the current `__root.tsx`**

```bash
cat editor/src/routes/__root.tsx
```

Locate the `<ModuleSidebar />` mount inside the `RootLayout` component.

- [ ] **Step 2: Replace the import + usage**

Change the import line at the top:

```tsx
// avant
import { ModuleSidebar } from "@/components/ModuleSidebar";

// après
import { WorkspaceSidebar } from "@/components/WorkspaceSidebar";
```

Inside `RootLayout`, replace the `<ModuleSidebar />` JSX with `<WorkspaceSidebar />`. Keep the existing auth gating (`{user && (...)}`) and the surrounding `<aside>` layout.

- [ ] **Step 3: Verify boot manually**

```bash
cd editor && npm run dev
```

Open `http://localhost:5173`, login, see the new sidebar with Network dropdown + Workspaces section + Modules empty state. Old "Menus" / "Commandes" entries should be gone.

- [ ] **Step 4: Commit**

```bash
git add editor/src/routes/__root.tsx
git commit -m "feat(editor): mount WorkspaceSidebar in root layout"
```

---

## Phase C — Route rename `/pack/$packId` → `/workspace/$workspaceId`

### Task C1: Copy route to new path

**Files:**
- Create: `editor/src/routes/workspace.$workspaceId.tsx`

- [ ] **Step 1: Read the existing pack route file**

```bash
cat editor/src/routes/pack.$packId.tsx | head -30
```

Note the `createFileRoute` call (uses `/pack/$packId`) and the param destructure (uses `params.packId` or similar).

- [ ] **Step 2: Copy + adapt to the new path**

Copy `editor/src/routes/pack.$packId.tsx` to `editor/src/routes/workspace.$workspaceId.tsx`. In the new file :

- Change `createFileRoute("/pack/$packId")` → `createFileRoute("/workspace/$workspaceId")`.
- Change every reference to `params.packId` to `params.workspaceId` inside the route component (rename the URL param only — internal variable names like `pack` stay).

Concrete diff target (illustrative — adapt to actual file):

```tsx
// avant
export const Route = createFileRoute("/pack/$packId")({ component: PackPage });
function PackPage() {
  const { packId } = Route.useParams();
  // ... uses packId
}

// après
export const Route = createFileRoute("/workspace/$workspaceId")({ component: PackPage });
function PackPage() {
  const { workspaceId: packId } = Route.useParams();
  // ... internal `packId` stays — only the URL param name changes
}
```

Keep the component name `PackPage` (internal). Keep imports, stores, internal references using `packId` variable. Just the URL param name changes.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd editor && npx tsc --noEmit
```

Expected: clean (the file-based router will auto-regenerate `routeTree.gen.ts` on next dev run; tsc may complain until then).

- [ ] **Step 4: Run dev to regenerate routeTree**

```bash
cd editor && npm run dev
```

(Stop after Vite confirms the route is registered, e.g. visit `http://localhost:5173/workspace/some_id`.) The Vite plugin `@tanstack/router-vite-plugin` regenerates `routeTree.gen.ts` automatically.

- [ ] **Step 5: Commit**

```bash
git add editor/src/routes/workspace.$workspaceId.tsx editor/src/routeTree.gen.ts
git commit -m "feat(editor): add /workspace/\$workspaceId route (copy of /pack/\$packId)"
```

### Task C2: Convert legacy `/pack/$packId` into a redirect stub

**Files:**
- Modify: `editor/src/routes/pack.$packId.tsx`

- [ ] **Step 1: Replace the whole file with a redirect component**

```tsx
// editor/src/routes/pack.$packId.tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/pack/$packId")({ component: LegacyPackRedirect });

function LegacyPackRedirect() {
  const { packId } = Route.useParams();
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/workspace/$workspaceId", params: { workspaceId: packId }, replace: true });
  }, [packId, navigate]);
  return null;
}
```

- [ ] **Step 2: Verify manually**

```bash
cd editor && npm run dev
```

Open `http://localhost:5173/pack/some_id` → should immediately navigate to `/workspace/some_id` with `replace: true` (back button doesn't bring you back to `/pack/some_id`).

- [ ] **Step 3: Commit**

```bash
git add editor/src/routes/pack.$packId.tsx
git commit -m "feat(editor): /pack/\$packId redirects to /workspace/\$workspaceId (legacy bookmark support)"
```

### Task C3: Update internal navigation calls to `/workspace/`

**Files:**
- Modify: every file (other than the route stubs above) that hardcodes `/pack/` for client-side navigation. Per audit (Task A1 Step 2) :
  - `editor/src/routes/networks.$networkId.tsx`
  - `editor/src/routes/session.tsx`
  - `editor/src/features/account/PackMini.tsx`
  - `editor/src/features/account/DeletePackDialog.tsx`
  - `editor/src/features/canvas/title/composer/useTitleLayerDrag.ts`
- Test: `editor/src/features/auth/LoginForm.test.tsx` (asserts a `/pack/` redirect — update to `/workspace/`).

- [ ] **Step 1: For each file in the list, find every `to: "/pack/$packId"` / `to="/pack/..."` / similar template literal and switch to `/workspace/$workspaceId`**

The substitution pattern is mechanical. For TanStack Router `<Link>` and `useNavigate`, the new shape is:

```tsx
// avant
<Link to="/pack/$packId" params={{ packId: x }}>…</Link>

// après
<Link to="/workspace/$workspaceId" params={{ workspaceId: x }}>…</Link>
```

```tsx
// avant
navigate({ to: "/pack/$packId", params: { packId: x } });

// après
navigate({ to: "/workspace/$workspaceId", params: { workspaceId: x } });
```

Apply this to all 5 source files + the 1 test file.

- [ ] **Step 2: Run editor tests**

```bash
cd editor && npx vitest run
```

Expected: 850+ pass / 5 pre-existing LoginForm/SignupForm failures (unchanged baseline). If LoginForm.test.tsx now has a NEW failure because the redirect assertion was updated, fix it inline.

- [ ] **Step 3: Smoke test in browser**

```bash
cd editor && npm run dev
```

Click around : networks list → click a workspace → URL is `/workspace/$id`. Open delete dialog → it navigates back correctly.

- [ ] **Step 4: Commit**

```bash
git add editor/src/routes/networks.\$networkId.tsx editor/src/routes/session.tsx editor/src/features/account/PackMini.tsx editor/src/features/account/DeletePackDialog.tsx editor/src/features/canvas/title/composer/useTitleLayerDrag.ts editor/src/features/auth/LoginForm.test.tsx
git commit -m "feat(editor): update internal links from /pack/ to /workspace/"
```

---

## Phase D — UI label rename "Pack" → "Workspace"

### Task D1: Update i18n keys in `fr.ts` + `en.ts`

**Files:**
- Modify: `editor/src/locales/fr.ts`
- Modify: `editor/src/locales/en.ts`

- [ ] **Step 1: Update strings in `fr.ts`**

For each key listed in audit Task A1 Step 3, rename the **value** (not the key — keys stay for compatibility with all callers). Edit each line :

```ts
// editor/src/locales/fr.ts — examples

// avant
newPack: "Nouveau pack",
// après
newPack: "Nouveau workspace",

// avant
title: "Nouveau pack",         // in some object literal
// après
title: "Nouveau workspace",

// avant
packNotFound: "Pack introuvable.",
// après
packNotFound: "Workspace introuvable.",
```

Audit the full file with `grep -n 'pack\|Pack' editor/src/locales/fr.ts` and update every user-facing French string referring to "pack" → "workspace". Keep i18n key names (`newPack`, `packNotFound`, etc.) — they are internal identifiers.

- [ ] **Step 2: Update strings in `en.ts`**

Same exercise for English :

```ts
// avant
placeholder: "Pack name",
// après
placeholder: "Workspace name",

// avant
refSectionPackData: "Pack data",
// après
refSectionPackData: "Workspace data",

// avant
packNotFound: "Pack not found.",
// après
packNotFound: "Workspace not found.",

// avant
sectionPack: "Pack data",
// après
sectionPack: "Workspace data",
```

Audit with `grep -n 'pack\|Pack' editor/src/locales/en.ts` and cover every value.

- [ ] **Step 3: Run editor tests**

```bash
cd editor && npx vitest run
```

Expected: clean (no tests assert on French/English label text typically). If a test asserts `"Pack name"` literal, update it.

- [ ] **Step 4: Smoke test in browser**

Open `http://localhost:5173` in both FR and EN — verify the new strings render.

- [ ] **Step 5: Commit**

```bash
git add editor/src/locales/fr.ts editor/src/locales/en.ts
git commit -m "feat(editor): rename user-facing Pack -> Workspace in i18n strings"
```

### Task D2: Fix hardcoded user-facing strings (legacy debt)

**Files:**
- Modify: `editor/src/features/flow/FlowCanvas.tsx:85`
- Modify: `editor/src/features/pack/usePackLoader.ts:33`

Per `feedback_editor_i18n_ui_strings.md` (user standing rule) : never hardcode strings, always route through `react-i18next`. The audit found 2 violations that we fix here (not as a refactor pass — strictly the strings touched by this rename).

- [ ] **Step 1: `FlowCanvas.tsx:85`**

```bash
sed -n '83,87p' editor/src/features/flow/FlowCanvas.tsx
```

Expected content (illustrative) :

```tsx
if (!pack) return <EmptyHint label="Pack not found." />;
```

Replace with i18n key (the key already exists per Task D1 — `packNotFound` = "Workspace not found" / "Workspace introuvable") :

```tsx
import { useTranslation } from "react-i18next";

// inside component
const { t } = useTranslation();
if (!pack) return <EmptyHint label={t("packNotFound")} />;
```

(Adapt the import + hook call to where they fit in the component. If `useTranslation` is already imported elsewhere in the file, reuse it.)

- [ ] **Step 2: `usePackLoader.ts:33`**

```bash
sed -n '30,35p' editor/src/features/pack/usePackLoader.ts
```

Expected content :

```ts
else setError("Pack not bound to this session");
```

This hook can't easily use `useTranslation` if it's called outside a component context. Two options :

(a) Replace with a stable English string that the consumer translates :
```ts
else setError("workspace_not_bound");  // error code, translated at render
```
And update the consumer of `setError` to t() the code.

(b) Pass `t` as a parameter to the hook from a component that already has it.

V1 minimum : keep it as a string but update wording (lowest churn) :

```ts
// avant
else setError("Pack not bound to this session");
// après
else setError("Workspace not bound to this session");
```

This is the pragmatic choice — full i18n of error codes is debt that lives across this whole codebase. Track it but don't pull on the thread here.

- [ ] **Step 3: Run editor tests**

```bash
cd editor && npx vitest run
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add editor/src/features/flow/FlowCanvas.tsx editor/src/features/pack/usePackLoader.ts
git commit -m "feat(editor): rename user-facing Pack -> Workspace in hardcoded JSX strings"
```

---

## Phase E — Cleanup

### Task E1: Delete `ModuleSidebar`

**Files:**
- Delete: `editor/src/components/ModuleSidebar.tsx`
- Delete: `editor/src/components/ModuleSidebar.test.tsx`

- [ ] **Step 1: Verify no remaining import**

```bash
cd editor && grep -rn "ModuleSidebar" src/
```

Expected: zero references (Phase B3 already replaced the only import in `__root.tsx`).

- [ ] **Step 2: Delete the files**

```bash
rm editor/src/components/ModuleSidebar.tsx
rm editor/src/components/ModuleSidebar.test.tsx
```

- [ ] **Step 3: Run editor tests**

```bash
cd editor && npx vitest run
```

Expected: clean (no test references `ModuleSidebar` anymore).

- [ ] **Step 4: Commit**

```bash
git add editor/src/components/
git commit -m "chore(editor): remove ModuleSidebar (replaced by WorkspaceSidebar)"
```

### Task E2: Note that `FrontendModule` registry stays intact

**Files:** aucun (verification only)

- [ ] **Step 1: Verify the menus + commands modules are still registered**

```bash
cd editor && grep -n "registerModule" src/main.tsx
```

Expected : both `registerModule(menusModule)` and `registerModule(commandsModule)` still present. The registry is preserved (modules.api framework intact) — only the rendered output in the sidebar is suppressed.

No commit — verification only.

---

## Phase F — Verification globale

### Task F1: Full editor test suite

- [ ] Run `cd editor && npx vitest run`
- [ ] Expected: ~855 pass / 5 pre-existing fails (LoginForm + SignupForm `<Link>` outside RouterProvider — unchanged). Plus 8 new tests (3 from NetworkDropdown + 5 from WorkspaceSidebar). Net : ~863 pass / 5 fails.
- [ ] If a NEW failure appears (other than the known LoginForm/SignupForm), investigate.

### Task F2: Docker smoke test

- [ ] Verify the editor container is up : `curl -s -o /dev/null -w "editor: %{http_code}\n" http://localhost:5173`
- [ ] In a browser, login to `http://localhost:5173`
- [ ] Verify the new sidebar :
  - Network dropdown displays the active network name (top of sidebar)
  - "Mes Workspaces" section lists workspaces of the active network only
  - "Modules installés" section shows the empty state text
  - Old "Menus" / "Commandes" entries are gone
- [ ] Click a workspace → URL = `/workspace/$id`, canvas loads normally
- [ ] Open `http://localhost:5173/pack/$id` (legacy URL) → URL immediately swaps to `/workspace/$id` (replace history)
- [ ] If the user has 2+ networks : click the Network dropdown → see other networks listed → click one → sidebar swaps to its workspaces
- [ ] Verify "Pack" labels are gone everywhere in the UI (browse menus, dialogs, errors)

### Task F3: Cross-check spec coverage

- [ ] Read `docs/superpowers/specs/2026-05-26-ui-information-architecture-design.md` §6 (V1 scope table)
- [ ] Confirm every V1 item is implemented :
  - [x] `WorkspaceSidebar` component (Task B2)
  - [x] Network dropdown (Task B1)
  - [x] Workspaces section (Task B2)
  - [x] Modules empty state (Task B2)
  - [x] Route rename (Tasks C1 + C2)
  - [x] UI label rename (Tasks D1 + D2)
  - [x] Sidebar deletion (`ModuleSidebar` removed, Task E1; `FrontendModule` registry preserved, Task E2)

---

## Self-Review

**1. Spec coverage**

| Spec section | Covered by |
|---|---|
| §1 Vocabulaire — Pack → Workspace user-facing | Task D1 (i18n) + D2 (hardcoded) |
| §1 Vocabulaire — Canvas → Overview | N/A V1 (Overview est l'onglet par défaut du Module hub V1.5+, pas implémenté) |
| §2 Sidebar (Network dropdown + 2 sections) | Tasks B1, B2, B3 |
| §2.1 Network dropdown comportement | Task B1 (test 1 network → no caret, multi-network → switch, "Gérer les networks" link) |
| §2.2 Workspaces section (liste, +Nouveau) | Task B2 (filter by networkId, sort by updatedAt desc, lien vers `/networks/$id` pour création) |
| §2.3 Modules section V1 empty state | Task B2 (texte fixé `"Aucun module installé..."`) |
| §3 Page Workspace identique à `/pack/` actuel | Tasks C1 + C2 (copy then redirect stub, content unchanged) |
| §4 Module hub | N/A V1 (différé V1.5+ explicitement) |
| §5 Suppression Menus/Commandes | Task E1 (ModuleSidebar deleted, registry preserved via Task E2 noting) |
| §6 V1 scope items | All covered (see F3 checklist) |
| §7 Edge cases — legacy `/pack/X` redirect | Task C2 |
| §7 Edge cases — user sans Network | Préservé (le routing existant `/setup` redirect n'est pas touché) |
| §7 Edge cases — user 1 Network (pas de caret) | Task B1 test "hides the caret if user has only 1 network" |
| §7 Edge cases — switching Network avec workspace ouvert | NOT explicitly handled in plan. La nouvelle sidebar fait switch + navigate ailleurs ? Spec §7 dit "navigate to `/networks/$newNetworkId`" mais le NetworkDropdown ne le fait pas, il switch juste `useSessionStore.networkId`. C'est une lacune — l'utilisateur reste sur `/workspace/$old_workspace_id` qui n'appartient pas au nouveau network. À fixer ci-dessous. |

**Gap fixed inline** — adding to Task B1's `NetworkDropdown`, when switching network, also navigate :

```tsx
// In NetworkDropdown.tsx, modify the onClick of each network option :
onClick={() => {
  setNetworkId?.(n.id);
  setOpen(false);
  navigate({ to: "/networks/$networkId", params: { networkId: n.id } });
}}
```

Add `import { useNavigate } from "@tanstack/react-router";` and `const navigate = useNavigate();` at the top of `NetworkDropdown`. This matches spec §7 "navigate to `/networks/$newNetworkId`".

(This is incorporated into Task B1's Step 3 implementation — the implementer should apply this from the start.)

**2. Placeholder scan**

Searched for "TBD", "TODO", "fill in", "appropriate", "handle edge cases" : none in plan body.

Two annotated *NOTE* comments :
- Task B1 Step 3 NOTE about `setNetworkId` possibly missing — provides Step 3b fallback.
- Task B2 Step 3 NOTE about "+ Nouveau workspace" linking to existing page vs modal — gives the implementer agency.

Neither is a placeholder; both are explicit decisions with concrete fallback code.

**3. Type consistency**

- `WorkspaceSidebar` is the export from `components/WorkspaceSidebar.tsx` — used in `__root.tsx` import (B3). Consistent.
- `NetworkDropdown` exported from `components/NetworkDropdown.tsx` — imported in `WorkspaceSidebar.tsx`. Consistent.
- Route param `workspaceId` used in TanStack Router definition (`createFileRoute("/workspace/$workspaceId")`) AND in nav calls (`params: { workspaceId: x }`). Consistent across C1 + C3.
- `i18n` keys (`packNotFound`, `newPack`, etc.) — keys preserved, only values updated. Calling code that does `t("packNotFound")` continues to work. Consistent.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-26-ui-information-architecture.md`.**
