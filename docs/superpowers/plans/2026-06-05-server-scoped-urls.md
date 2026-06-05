# Server-Scoped Workspace URLs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate editor workspace URLs from `/workspace/$workspaceId` to `/networks/$networkId/servers/$serverId/workspaces/$workspaceId`, add a server detail page, replace the NetworkDropdown+ServerDropdown pair with a unified ServerSelector, and fix the sidebar's workspace filter to always filter by URL-derived serverId.

**Architecture:** New TanStack Router route files follow the nested path pattern (`networks.$networkId.servers.$serverId.workspaces.$workspaceId.tsx`). Old `/workspace/$workspaceId` routes become thin redirect components. The `PackSummary` DTO gains `networkId` (already present in the backend DB row, just not surfaced). The sidebar reads `networkId`/`serverId` from the URL via `useParams({ strict: false })` rather than from Zustand stores, so the filter is always correct. The `useElementDblClickNav` hook gains `networkId` and `serverId` params.

**Tech Stack:** TanStack Router v1, React 19, Zustand, Vitest, react-i18next, Hono (backend), Drizzle ORM.

---

## File Map

### Created
- `editor/src/routes/networks.$networkId.servers.$serverId.tsx` — server detail page (workspaces list + server actions)
- `editor/src/routes/networks.$networkId.servers.$serverId.workspaces.$workspaceId.tsx` — new workspace route (clone of old one, updated params + links)
- `editor/src/routes/networks.$networkId.servers.$serverId.workspaces.$workspaceId.element.$elementId.tsx` — new focus mode route (clone of old one, updated params + links)
- `editor/src/components/ServerSelector.tsx` — unified server dropdown (replaces NetworkDropdown + ServerDropdown in sidebar)
- `editor/src/routes/networks.$networkId.servers.$serverId.workspaces.$workspaceId.test.tsx` — tests for new workspace route
- `editor/src/routes/networks.$networkId.servers.$serverId.workspaces.$workspaceId.element.$elementId.test.tsx` — tests for new focus mode route

### Modified
- `backend/src/routes/userNetworks.ts` — include `networkId` + `serverKeyId` in pack list response
- `editor/src/lib/api/networks.ts` — add `networkId: string` and `serverKeyId: string` to `PackSummary`
- `editor/src/routes/workspace.$workspaceId.tsx` — convert to redirect-only component
- `editor/src/routes/workspace.$workspaceId.element.$elementId.tsx` — convert to redirect-only component
- `editor/src/components/WorkspaceSidebar.tsx` — use URL params for active server/network; use `ServerSelector`; update workspace links
- `editor/src/features/canvas/useElementDblClickNav.ts` — add `networkId` + `serverId` params
- `editor/src/components/network-detail/ServerCard.tsx` — workspace links → new URL
- `editor/src/routes/networks.$networkId.tsx` — server cards → link to server detail page

### Deleted
- `editor/src/components/NetworkDropdown.tsx` (after sidebar no longer imports it)
- `editor/src/components/NetworkDropdown.test.tsx`
- `editor/src/components/ServerDropdown.tsx`
- `editor/src/components/ServerDropdown.test.tsx`

### Test files updated
- `editor/src/features/canvas/useElementDblClickNav.test.ts` — update expected route + params
- `editor/src/routes/workspace.$workspaceId.element.$elementId.test.tsx` — update expected navigate call
- `editor/src/components/WorkspaceSidebar.test.tsx` — update Link hrefs + mock useParams with server/network ids

---

## Task 1 — Backend: include `networkId` + `serverKeyId` in GET /api/networks/:id response

**Files:**
- Modify: `backend/src/routes/userNetworks.ts:66-68`
- Test: `backend/src/routes/userNetworks.test.ts` (existing test file, add assertion)

The backend `listPacksForNetwork` already returns full `Pack` rows (including `networkId` and `serverKeyId`). The `c.json({ ..., packs: packsList })` at line 68 therefore already includes them — but the frontend `PackSummary` interface doesn't declare those fields, so they're silently dropped when consumed. We need to verify the JSON response truly includes them and update the frontend type.

- [ ] **Step 1: Confirm backend response already includes networkId and serverKeyId**

```bash
cd backend && bun run test -- --reporter=verbose src/routes/userNetworks.test.ts 2>&1 | head -60
```

Expected: tests pass. Check that the test for `GET /api/networks/:id` exists. If so, add an assertion to verify `packs[0].networkId` is present.

- [ ] **Step 2: Add assertion to userNetworks.test.ts**

Find the test block for `GET /api/v1/networks/:id` in `backend/src/routes/userNetworks.test.ts` (exact filename — verify with `ls backend/src/routes/*.test.ts`). Add inside the success test:

```ts
// Inside the existing test that creates a pack, after the GET assertion:
expect(body.packs[0]).toHaveProperty("networkId");
expect(body.packs[0]).toHaveProperty("serverKeyId");
```

- [ ] **Step 3: Run backend tests to confirm they pass**

```bash
cd backend && bun run test
```

Expected: all tests pass (the fields are already in the JSON since `listPacksForNetwork` returns full rows).

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/userNetworks.test.ts
git commit -m "test(backend): assert networkId + serverKeyId in GET /networks/:id packs response"
```

---

## Task 2 — Frontend: add `networkId` + `serverKeyId` to `PackSummary`

**Files:**
- Modify: `editor/src/lib/api/networks.ts:14-20` (`PackSummary` interface)
- Test: `editor/src/lib/api/networks.test.ts`

- [ ] **Step 1: Update the `PackSummary` interface**

In `editor/src/lib/api/networks.ts`, change the `PackSummary` interface from:

```ts
export interface PackSummary {
  id: string;
  name: string;
  hash: string;
  updatedAt?: string;
  serverKeyId?: string;
}
```

to:

```ts
export interface PackSummary {
  id: string;
  name: string;
  hash: string;
  updatedAt?: string;
  networkId: string;
  serverKeyId: string;
}
```

- [ ] **Step 2: Check for TypeScript errors introduced**

```bash
cd editor && npx tsc --noEmit 2>&1 | head -40
```

Look for errors mentioning `networkId` or `serverKeyId` in callers of `PackSummary`. The most likely spots are `WorkspaceSidebar.tsx` (already uses `p.serverKeyId` with optional chaining) and optimistic entries in `WorkspaceSidebar` that construct `PackSummary`-like objects. Note all errors — we fix them in later tasks.

- [ ] **Step 3: Fix optimistic entries in `WorkspaceSidebar.tsx` if needed**

In `editor/src/components/WorkspaceSidebar.tsx`, the `optimisticEntries` array constructs `PackSummary` objects from `localPacks`. `localPacks` come from `useAccountStore` (`account.packs`), which is typed as `Pack[]` from `@/domain/types`. If the `Pack` domain type has `serverKeyId` and `networkId`, pass them through; otherwise use empty strings as a fallback for optimistic entries (these are packs not yet confirmed by the server, so we don't need to filter them by server):

```ts
const optimisticEntries: PackSummary[] = localPacks
  .filter((p) => !serverIds.has(p.id))
  .map((p) => ({
    id: p.id,
    name: p.name,
    hash: "",
    updatedAt: p.updatedAt,
    networkId: (p as any).networkId ?? "",
    serverKeyId: (p as any).serverKeyId ?? "",
  }));
```

- [ ] **Step 4: Run editor tests**

```bash
cd editor && npx vitest run 2>&1 | tail -20
```

Expected: same pass count as before (no regressions).

- [ ] **Step 5: Commit**

```bash
git add editor/src/lib/api/networks.ts editor/src/components/WorkspaceSidebar.tsx
git commit -m "feat(editor): add networkId + serverKeyId to PackSummary DTO"
```

---

## Task 3 — New route: server detail page

**Files:**
- Create: `editor/src/routes/networks.$networkId.servers.$serverId.tsx`

This is a minimal page that shows the server name and its workspaces as clickable links to the new workspace URL. Server actions (kebab menu) are deferred — MVP = workspace list only.

- [ ] **Step 1: Write a failing test**

Create `editor/src/routes/networks.$networkId.servers.$serverId.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useParams: () => ({ networkId: "net_1", serverId: "sk_1" }),
    useNavigate: () => vi.fn(),
    Navigate: () => null,
    Link: ({ children, to, params, ...p }: any) => <a href={to} {...p}>{children}</a>,
    createFileRoute: () => () => ({ component: () => null }),
  };
});

vi.mock("@/lib/api/networks", () => ({
  getNetwork: vi.fn().mockResolvedValue({
    network: { id: "net_1", name: "Mon Réseau", tier: "free" },
    serverKeys: [{ id: "sk_1", label: "Survival" }],
    packs: [
      { id: "p1", name: "Hub", hash: "h1", networkId: "net_1", serverKeyId: "sk_1" },
      { id: "p2", name: "Lobby", hash: "h2", networkId: "net_1", serverKeyId: "sk_2" },
    ],
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import ServerDetailPage from "./networks.$networkId.servers.$serverId";

describe("ServerDetailPage", () => {
  it("shows only workspaces bound to the active server", async () => {
    render(<ServerDetailPage />);
    await waitFor(() => expect(screen.getByText("Hub")).toBeInTheDocument());
    expect(screen.queryByText("Lobby")).not.toBeInTheDocument();
  });

  it("workspace link points to the new URL pattern", async () => {
    render(<ServerDetailPage />);
    const link = await screen.findByRole("link", { name: /Hub/ });
    expect(link).toHaveAttribute(
      "href",
      "/networks/$networkId/servers/$serverId/workspaces/$workspaceId",
    );
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd editor && npx vitest run src/routes/networks.\$networkId.servers.\$serverId.test.tsx 2>&1 | tail -20
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the server detail route**

Create `editor/src/routes/networks.$networkId.servers.$serverId.tsx`:

```tsx
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getNetwork } from "@/lib/api/networks";
import type { PackSummary } from "@/lib/api/networks";

export const Route = createFileRoute("/networks/$networkId/servers/$serverId")({
  component: ServerDetailPage,
});

export default function ServerDetailPage() {
  const { t } = useTranslation();
  const { networkId, serverId } = useParams({
    from: "/networks/$networkId/servers/$serverId",
  });
  const [serverLabel, setServerLabel] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<PackSummary[]>([]);

  useEffect(() => {
    if (!networkId || !serverId) return;
    getNetwork(networkId)
      .then((d) => {
        const sk = d.serverKeys.find((k) => k.id === serverId);
        setServerLabel(sk?.label ?? null);
        setWorkspaces(d.packs.filter((p) => p.serverKeyId === serverId));
      })
      .catch(console.error);
  }, [networkId, serverId]);

  return (
    <div className="relative h-full overflow-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-8 py-12">
        <header>
          <h1
            className="display text-[32px] tracking-tight text-[var(--text)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {serverLabel ?? serverId}
          </h1>
        </header>

        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <h2 className="eyebrow">{t("serverDetail.workspaces")}</h2>
            <span className="h-px flex-1 bg-[var(--border-soft)]" />
          </div>
          {workspaces.length === 0 ? (
            <p className="text-[13px] text-[var(--text-mut)]">{t("serverDetail.noWorkspaces")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {workspaces.map((w) => (
                <li key={w.id}>
                  <Link
                    to="/networks/$networkId/servers/$serverId/workspaces/$workspaceId"
                    params={{ networkId, serverId, workspaceId: w.id }}
                    className="card flex items-center justify-between p-4 hover:bg-[var(--surface-hover)]"
                  >
                    <span className="text-[14px] font-medium text-[var(--text)]">{w.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add i18n keys**

In `editor/src/i18n/en.ts`, add under the appropriate section:
```ts
serverDetail: {
  workspaces: "Workspaces",
  noWorkspaces: "No workspaces on this server yet.",
},
```

In `editor/src/i18n/fr.ts`:
```ts
serverDetail: {
  workspaces: "Espaces de travail",
  noWorkspaces: "Aucun espace de travail sur ce serveur.",
},
```

- [ ] **Step 5: Run the test to confirm it passes**

```bash
cd editor && npx vitest run src/routes/networks.\$networkId.servers.\$serverId.test.tsx 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 6: Run full editor test suite**

```bash
cd editor && npx vitest run 2>&1 | tail -20
```

Expected: same pass count as before + 2 new passing tests.

- [ ] **Step 7: Commit**

```bash
git add editor/src/routes/networks.\$networkId.servers.\$serverId.tsx \
        editor/src/routes/networks.\$networkId.servers.\$serverId.test.tsx \
        editor/src/i18n/en.ts editor/src/i18n/fr.ts
git commit -m "feat(editor): add server detail page at /networks/\$networkId/servers/\$serverId"
```

---

## Task 4 — New workspace route

**Files:**
- Create: `editor/src/routes/networks.$networkId.servers.$serverId.workspaces.$workspaceId.tsx`
- Create: `editor/src/routes/networks.$networkId.servers.$serverId.workspaces.$workspaceId.test.tsx`

This is an almost-identical copy of `workspace.$workspaceId.tsx`, reading the new URL params. The only differences are: (a) `createFileRoute` path, (b) `useParams` `from` string, (c) the redirect for missing pack points to the new URL, (d) the `Navigate` for stale packs uses `to="/networks/$networkId/servers/$serverId/workspaces/$workspaceId"`.

- [ ] **Step 1: Write the failing test**

Create `editor/src/routes/networks.$networkId.servers.$serverId.workspaces.$workspaceId.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useParams: () => ({ networkId: "net_1", serverId: "sk_1", workspaceId: "p1" }),
    useNavigate: () => navigate,
    Navigate: () => null,
    Outlet: () => null,
    Link: ({ children, ...p }: any) => <a {...p}>{children}</a>,
    createFileRoute: () => () => ({ component: () => null }),
    useChildMatches: () => [],
    useSearch: () => ({ tab: "overview" }),
  };
});

vi.mock("@/state/sessionStore", () => ({
  useSessionStore: (sel: any) => sel({ accessToken: null, networkId: null, setAccessToken: vi.fn(), clearSession: vi.fn() }),
}));
vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: any) => sel({ currentUser: { id: "u1" } }),
}));
vi.mock("@/state/accountStore", () => ({
  useAccountStore: (sel: any) => sel({ account: { packs: [], packOrder: [] }, importPack: vi.fn(), reorderPacks: vi.fn(), setAppearanceField: vi.fn() }),
}));
vi.mock("@/features/pack/usePackLoader", () => ({
  usePackLoader: () => ({
    pack: { id: "p1", name: "Hub", defaultLang: "en", i18nKeys: {}, menus: [], commands: [], dialogs: [], assets: [] },
    networkId: "net_1",
  }),
}));
vi.mock("@/lib/api/userPacks", () => ({ getNetworkOfPack: vi.fn().mockResolvedValue("net_1") }));
vi.mock("@/components/WorkspaceTopBarControls", () => ({ WorkspaceTopBarControls: () => <div data-testid="topbar" /> }));
vi.mock("@/features/canvas/Stage", () => ({ Stage: () => <div data-testid="stage" /> }));
vi.mock("@/features/canvas/EditorPane", () => ({ EditorPane: () => <div data-testid="editor-pane" /> }));
vi.mock("@/features/help/PatternsGallery", () => ({ PatternsGallery: () => null }));
vi.mock("@/features/sync/DeletePackDialog", () => ({ DeletePackDialog: () => null }));
vi.mock("@dnd-kit/core", () => ({ DndContext: ({ children }: any) => <>{children}</>, DragOverlay: () => null, useSensor: vi.fn(), useSensors: vi.fn(() => []), MouseSensor: class {}, TouchSensor: class {} }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { ServerWorkspacePage } from "./networks.$networkId.servers.$serverId.workspaces.$workspaceId";

describe("ServerWorkspacePage", () => {
  it("renders the top bar for the loaded pack", () => {
    render(<ServerWorkspacePage />);
    expect(screen.getByTestId("topbar")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd editor && npx vitest run "src/routes/networks.\$networkId.servers.\$serverId.workspaces.\$workspaceId.test.tsx" 2>&1 | tail -20
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the new workspace route file**

Create `editor/src/routes/networks.$networkId.servers.$serverId.workspaces.$workspaceId.tsx`. Copy the full content of `editor/src/routes/workspace.$workspaceId.tsx`, then apply these changes:

1. Change `createFileRoute` path:
```ts
export const Route = createFileRoute(
  "/networks/$networkId/servers/$serverId/workspaces/$workspaceId"
)({
  component: PackCanvasPage,
  validateSearch: (search: Record<string, unknown>): WorkspaceSearch => {
    const t = search.tab;
    if (t === "translations" || t === "data-sources" || t === "history") return { tab: t };
    return { tab: "overview" };
  },
});
```

2. Change `useParams`:
```ts
const { networkId, serverId, workspaceId: packId } = useParams({
  from: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId",
});
```

3. Export the component (named export for tests):
```ts
export function PackCanvasPage() {
```

4. Remove the `useState`/`useEffect` for `sessionNetworkId` — `networkId` now comes directly from the URL param. The component receives it from `useParams`. Change the line:
```ts
const networkId = token ? sessionNetworkId : userPackNetworkId;
```
to:
```ts
// networkId from URL; no lazy fetch needed
```
(Delete the `sessionNetworkId` state and `useEffect` that calls `getNetworkOfPack`.)

5. Change the stale-pack redirect:
```ts
if (token && !sessionPack && !userPack && !currentUser)
  return (
    <Navigate
      to="/networks/$networkId/servers/$serverId/workspaces/$workspaceId"
      params={{ networkId, serverId, workspaceId: packs[0]!.id }}
      replace
    />
  );
```

6. Export the component name for tests: add `export { PackCanvasPage as ServerWorkspacePage }` at the bottom (or export the function directly).

- [ ] **Step 4: Run the test to confirm it passes**

```bash
cd editor && npx vitest run "src/routes/networks.\$networkId.servers.\$serverId.workspaces.\$workspaceId.test.tsx" 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 5: Run full editor tests**

```bash
cd editor && npx vitest run 2>&1 | tail -20
```

- [ ] **Step 6: Commit**

```bash
git add "editor/src/routes/networks.\$networkId.servers.\$serverId.workspaces.\$workspaceId.tsx" \
        "editor/src/routes/networks.\$networkId.servers.\$serverId.workspaces.\$workspaceId.test.tsx"
git commit -m "feat(editor): new workspace route at server-scoped URL"
```

---

## Task 5 — New focus mode route

**Files:**
- Create: `editor/src/routes/networks.$networkId.servers.$serverId.workspaces.$workspaceId.element.$elementId.tsx`
- Create: `editor/src/routes/networks.$networkId.servers.$serverId.workspaces.$workspaceId.element.$elementId.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `editor/src/routes/networks.$networkId.servers.$serverId.workspaces.$workspaceId.element.$elementId.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render } from "@testing-library/react";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useParams: () => ({
      networkId: "net_1",
      serverId: "sk_1",
      workspaceId: "p1",
      elementId: "m1",
    }),
    useNavigate: () => navigate,
    Navigate: () => null,
    Link: ({ children, ...p }: any) => <a {...p}>{children}</a>,
    createFileRoute: () => () => ({ component: () => null }),
  };
});

vi.mock("@/state/accountStore", () => ({
  useAccountStore: (sel: any) =>
    sel({
      account: {
        packs: [
          {
            id: "p1", name: "P", defaultLang: "en", i18nKeys: {},
            menus: [{ id: "m1", title: [], rows: 3, slots: [], permission: null }],
            commands: [], dialogs: [], assets: [],
          },
        ],
      },
    }),
}));
vi.mock("@/state/sessionStore", () => ({
  useSessionStore: (sel: any) => sel({ accessToken: "tok" }),
}));
vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: any) => sel({ currentUser: null }),
}));
vi.mock("@/features/pack/usePackLoader", () => ({
  usePackLoader: () => ({ pack: null }),
}));
vi.mock("@/components/WorkspaceTopBarControls", () => ({
  WorkspaceTopBarControls: () => <div data-testid="top-bar" />,
}));
vi.mock("@/features/element-editor/ElementEditor", () => ({
  ElementEditor: () => <div data-testid="element-editor" />,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import ServerElementFocusPage from "./networks.$networkId.servers.$serverId.workspaces.$workspaceId.element.$elementId";

describe("ServerElementFocusPage — Escape key handler", () => {
  beforeEach(() => navigate.mockClear());

  it("navigates back to canvas on Escape", () => {
    render(<ServerElementFocusPage />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(navigate).toHaveBeenCalledWith({
      to: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId",
      params: { networkId: "net_1", serverId: "sk_1", workspaceId: "p1" },
    });
  });

  it("does NOT navigate when Escape is pressed inside an INPUT", () => {
    render(<ServerElementFocusPage />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(navigate).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd editor && npx vitest run "src/routes/networks.\$networkId.servers.\$serverId.workspaces.\$workspaceId.element.\$elementId.test.tsx" 2>&1 | tail -20
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the focus mode route**

Create `editor/src/routes/networks.$networkId.servers.$serverId.workspaces.$workspaceId.element.$elementId.tsx`. Copy from `workspace.$workspaceId.element.$elementId.tsx` with these changes:

1. `createFileRoute` path:
```ts
export const Route = createFileRoute(
  "/networks/$networkId/servers/$serverId/workspaces/$workspaceId/element/$elementId"
)({
  component: ElementFocusPage,
});
```

2. `useParams`:
```ts
const { networkId, serverId, workspaceId, elementId } = useParams({
  from: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId/element/$elementId",
});
const pId = workspaceId as PackId;
const eId = elementId as ElementId;
```

3. Esc handler:
```ts
navigate({
  to: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId",
  params: { networkId, serverId, workspaceId },
});
```

4. Back link:
```tsx
<Link
  to="/networks/$networkId/servers/$serverId/workspaces/$workspaceId"
  params={{ networkId, serverId, workspaceId }}
  className="btn btn-sm btn-ghost"
  aria-label={t("focusMode.backToCanvas")}
>
  <ArrowLeft className="size-[14px]" />
  {t("focusMode.backToCanvas")}
</Link>
```

5. Export default for tests:
```ts
export default ElementFocusPage;
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
cd editor && npx vitest run "src/routes/networks.\$networkId.servers.\$serverId.workspaces.\$workspaceId.element.\$elementId.test.tsx" 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 5: Run full editor tests**

```bash
cd editor && npx vitest run 2>&1 | tail -20
```

- [ ] **Step 6: Commit**

```bash
git add "editor/src/routes/networks.\$networkId.servers.\$serverId.workspaces.\$workspaceId.element.\$elementId.tsx" \
        "editor/src/routes/networks.\$networkId.servers.\$serverId.workspaces.\$workspaceId.element.\$elementId.test.tsx"
git commit -m "feat(editor): new focus mode route at server-scoped URL"
```

---

## Task 6 — Convert legacy workspace route to redirect

**Files:**
- Modify: `editor/src/routes/workspace.$workspaceId.tsx`
- Modify: `editor/src/routes/workspace.$workspaceId.element.$elementId.tsx`
- Modify: `editor/src/routes/workspace.$workspaceId.element.$elementId.test.tsx`

The legacy routes should fetch pack info (already available via `usePackLoader` + `loadUserPack`) to resolve `networkId` and `serverKeyId`, then redirect.

- [ ] **Step 1: Update the focus mode test to keep it passing after the redirect conversion**

The test in `workspace.$workspaceId.element.$elementId.test.tsx` tests `ElementFocusPage`. After this task, that component will become a redirect shim, so the Esc test is no longer valid there. Update the test to verify the redirect behavior instead:

```tsx
// workspace.$workspaceId.element.$elementId.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useParams: () => ({ workspaceId: "p1", elementId: "m1" }),
    useNavigate: () => navigate,
    Navigate: ({ to, params, replace }: any) => (
      <div data-testid="navigate" data-to={to} data-replace={String(replace)} />
    ),
    Link: ({ children, ...p }: any) => <a {...p}>{children}</a>,
    createFileRoute: () => () => ({ component: () => null }),
  };
});

vi.mock("@/lib/api/userPacks", () => ({
  loadUserPack: vi.fn().mockResolvedValue({
    pack: { id: "p1", name: "P", hash: "" },
    networkId: "net_1",
    files: {},
    editor: {},
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import ElementFocusRedirect from "./workspace.$workspaceId.element.$elementId";

describe("Legacy ElementFocusRedirect", () => {
  it("shows loading state initially", () => {
    render(<ElementFocusRedirect />);
    expect(screen.getByText(/redirect/i)).toBeInTheDocument();
  });

  it("navigates to the new server-scoped element URL after data loads", async () => {
    render(<ElementFocusRedirect />);
    await waitFor(() =>
      expect(screen.getByTestId("navigate")).toHaveAttribute(
        "data-to",
        "/networks/$networkId/servers/$serverId/workspaces/$workspaceId/element/$elementId",
      ),
    );
  });
});
```

- [ ] **Step 2: Run the existing test to see current pass state**

```bash
cd editor && npx vitest run src/routes/workspace.\$workspaceId.element.\$elementId.test.tsx 2>&1 | tail -20
```

Note passing count. The Esc test will now fail as expected since we're replacing the component.

- [ ] **Step 3: Rewrite `workspace.$workspaceId.element.$elementId.tsx` as a redirect**

Replace the full file content:

```tsx
import { createFileRoute, useParams, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { loadUserPack } from "@/lib/api/userPacks";

export const Route = createFileRoute("/workspace/$workspaceId/element/$elementId")({
  component: ElementFocusRedirect,
});

function ElementFocusRedirect() {
  const { workspaceId, elementId } = useParams({
    from: "/workspace/$workspaceId/element/$elementId",
  });
  const { t } = useTranslation();
  const [dest, setDest] = useState<{
    networkId: string;
    serverId: string;
  } | null>(null);

  useEffect(() => {
    loadUserPack(workspaceId).then((res) => {
      // The backend Pack row has serverKeyId — it's part of the UserPackLoadResult.
      // We need to extend loadUserPack to return it, or read the pack binding.
      // For now, use networkId from the response and get serverKeyId from
      // getNetwork (or accept it as part of the UserPackLoadResult — see Task 2).
      // Since UserPackLoadResult comes from GET /api/v1/user/packs/:id which
      // returns the full Pack row, we can cast:
      const serverKeyId = (res as any).serverKeyId as string | undefined;
      if (res.networkId && serverKeyId) {
        setDest({ networkId: res.networkId, serverId: serverKeyId });
      }
    }).catch(console.error);
  }, [workspaceId]);

  if (!dest) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--text-mut)] text-[13px]">
        {t("redirect.redirecting", "Redirecting...")}
      </div>
    );
  }

  return (
    <Navigate
      to="/networks/$networkId/servers/$serverId/workspaces/$workspaceId/element/$elementId"
      params={{
        networkId: dest.networkId,
        serverId: dest.serverId,
        workspaceId,
        elementId,
      }}
      replace
    />
  );
}

export default ElementFocusRedirect;
```

- [ ] **Step 4: Ensure `loadUserPack` response includes `serverKeyId`**

Check `editor/src/lib/api/userPacks.ts` — the `UserPackLoadResult` interface. The backend `GET /api/v1/user/packs/:id` returns a full pack row which includes `serverKeyId`. Update the interface to expose it:

In `editor/src/lib/api/userPacks.ts`, change:
```ts
export interface UserPackLoadResult {
  pack: { id: string; name: string; hash: string };
  networkId: string;
  files: Record<string, string>;
  editor: unknown;
}
```
to:
```ts
export interface UserPackLoadResult {
  pack: { id: string; name: string; hash: string };
  networkId: string;
  serverKeyId: string;
  files: Record<string, string>;
  editor: unknown;
}
```

Then update the redirect component to use `res.serverKeyId` directly (remove the cast).

Verify that the backend `GET /api/v1/user/packs/:id` handler returns `serverKeyId`. Check in `backend/src/routes/userPacks.ts` (or wherever that route is defined). If it doesn't, add it.

- [ ] **Step 5: Rewrite `workspace.$workspaceId.tsx` as a redirect**

Replace the full file with:

```tsx
import { createFileRoute, useParams, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { loadUserPack } from "@/lib/api/userPacks";

export const Route = createFileRoute("/workspace/$workspaceId")({
  component: WorkspaceRedirect,
});

function WorkspaceRedirect() {
  const { workspaceId } = useParams({ from: "/workspace/$workspaceId" });
  const { t } = useTranslation();
  const [dest, setDest] = useState<{
    networkId: string;
    serverId: string;
  } | null>(null);

  useEffect(() => {
    loadUserPack(workspaceId).then((res) => {
      if (res.networkId && res.serverKeyId) {
        setDest({ networkId: res.networkId, serverId: res.serverKeyId });
      }
    }).catch(console.error);
  }, [workspaceId]);

  if (!dest) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--text-mut)] text-[13px]">
        {t("redirect.redirecting", "Redirecting...")}
      </div>
    );
  }

  return (
    <Navigate
      to="/networks/$networkId/servers/$serverId/workspaces/$workspaceId"
      params={{
        networkId: dest.networkId,
        serverId: dest.serverId,
        workspaceId,
      }}
      replace
    />
  );
}

export default WorkspaceRedirect;
```

Note: `workspace.$workspaceId` previously had an `<Outlet />` for focus mode child routes. With the redirect approach, child routes are no longer possible under this route. Since `/workspace/$workspaceId/element/$elementId` has its own redirect route, this is fine — each legacy URL independently redirects.

- [ ] **Step 6: Add redirect i18n key**

In `editor/src/i18n/en.ts`:
```ts
redirect: {
  redirecting: "Redirecting...",
},
```

In `editor/src/i18n/fr.ts`:
```ts
redirect: {
  redirecting: "Redirection en cours...",
},
```

- [ ] **Step 7: Run full editor tests**

```bash
cd editor && npx vitest run 2>&1 | tail -20
```

Expect some tests for the legacy route to update (the Esc test is now gone, replaced by the redirect test).

- [ ] **Step 8: Commit**

```bash
git add editor/src/routes/workspace.\$workspaceId.tsx \
        editor/src/routes/workspace.\$workspaceId.element.\$elementId.tsx \
        editor/src/routes/workspace.\$workspaceId.element.\$elementId.test.tsx \
        editor/src/lib/api/userPacks.ts \
        editor/src/i18n/en.ts editor/src/i18n/fr.ts
git commit -m "feat(editor): convert legacy /workspace routes to redirect shims"
```

---

## Task 7 — Update `useElementDblClickNav` to include `networkId` + `serverId`

**Files:**
- Modify: `editor/src/features/canvas/useElementDblClickNav.ts`
- Modify: `editor/src/features/canvas/useElementDblClickNav.test.ts`

- [ ] **Step 1: Update the test first**

In `editor/src/features/canvas/useElementDblClickNav.test.ts`, change the expected navigate call:

```ts
// Old:
expect(navigate).toHaveBeenCalledWith({
  to: "/workspace/$workspaceId/element/$elementId",
  params: { workspaceId: PACK_ID, elementId: ELEMENT_ID },
});

// New:
const NETWORK_ID = "net_1";
const SERVER_ID = "sk_1";

// Update renderHook call:
const { result } = renderHook(() =>
  useElementDblClickNav(PACK_ID, ELEMENT_ID, NETWORK_ID, SERVER_ID)
);

// Update assertion:
expect(navigate).toHaveBeenCalledWith({
  to: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId/element/$elementId",
  params: {
    networkId: NETWORK_ID,
    serverId: SERVER_ID,
    workspaceId: PACK_ID,
    elementId: ELEMENT_ID,
  },
});
```

Also update the "updates the handler when elementId changes" test to pass the new params.

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd editor && npx vitest run src/features/canvas/useElementDblClickNav.test.ts 2>&1 | tail -20
```

Expected: FAIL — wrong params or wrong arg count.

- [ ] **Step 3: Update the hook implementation**

Replace `editor/src/features/canvas/useElementDblClickNav.ts`:

```ts
import type { ElementId, PackId } from "@/domain/types";
import type Konva from "konva";
import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";

/**
 * Returns an `onDblClick` / `onDblTap` handler that navigates to the
 * focus-mode route for the given element.
 *
 * Takes all four URL params explicitly to avoid relying on loose
 * `useParams({ strict: false })` which returns empty in canvas components.
 */
export function useElementDblClickNav(
  packId: PackId,
  elementId: ElementId,
  networkId: string,
  serverId: string,
) {
  const navigate = useNavigate();

  return useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      e.cancelBubble = true;
      navigate({
        to: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId/element/$elementId",
        params: { networkId, serverId, workspaceId: packId, elementId },
      });
    },
    [navigate, packId, elementId, networkId, serverId],
  );
}
```

- [ ] **Step 4: Run the hook test to confirm it passes**

```bash
cd editor && npx vitest run src/features/canvas/useElementDblClickNav.test.ts 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 5: Fix callers of `useElementDblClickNav`**

Find all callers:

```bash
grep -rn "useElementDblClickNav" editor/src --include="*.tsx" --include="*.ts"
```

For each caller (likely `MenuGroup.tsx`, `CommandGroup.tsx`, `DialogGroup.tsx` inside `editor/src/features/canvas/`), pass `networkId` and `serverId`. These canvas components are rendered inside the workspace route which now has `networkId` and `serverId` in the URL. They receive `packId` as a prop — add `networkId` and `serverId` props too, threaded down from `Stage.tsx` which reads them from `useParams({ strict: false })`.

In `editor/src/features/canvas/Stage.tsx` (or wherever the canvas root is), add:

```ts
const params = useParams({ strict: false }) as {
  networkId?: string;
  serverId?: string;
};
const networkId = params.networkId ?? "";
const serverId = params.serverId ?? "";
```

Then pass `networkId` and `serverId` down to `MenuGroup` / `CommandGroup` / `DialogGroup`.

In each Group component, update `useElementDblClickNav` call:
```ts
const onDblClick = useElementDblClickNav(packId, elementId, networkId, serverId);
```

- [ ] **Step 6: Run full editor tests**

```bash
cd editor && npx vitest run 2>&1 | tail -20
```

- [ ] **Step 7: Commit**

```bash
git add editor/src/features/canvas/useElementDblClickNav.ts \
        editor/src/features/canvas/useElementDblClickNav.test.ts \
        editor/src/features/canvas/Stage.tsx \
        editor/src/features/canvas/MenuGroup.tsx \
        editor/src/features/canvas/CommandGroup.tsx \
        editor/src/features/canvas/DialogGroup.tsx
git commit -m "feat(editor): useElementDblClickNav accepts networkId + serverId for new URL pattern"
```

---

## Task 8 — Update `ServerCard` workspace links

**Files:**
- Modify: `editor/src/components/network-detail/ServerCard.tsx`
- Modify: `editor/src/components/network-detail/ServerCard.test.tsx`

The `ServerCard` renders workspace links. It's used inside `networks.$networkId.tsx` where `networkId` is in scope. The server's `id` is passed as a prop. The workspace `id` is in the `Workspace` interface.

- [ ] **Step 1: Update the ServerCard `Workspace` interface and Link**

The `ServerCard` already receives `server.id` and `workspace.id`. We need `networkId` as an additional prop. Update:

```tsx
interface Props {
  networkId: string;   // NEW
  server: Server;
  workspaces: Workspace[];
  onAction: (action: "show-key" | "rotate" | "history" | "allowlist" | "delete", serverId: string) => void;
  onCreateWorkspace: (serverId: string) => void;
}

export function ServerCard({ networkId, server, workspaces, onAction, onCreateWorkspace }: Props) {
  // ...
  // Change the workspace Link:
  <Link
    key={w.id}
    to="/networks/$networkId/servers/$serverId/workspaces/$workspaceId"
    params={{ networkId, serverId: server.id, workspaceId: w.id }}
    className="group flex items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 transition-colors hover:bg-[var(--surface-hover)]"
  >
```

- [ ] **Step 2: Update the caller in `networks.$networkId.tsx`**

In `editor/src/routes/networks.$networkId.tsx`, pass `networkId` to `ServerCard`:

```tsx
<ServerCard
  key={sk.id}
  networkId={networkId}   // ADD THIS
  server={{ id: sk.id, label: sk.label, online: false }}
  workspaces={packsByServer.get(sk.id) ?? []}
  onAction={handleAction}
  onCreateWorkspace={(serverId) => setNewWsForServer(serverId)}
/>
```

- [ ] **Step 3: Update `ServerCard.test.tsx`**

Find the test that asserts the link href. Update the expected href from `/workspace/$workspaceId` to `/networks/$networkId/servers/$serverId/workspaces/$workspaceId`. Also pass `networkId="net_1"` to the `ServerCard` render call.

- [ ] **Step 4: Run ServerCard tests**

```bash
cd editor && npx vitest run src/components/network-detail/ServerCard.test.tsx 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 5: Run full editor tests**

```bash
cd editor && npx vitest run 2>&1 | tail -20
```

- [ ] **Step 6: Commit**

```bash
git add editor/src/components/network-detail/ServerCard.tsx \
        editor/src/components/network-detail/ServerCard.test.tsx \
        editor/src/routes/networks.\$networkId.tsx
git commit -m "feat(editor): update ServerCard workspace links to server-scoped URL"
```

---

## Task 9 — Sidebar: unified `ServerSelector` + URL-driven filter

**Files:**
- Create: `editor/src/components/ServerSelector.tsx`
- Modify: `editor/src/components/WorkspaceSidebar.tsx`
- Modify: `editor/src/components/WorkspaceSidebar.test.tsx`
- Delete: `editor/src/components/NetworkDropdown.tsx`, `editor/src/components/NetworkDropdown.test.tsx`
- Delete: `editor/src/components/ServerDropdown.tsx`, `editor/src/components/ServerDropdown.test.tsx`

### Step 9a — ServerSelector component

The `ServerSelector` is a dropdown that lists all servers across all networks the user belongs to, grouped by network (or with a muted network-name suffix). Selecting one navigates to the server detail page. The active server is read from the URL.

- [ ] **Step 1: Create the ServerSelector**

Create `editor/src/components/ServerSelector.tsx`:

```tsx
import { useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ChevronDown, Plus, Server } from "lucide-react";
import { useNetworksStore } from "@/state/networksStore";
import { useSidebarStore } from "@/state/sidebarStore";

interface ServerEntry {
  serverId: string;
  serverLabel: string;
  networkId: string;
  networkName: string;
}

interface Props {
  /** All servers across all networks (pre-fetched by the sidebar). */
  servers: ServerEntry[];
}

export function ServerSelector({ servers }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  // Active server = URL param (strict: false so it works on any nested route)
  const params = useParams({ strict: false }) as {
    networkId?: string;
    serverId?: string;
  };
  const activeServerId = params.serverId ?? null;
  const activeNetworkId = params.networkId ?? null;

  const active = servers.find((s) => s.serverId === activeServerId);

  const handleSelect = (entry: ServerEntry) => {
    setOpen(false);
    useSidebarStore.getState().close();
    navigate({
      to: "/networks/$networkId/servers/$serverId",
      params: { networkId: entry.networkId, serverId: entry.serverId },
    });
  };

  if (servers.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-[14px] border border-dashed border-[var(--border)] px-3 py-2.5 text-[13px] text-[var(--text-mut)]">
        <Server className="size-3.5 shrink-0" />
        {t("sidebar.noServers")}
      </div>
    );
  }

  const displayLabel = active
    ? (active.serverLabel || active.serverId.slice(0, 12))
    : t("sidebar.selectServer");

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-[14px] border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-left transition-colors hover:border-[var(--border-strong)]"
      >
        <div className="flex flex-col">
          <span className="text-[9.5px] font-bold uppercase tracking-[.14em] text-[var(--text-faint)]">
            {t("sidebar.serverLabel")}
          </span>
          <span className="mt-0.5 text-[13.5px] font-medium text-[var(--text)]">{displayLabel}</span>
        </div>
        <ChevronDown className="size-3.5 text-[var(--text-mut)]" />
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 z-10 mt-1.5 overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-raised)] p-1"
          style={{ boxShadow: "var(--shadow-md)" }}
        >
          {servers.map((entry) => (
            <button
              key={`${entry.networkId}:${entry.serverId}`}
              type="button"
              onClick={() => handleSelect(entry)}
              className="flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left hover:bg-[var(--surface-hover)]"
            >
              <span className="text-[13px] text-[var(--text-mut)] hover:text-[var(--text)]">
                {entry.serverLabel || entry.serverId.slice(0, 12)}
              </span>
              {servers.filter((s) => s.networkId !== entry.networkId).length > 0 && (
                <span className="ml-2 text-[11px] text-[var(--text-faint)]">{entry.networkName}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add i18n keys**

In `editor/src/i18n/en.ts`:
```ts
// inside sidebar section:
serverLabel: "Server",
selectServer: "Select a server",
noServers: "No servers yet",
```

In `editor/src/i18n/fr.ts`:
```ts
serverLabel: "Serveur",
selectServer: "Sélectionner un serveur",
noServers: "Aucun serveur",
```

### Step 9b — Update WorkspaceSidebar

- [ ] **Step 3: Rewrite `WorkspaceSidebar.tsx`**

Replace the import of `NetworkDropdown` and `ServerDropdown` with `ServerSelector`. Change the network/server selection logic to read from the URL. Change workspace filtering to always filter by `serverId` from URL. Change workspace `Link` to use the new URL pattern.

Key changes:

```tsx
// NEW imports
import { ServerSelector } from "./ServerSelector";
// REMOVE: import { NetworkDropdown } from "./NetworkDropdown";
// REMOVE: import { ServerDropdown } from "./ServerDropdown";
// REMOVE: import { useServersStore } from "@/state/serversStore";

// Build list of all server entries for the selector
const [allServerEntries, setAllServerEntries] = useState<
  Array<{ serverId: string; serverLabel: string; networkId: string; networkName: string }>
>([]);

// Read active network + server from URL
const urlParams = useParams({ strict: false }) as {
  networkId?: string;
  serverId?: string;
};
const activeNetworkId = urlParams.networkId ?? sessionNetworkId ?? networks[0]?.id ?? null;
const activeServerId = urlParams.serverId ?? null;
```

For fetching all server entries across all networks, extend the existing `useEffect` that fetches `getNetwork(activeNetworkId)` to also build `allServerEntries` from the networks list. Since `listNetworks()` returns only network summaries (no server keys), do a `getNetwork(n.id)` for each network. To avoid N calls on load, batch: when `networks` changes, fetch details for all networks and collect their server keys:

```tsx
useEffect(() => {
  if (networks.length === 0) return;
  let cancelled = false;
  Promise.all(networks.map((n) => getNetwork(n.id).then((d) => ({
    network: n,
    serverKeys: d.serverKeys,
    packs: d.packs,
  })))).then((results) => {
    if (cancelled) return;
    const entries = results.flatMap((r) =>
      r.serverKeys.map((sk) => ({
        serverId: sk.id,
        serverLabel: sk.label ?? "",
        networkId: r.network.id,
        networkName: r.network.name,
      }))
    );
    setAllServerEntries(entries);
    // Also update serverPacks from the active network result
    const activeResult = results.find((r) => r.network.id === activeNetworkId);
    if (activeResult) {
      setServerPacks(activeResult.packs);
    }
  }).catch(() => {});
  return () => { cancelled = true; };
}, [networks, activeNetworkId, refetchToken]);
```

For the workspace list, always filter by `activeServerId` (no count condition):
```tsx
const filteredServerPacks = activeServerId
  ? allPacks.filter((p) => p.serverKeyId === activeServerId)
  : allPacks;
```

For the workspace Link in `SortableWorkspaceItem`:
```tsx
// The item needs networkId + serverId. Thread them from the parent via props.
function SortableWorkspaceItem({
  id,
  name,
  networkId,
  serverId,
}: {
  id: string;
  name: string;
  networkId: string | null;
  serverId: string | null;
}) {
  // ...
  const params = useParams({ strict: false }) as { workspaceId?: string; networkId?: string; serverId?: string };
  const isActiveWorkspace = params.workspaceId === id;

  // Build link target
  const linkTo = networkId && serverId
    ? "/networks/$networkId/servers/$serverId/workspaces/$workspaceId"
    : "/workspace/$workspaceId"; // fallback for cases where server isn't known yet

  const linkParams = networkId && serverId
    ? { networkId, serverId, workspaceId: id }
    : { workspaceId: id };

  return (
    <li ref={setNodeRef} style={style} className="flex flex-col">
      <div ...>
        <Link
          to={linkTo as any}
          params={linkParams as any}
          onClick={() => useSidebarStore.getState().close()}
          ...
        >
```

For `WorkspaceSubTabs`, update `Link` in the same way, passing `networkId`/`serverId` as props.

Replace `<NetworkDropdown />` and `<ServerDropdown servers={networkServers} />` in the JSX with:
```tsx
<ServerSelector servers={allServerEntries} />
```

- [ ] **Step 4: Update `WorkspaceSidebar.test.tsx`**

Update the test mock for `useParams` to return `{ networkId: "net_1", serverId: undefined }` by default. Update the test that checks workspace links — the href will now be a TanStack Router `to` string (`/networks/$networkId/servers/$serverId/workspaces/$workspaceId`). Since `Link` is mocked as `<a href={to}>`, the href will be the `to` pattern string.

Remove any tests that specifically test `NetworkDropdown` or `ServerDropdown` being rendered (those are deleted components). Add a test that `ServerSelector` is rendered:

```ts
it("renders ServerSelector", () => {
  render(<WorkspaceSidebar />);
  // ServerSelector renders a button with sidebar.serverLabel text
  // Since we mock useTranslation, look for the key
  // The sidebar renders even with no servers
  expect(screen.getByText(/sidebar.serverLabel|Serveur|Server/i)).toBeInTheDocument();
});
```

- [ ] **Step 5: Run full editor tests**

```bash
cd editor && npx vitest run 2>&1 | tail -20
```

Fix any remaining failures (likely in sidebar tests that check link hrefs or component names).

- [ ] **Step 6: Delete old dropdown files**

```bash
rm editor/src/components/NetworkDropdown.tsx
rm editor/src/components/NetworkDropdown.test.tsx
rm editor/src/components/ServerDropdown.tsx
rm editor/src/components/ServerDropdown.test.tsx
```

- [ ] **Step 7: Run full editor tests again**

```bash
cd editor && npx vitest run 2>&1 | tail -20
```

Expected: all passing, no references to deleted files.

- [ ] **Step 8: Commit**

```bash
git add editor/src/components/ServerSelector.tsx \
        editor/src/components/WorkspaceSidebar.tsx \
        editor/src/components/WorkspaceSidebar.test.tsx \
        editor/src/i18n/en.ts editor/src/i18n/fr.ts
git rm editor/src/components/NetworkDropdown.tsx \
       editor/src/components/NetworkDropdown.test.tsx \
       editor/src/components/ServerDropdown.tsx \
       editor/src/components/ServerDropdown.test.tsx
git commit -m "feat(editor): replace NetworkDropdown+ServerDropdown with unified ServerSelector; sidebar filters workspaces by URL serverId"
```

---

## Task 10 — Link sweep: remaining `/workspace/` references

**Files:**
- Various files identified by grep

- [ ] **Step 1: Find all remaining old workspace URL references**

```bash
grep -rn "to=\"/workspace\|to: \"/workspace\|to=.*workspace.*workspaceId" editor/src --include="*.tsx" --include="*.ts"
```

Review each hit. After Tasks 6-9, the only expected remaining hits are:
- `workspace.$workspaceId.tsx` — the `createFileRoute` declaration itself (this is intentional; it must keep the old path string to serve as the legacy redirect handler)
- `workspace.$workspaceId.element.$elementId.tsx` — same

If any other hits remain (e.g., in `FlowCanvas.tsx`, any focus-button, etc.), update them to the new URL pattern following the same pattern used in Task 7 Step 5.

- [ ] **Step 2: Fix any remaining hits**

For each remaining hit outside the redirect files, find where `networkId` and `serverId` come from in that component's context (either `useParams({ strict: false })` or props), and update the `navigate`/`Link` call.

- [ ] **Step 3: Run full editor tests**

```bash
cd editor && npx vitest run 2>&1 | tail -20
```

- [ ] **Step 4: Verify zero non-redirect references**

```bash
grep -rn "to=\"/workspace\|to: \"/workspace" editor/src --include="*.tsx" --include="*.ts"
```

Expected output: only lines from `workspace.$workspaceId.tsx` and `workspace.$workspaceId.element.$elementId.tsx` (the redirect files, which need those strings for their `createFileRoute` declarations).

- [ ] **Step 5: Run backend tests to make sure nothing broke**

```bash
cd backend && bun run test 2>&1 | tail -20
```

- [ ] **Step 6: Commit**

```bash
# Add only the files that changed in this sweep
git add <list of changed files>
git commit -m "refactor(editor): sweep remaining /workspace URL references to server-scoped pattern"
```

---

## Task 11 — Final verification

- [ ] **Step 1: Full editor test run**

```bash
cd editor && npx vitest run 2>&1 | tail -30
```

Record the pass count.

- [ ] **Step 2: Full backend test run**

```bash
cd backend && bun run test 2>&1 | tail -30
```

Record the pass count.

- [ ] **Step 3: TypeScript check**

```bash
cd editor && npx tsc --noEmit 2>&1 | head -40
```

Expected: 0 errors.

- [ ] **Step 4: Zero stale URL grep**

```bash
grep -rn "/workspace/\$workspaceId" editor/src --include="*.tsx" --include="*.ts"
```

Expected: only in the two redirect route files.

- [ ] **Step 5: Commit (only if there are cleanup changes)**

```bash
git add <cleanup files if any>
git commit -m "chore(editor): final cleanup after server-scoped URL migration"
```

---

## Self-Review

### Spec coverage

| Requirement | Task |
|---|---|
| New `/networks/$networkId/servers/$serverId` route | Task 3 |
| New `/networks/$networkId/servers/$serverId/workspaces/$workspaceId` route | Task 4 |
| New focus mode route with full params | Task 5 |
| Legacy `/workspace/$workspaceId` → redirect | Task 6 |
| Legacy `/workspace/$workspaceId/element/$elementId` → redirect | Task 6 |
| `PackSummary.networkId` added | Task 2 |
| Backend includes `networkId` + `serverKeyId` in pack response | Task 1 |
| `useElementDblClickNav` updated | Task 7 |
| `ServerCard` workspace links updated | Task 8 |
| Sidebar: unified `ServerSelector` replaces two dropdowns | Task 9 |
| Sidebar: workspaces filter always by URL serverId | Task 9 |
| NetworkDropdown + ServerDropdown deleted | Task 9 |
| Link sweep | Task 10 |
| Final verification | Task 11 |
| `UserPackLoadResult.serverKeyId` added | Task 6 Step 4 |

### Type consistency check

- `PackSummary.networkId` and `PackSummary.serverKeyId` are both `string` (non-optional) — defined in Task 2, used in Tasks 3, 4, 9.
- `ServerEntry` in `ServerSelector` uses `serverId`, `networkId`, `serverLabel`, `networkName` — consistent with its callers in `WorkspaceSidebar`.
- `useElementDblClickNav(packId, elementId, networkId, serverId)` — 4 params, all strings, defined in Task 7, callers updated in Task 7 Step 5.
- `UserPackLoadResult.serverKeyId: string` added in Task 6 Step 4, used as `res.serverKeyId` in the redirect components.
- `WorkspaceRedirect` and `ElementFocusRedirect` both call `loadUserPack` and use `res.networkId` + `res.serverKeyId`.
