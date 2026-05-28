# Workspace Shell + Settings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter le spec `docs/superpowers/specs/2026-05-27-workspace-shell-and-settings-design.md` — transformer la route `/workspace/$workspaceId` en shell à onglets (Overview / Translations / Data Sources), simplifier le top bar (kebab dropdown pour les actions secondaires), ajouter une page `/settings` qui héberge la langue UI, et synchroniser la préférence langue côté backend pour les users logged-in.

**Architecture:** Refactor éditeur principalement + petite extension backend (1 colonne + 1 endpoint). Le shell à onglets gère son état via query param `?tab=overview|translations|data-sources`. La langue éditeur reste source = localStorage côté client mais sync via `users.editor_language` côté backend si logged-in.

**Tech Stack:** React 19 + Vite 6 + TanStack Router (query params) + Zustand stores + react-i18next + Vitest. Backend Bun + Hono + Drizzle + PostgreSQL.

**Spec source :** `docs/superpowers/specs/2026-05-27-workspace-shell-and-settings-design.md` (§6 V1 scope).

**Hors scope (différé V1.5+) :**
- Rapatriement de `/account` dans `/settings` (Compte reste page séparée)
- Sections Settings autres qu'Apparence
- Module-injected tabs (déjà specifié dans le spec d'hier §4)
- Mobile UX dédié (V1 = overflow scroll horizontal du top bar / tabs)

---

## File Structure

### Backend — `backend/src/`

- **Modify**:
  - `db/schema.ts` — add `editor_language: text("editor_language")` (nullable) to `users` table
  - `routes/auth.ts` — `GET /me` returns `editor_language` in user DTO ; `PATCH /me` endpoint sets it
  - `routes/auth.test.ts` — tests for new endpoint
  - `lib/api/auth.ts` (editor side) — type `AuthUserDto` ajoute `editor_language?: string`
- **Create**:
  - `drizzle/000X_add_user_editor_language.sql` — auto-generated migration

### Editor — `editor/src/`

- **Create**:
  - `editor/src/components/EditorLangSwitcher.tsx` — extracted from workspace route (currently inline at line 559)
  - `editor/src/components/WorkspaceTabs.tsx` — tab strip UI (controlled, props: tabs, activeTab, onChange)
  - `editor/src/components/WorkspaceTabs.test.tsx`
  - `editor/src/components/TopBarKebabMenu.tsx` — dropdown menu : Import / Export / Patterns / ─── / Delete pack
  - `editor/src/components/TopBarKebabMenu.test.tsx`
  - `editor/src/routes/settings.tsx` — Settings page route
  - `editor/src/routes/settings.test.tsx`
  - `editor/src/features/settings/AppearanceSection.tsx` — section "Apparence" qui héberge EditorLangSwitcher + sync backend
  - `editor/src/features/settings/AppearanceSection.test.tsx`
- **Modify**:
  - `editor/src/routes/workspace.$workspaceId.tsx` — add tab state via `?tab=`, render WorkspaceTabs, conditional content (Overview/Translations/DataSources), remove top bar items moved elsewhere, add kebab dropdown
  - `editor/src/components/WorkspaceSidebar.tsx` — add ⚙ Settings button sticky bottom
  - `editor/src/state/authStore.ts` — `hydrate()` syncs `editor_language` if present + `i18n.changeLanguage()`
  - `editor/src/state/uiStore.ts` — `setEditorLang()` also PATCHes backend if logged-in (fire-and-forget)
  - `editor/src/lib/api/auth.ts` — `AuthUserDto` type extended + new `patchMe()` function

### Docs

- **Modify**:
  - `CLAUDE.md` — update sidebar/workspace structure mentions
  - `.claude/skills/sync-docs/doc-impact-map.yaml` — add entries

---

## Phase A — Backend `editor_language` storage

### Task A1: Add `editor_language` column + migration

**Files:**
- Modify: `backend/src/db/schema.ts`
- Create: `backend/drizzle/000X_add_user_editor_language.sql` (auto-generated)

- [ ] **Step 1: Locate the `users` table definition**

```bash
cd backend && grep -n "users = pgTable" src/db/schema.ts
```

- [ ] **Step 2: Add the column to the `users` table**

Open `backend/src/db/schema.ts`. Find the `users` table definition. Inside the column list (before the closing `}`), ADD :

```ts
editor_language: text("editor_language"),
```

(Nullable, no default. Match the existing column style in the file — snake_case column name, camelCase JS field is OK if other columns use that pattern, otherwise stay consistent with neighbours.)

- [ ] **Step 3: Generate migration**

```bash
cd backend && bun x drizzle-kit generate --name add_user_editor_language
```

Expected: a new file `backend/drizzle/000X_add_user_editor_language.sql` containing `ALTER TABLE "users" ADD COLUMN "editor_language" text;`. Verify by reading it.

- [ ] **Step 4: Run migration against the local DB**

```bash
cd backend && bun run db:migrate
```

Expected: `[migrate] done` with the new migration applied. If postgres is offline, bring it up first via `docker compose up -d postgres`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/schema.ts backend/drizzle/
git commit -m "feat(backend): add users.editor_language column + migration"
```

### Task A2: Extend `GET /api/v1/auth/me` to return `editor_language`

**Files:**
- Modify: `backend/src/routes/auth.ts`

- [ ] **Step 1: Locate the `/me` handler**

```bash
cd backend && grep -n "/me" src/routes/auth.ts
```

- [ ] **Step 2: Add `editor_language` to the user DTO returned**

In the handler, the response shape currently looks something like `{ user: { id, email, name, avatarUrl } }`. Extend it to include `editor_language`:

```ts
return c.json({
  user: {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    editor_language: user.editor_language ?? null,
  },
});
```

(Adapt to actual existing field names + selection. If the row is selected with a wildcard already, this is automatic — verify.)

- [ ] **Step 3: Run existing auth tests to ensure no regression**

```bash
cd backend && bun test src/routes/auth.test.ts
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/auth.ts
git commit -m "feat(backend): GET /me returns editor_language"
```

### Task A3: Add `PATCH /api/v1/auth/me` endpoint — TDD

**Files:**
- Modify: `backend/src/routes/auth.ts`
- Modify: `backend/src/routes/auth.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `backend/src/routes/auth.test.ts`:

```ts
describe("PATCH /api/v1/auth/me — editor_language sync", () => {
  it("updates the user's editor_language", async () => {
    // Use the existing test helper that creates a user + returns a session cookie.
    // If no helper exists, inline the user creation pattern used in other auth tests in this file.
    const { sessionId, userId } = await seedAuthedUser(); // existing helper or inline

    const res = await app.request("/api/v1/auth/me", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Cookie": `artisan_user_session=${sessionId}`,
      },
      body: JSON.stringify({ editor_language: "fr" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.editor_language).toBe("fr");

    // Verify DB is updated
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row.editor_language).toBe("fr");
  });

  it("returns 401 without a session cookie", async () => {
    const res = await app.request("/api/v1/auth/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ editor_language: "fr" }),
    });
    expect(res.status).toBe(401);
  });

  it("accepts null to clear the preference", async () => {
    const { sessionId } = await seedAuthedUser();
    const res = await app.request("/api/v1/auth/me", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Cookie": `artisan_user_session=${sessionId}`,
      },
      body: JSON.stringify({ editor_language: null }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.editor_language).toBe(null);
  });
});
```

Adapt `seedAuthedUser` to the actual helper in the file (look for the pattern used by existing tests).

- [ ] **Step 2: Run to verify failure**

```bash
cd backend && bun test src/routes/auth.test.ts -t "editor_language sync"
```

Expected: FAIL — PATCH not implemented yet.

- [ ] **Step 3: Implement the PATCH handler**

In `backend/src/routes/auth.ts`, ADD after the existing `GET /me` handler:

```ts
router.patch("/me", async (c) => {
  const sessionId = getCookie(c, "artisan_user_session");
  if (!sessionId) return c.json({ error: "unauthorized" }, 401);
  const user = await validateUserSession(sessionId);
  if (!user) return c.json({ error: "unauthorized" }, 401);

  let body: { editor_language?: string | null };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }

  const updates: Record<string, unknown> = {};
  if ("editor_language" in body) {
    updates.editor_language = body.editor_language ?? null;
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ user: serializeUser(user) });
  }

  await db.update(users).set(updates).where(eq(users.id, user.id));
  const [updated] = await db.select().from(users).where(eq(users.id, user.id));
  return c.json({ user: serializeUser(updated) });
});
```

If `serializeUser` doesn't exist as a helper, inline the user DTO mapping (same shape as the GET /me response). Reuse imports from the existing GET /me handler.

- [ ] **Step 4: Run tests**

```bash
cd backend && bun test src/routes/auth.test.ts
```

Expected: all pass including the 3 new tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/auth.ts backend/src/routes/auth.test.ts
git commit -m "feat(backend): PATCH /api/v1/auth/me sets editor_language"
```

---

## Phase B — Editor : wire language sync

### Task B1: Extend `AuthUserDto` + add `patchMe()` API client

**Files:**
- Modify: `editor/src/lib/api/auth.ts`

- [ ] **Step 1: Extend the type**

Open `editor/src/lib/api/auth.ts`. Find `AuthUserDto` (or equivalent). ADD the field :

```ts
export interface AuthUserDto {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  editor_language?: string | null;  // NEW
}
```

- [ ] **Step 2: Add `patchMe()` function**

Append :

```ts
export async function patchMe(
  ctx: { apiUrl: string },
  payload: { editor_language?: string | null },
): Promise<{ user: AuthUserDto } | { error: string }> {
  const res = await fetch(`${ctx.apiUrl}/api/v1/auth/me`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { error: `patch_me_failed_${res.status}` };
  return res.json();
}
```

- [ ] **Step 3: Commit**

```bash
git add editor/src/lib/api/auth.ts
git commit -m "feat(editor): patchMe API client for user preferences"
```

### Task B2: `authStore.hydrate` syncs `editor_language` from backend

**Files:**
- Modify: `editor/src/state/authStore.ts`
- Modify: `editor/src/state/authStore.test.ts`

- [ ] **Step 1: Add test asserting hydrate calls i18n.changeLanguage when editor_language is set**

In `editor/src/state/authStore.test.ts`, ADD :

```ts
import i18n from "@/i18n";

test("hydrate syncs editor_language to i18n + localStorage", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
    JSON.stringify({ user: { id: "u1", email: "a@e.com", name: "A", avatarUrl: null, editor_language: "fr" } }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  ));
  const changeLang = vi.spyOn(i18n, "changeLanguage").mockResolvedValue(undefined as any);

  await useAuthStore.getState().hydrate(API);

  expect(useAuthStore.getState().currentUser?.editor_language).toBe("fr");
  expect(changeLang).toHaveBeenCalledWith("fr");
});

test("hydrate does NOT call changeLanguage if user has no editor_language", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
    JSON.stringify({ user: { id: "u1", email: "a@e.com", name: "A", avatarUrl: null, editor_language: null } }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  ));
  const changeLang = vi.spyOn(i18n, "changeLanguage").mockResolvedValue(undefined as any);

  await useAuthStore.getState().hydrate(API);

  expect(changeLang).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd editor && npx vitest run src/state/authStore.test.ts
```

Expected: 2 new tests FAIL — sync not implemented.

- [ ] **Step 3: Update `hydrate()`**

In `editor/src/state/authStore.ts`, the existing `hydrate()` :

```ts
async hydrate(apiUrl) {
  set({ isLoading: true });
  const user = await getMe({ apiUrl });
  set({ currentUser: user, isLoading: false });
},
```

becomes :

```ts
async hydrate(apiUrl) {
  set({ isLoading: true });
  const user = await getMe({ apiUrl });
  set({ currentUser: user, isLoading: false });
  if (user?.editor_language) {
    const i18n = (await import("@/i18n")).default;
    await i18n.changeLanguage(user.editor_language);
  }
},
```

The dynamic import matches the existing pattern in `uiStore.ts:140` to avoid a hard dep + circular import.

- [ ] **Step 4: Run tests**

```bash
cd editor && npx vitest run src/state/authStore.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add editor/src/state/authStore.ts editor/src/state/authStore.test.ts
git commit -m "feat(editor): authStore.hydrate syncs editor_language from backend"
```

### Task B3: `uiStore.setEditorLang` PATCHes backend if logged-in

**Files:**
- Modify: `editor/src/state/uiStore.ts`

- [ ] **Step 1: Locate `setEditorLang` (or the action that sets `editorLang`)**

```bash
cd editor && grep -n "editorLang\|setEditorLang" src/state/uiStore.ts
```

The existing flow sets `editorLang` in store and calls `i18n.changeLanguage` (line 140). We add a fire-and-forget PATCH on top.

- [ ] **Step 2: Update the setter**

Find the action that sets `editorLang`. Add a backend sync call :

```ts
setEditorLang: (lang: string) => {
  set({ editorLang: lang });
  import("@/i18n").then(({ default: i18n }) => i18n.changeLanguage(lang));
  // Sync to backend if logged-in. Fire-and-forget — UI doesn't block on success.
  const user = useAuthStore.getState().currentUser;
  if (user) {
    const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
    import("@/lib/api/auth").then(({ patchMe }) =>
      patchMe({ apiUrl }, { editor_language: lang }).catch(() => {
        console.warn("editor_language sync to backend failed (offline?)");
      })
    );
  }
},
```

Add import at top of file if needed :

```ts
import { useAuthStore } from "./authStore";
```

(Avoid circular import — `authStore` and `uiStore` are siblings, both standalone. If circular issue arises, use `useAuthStore.getState()` inside the function only, not at module scope.)

- [ ] **Step 3: Run editor tests**

```bash
cd editor && npx vitest run src/state/uiStore.test.ts
```

Expected: existing tests pass (the addition is purely additive to the setter, no breaking change).

- [ ] **Step 4: Commit**

```bash
git add editor/src/state/uiStore.ts
git commit -m "feat(editor): setEditorLang fires PATCH /me if logged-in"
```

---

## Phase C — Extract `EditorLangSwitcher` to shared component

### Task C1: Extract from workspace route

**Files:**
- Create: `editor/src/components/EditorLangSwitcher.tsx`
- Modify: `editor/src/routes/workspace.$workspaceId.tsx`

- [ ] **Step 1: Read the inline definition**

```bash
cd editor && sed -n '550,590p' src/routes/workspace.\$workspaceId.tsx
```

Note the imports used and the JSX shape. Identify the closure dependencies (likely `useUiStore`, react-i18next).

- [ ] **Step 2: Create the standalone component**

Create `editor/src/components/EditorLangSwitcher.tsx` with a copy of the inline `EditorLangSwitcher` function. Add imports as needed (look at the workspace route's imports for what to bring along).

```tsx
// editor/src/components/EditorLangSwitcher.tsx
// (Copy the body of the existing `function EditorLangSwitcher() { ... }` from
// workspace.$workspaceId.tsx:559, adding necessary imports at the top.)
```

The component must work standalone — verify it doesn't depend on any closure variable from the workspace route.

- [ ] **Step 3: Remove the inline definition from workspace route + import the new one**

In `editor/src/routes/workspace.$workspaceId.tsx`:
- Delete the `function EditorLangSwitcher() { ... }` block at line ~559
- Add `import { EditorLangSwitcher } from "@/components/EditorLangSwitcher";` at the top

The `<EditorLangSwitcher />` JSX usage at line ~240 stays unchanged.

- [ ] **Step 4: Run editor tests**

```bash
cd editor && npx vitest run
```

Expected: all green (zero behavior change).

- [ ] **Step 5: Commit**

```bash
git add editor/src/components/EditorLangSwitcher.tsx editor/src/routes/workspace.\$workspaceId.tsx
git commit -m "refactor(editor): extract EditorLangSwitcher into shared component"
```

---

## Phase D — `/settings` route + Apparence section

### Task D1: AppearanceSection component — TDD

**Files:**
- Create: `editor/src/features/settings/AppearanceSection.tsx`
- Create: `editor/src/features/settings/AppearanceSection.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// editor/src/features/settings/AppearanceSection.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppearanceSection } from "./AppearanceSection";

describe("AppearanceSection", () => {
  it("renders the section title", () => {
    render(<AppearanceSection />);
    expect(screen.getByText(/Apparence|Appearance/i)).toBeInTheDocument();
  });

  it("renders the editor language switcher", () => {
    render(<AppearanceSection />);
    // EditorLangSwitcher renders something — check that its container element exists.
    // If EditorLangSwitcher has a stable testid or aria-label, use it. Otherwise check for
    // a known string like the current language label.
    expect(screen.getByTestId("editor-lang-switcher")).toBeInTheDocument();
  });
});
```

The 2nd test depends on `EditorLangSwitcher` having `data-testid="editor-lang-switcher"`. If it doesn't, ADD it to the extracted component (Phase C output) as part of Phase D.

- [ ] **Step 2: Implement**

```tsx
// editor/src/features/settings/AppearanceSection.tsx
import { useTranslation } from "react-i18next";
import { EditorLangSwitcher } from "@/components/EditorLangSwitcher";

export function AppearanceSection() {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-zinc-100">{t("settings.appearance.title")}</h2>
      <div className="flex flex-col gap-2">
        <label className="text-sm text-zinc-300">{t("settings.appearance.editorLanguage")}</label>
        <EditorLangSwitcher />
      </div>
    </section>
  );
}
```

Add i18n keys :

In `editor/src/locales/fr.ts`, append to the appropriate object :
```ts
settings: {
  appearance: {
    title: "Apparence",
    editorLanguage: "Langue de l'éditeur",
  },
},
```

Same in `editor/src/locales/en.ts` :
```ts
settings: {
  appearance: {
    title: "Appearance",
    editorLanguage: "Editor language",
  },
},
```

- [ ] **Step 3: Run tests**

```bash
cd editor && npx vitest run src/features/settings/AppearanceSection.test.tsx
```

Expected: 2 PASS. If the second fails because `editor-lang-switcher` testid isn't on the extracted component, add it now to `EditorLangSwitcher.tsx`.

- [ ] **Step 4: Commit**

```bash
git add editor/src/features/settings/ editor/src/components/EditorLangSwitcher.tsx editor/src/locales/
git commit -m "feat(editor): add AppearanceSection (settings page V1)"
```

### Task D2: `/settings` route

**Files:**
- Create: `editor/src/routes/settings.tsx`
- Create: `editor/src/routes/settings.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// editor/src/routes/settings.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

import { SettingsRoute } from "./settings";

describe("SettingsRoute", () => {
  it("renders the Apparence section by default", () => {
    render(<SettingsRoute />);
    expect(screen.getByText(/Apparence|Appearance/i)).toBeInTheDocument();
  });

  it("renders the sections sidebar with at least Apparence", () => {
    render(<SettingsRoute />);
    expect(screen.getByRole("navigation", { name: /Settings sections/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement**

```tsx
// editor/src/routes/settings.tsx
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AppearanceSection } from "@/features/settings/AppearanceSection";

export const Route = createFileRoute("/settings")({ component: SettingsRoute });

export function SettingsRoute() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full">
      <nav
        aria-label="Settings sections"
        className="w-56 border-r border-zinc-800 bg-zinc-950 p-3"
      >
        <ul className="flex flex-col gap-1">
          <li>
            <button
              type="button"
              className="block w-full rounded bg-zinc-800 px-3 py-2 text-left text-sm text-zinc-100"
            >
              {t("settings.appearance.title")}
            </button>
          </li>
        </ul>
      </nav>
      <main className="flex-1 overflow-auto p-6">
        <AppearanceSection />
      </main>
    </div>
  );
}

export default SettingsRoute;
```

V1 has only one section so the sidebar nav has one fixed entry (no routing between sections). When a 2nd section arrives, this becomes interactive.

- [ ] **Step 3: Run tests**

```bash
cd editor && npx vitest run src/routes/settings.test.tsx
```

Expected: 2 PASS.

- [ ] **Step 4: Smoke check in browser**

```bash
# Editor is already running via docker compose. HMR will pick up the new route.
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/settings
```

Expected: 200 (or the SPA fallback 200 + client-side route resolution).

- [ ] **Step 5: Commit**

```bash
git add editor/src/routes/settings.tsx editor/src/routes/settings.test.tsx editor/src/routeTree.gen.ts 2>/dev/null
git commit -m "feat(editor): /settings route with Apparence section"
```

(If `routeTree.gen.ts` is gitignored per project convention, omit it from the add.)

### Task D3: Add Settings button to `WorkspaceSidebar` (sticky bottom)

**Files:**
- Modify: `editor/src/components/WorkspaceSidebar.tsx`
- Modify: `editor/src/components/WorkspaceSidebar.test.tsx`

- [ ] **Step 1: Add a test for the Settings link**

In `WorkspaceSidebar.test.tsx`, ADD :

```tsx
it("renders a Settings link to /settings", async () => {
  vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
    network: { id: "net_1", name: "Mon Network", tier: "free" },
    packs: [],
    serverKeys: [],
  });
  renderInRouter(<WorkspaceSidebar />);
  const link = await screen.findByRole("link", { name: /Settings|Paramètres|Réglages/i });
  expect(link).toHaveAttribute("href", "/settings");
});
```

(Adapt the `name` regex to match the label you choose — likely just "Settings" or "Paramètres".)

- [ ] **Step 2: Modify `WorkspaceSidebar.tsx` to render the button at the bottom**

The current sidebar layout uses `flex flex-col gap-3 p-2`. To make the Settings link sticky-bottom, wrap the main content in `flex-1` and add the link as a non-`flex-1` last child :

```tsx
return (
  <nav className="flex h-full flex-col gap-3 p-2">
    <NetworkDropdown />

    <div className="flex-1 overflow-auto">
      {/* Workspaces section + Modules section as before */}
      <div>
        <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-500">
          Mes Workspaces
        </div>
        {/* … existing list + DnD … */}
        <NewPackDialog trigger={…} />
      </div>

      <div>
        <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-500">
          Modules installés
        </div>
        <div className="rounded border border-dashed border-zinc-800 px-2 py-2 text-[11px] text-zinc-500">
          Aucun module installé.
        </div>
      </div>
    </div>

    <Link
      to="/settings"
      className="flex items-center gap-2 rounded px-2 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
    >
      <span>⚙</span>
      <span>{t("sidebar.settings")}</span>
    </Link>
  </nav>
);
```

Add `useTranslation` if not already used. Add i18n keys `sidebar.settings: "Settings"` / `"Paramètres"` in fr/en locales.

- [ ] **Step 3: Run tests**

```bash
cd editor && npx vitest run src/components/WorkspaceSidebar.test.tsx
```

Expected: 6 PASS (5 existing + 1 new).

- [ ] **Step 4: Commit**

```bash
git add editor/src/components/WorkspaceSidebar.tsx editor/src/components/WorkspaceSidebar.test.tsx editor/src/locales/
git commit -m "feat(editor): Settings button sticky bottom of WorkspaceSidebar"
```

---

## Phase E — Workspace shell with tabs

### Task E1: `WorkspaceTabs` component — TDD

**Files:**
- Create: `editor/src/components/WorkspaceTabs.tsx`
- Create: `editor/src/components/WorkspaceTabs.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// editor/src/components/WorkspaceTabs.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkspaceTabs } from "./WorkspaceTabs";

describe("WorkspaceTabs", () => {
  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "translations", label: "Translations", badge: 3 },
    { id: "data-sources", label: "Data Sources" },
  ];

  it("renders all tab labels", () => {
    render(<WorkspaceTabs tabs={tabs} activeTab="overview" onChange={() => {}} />);
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Translations")).toBeInTheDocument();
    expect(screen.getByText("Data Sources")).toBeInTheDocument();
  });

  it("renders a badge on the Translations tab when provided", () => {
    render(<WorkspaceTabs tabs={tabs} activeTab="overview" onChange={() => {}} />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("marks the active tab with aria-current", () => {
    render(<WorkspaceTabs tabs={tabs} activeTab="translations" onChange={() => {}} />);
    expect(screen.getByText("Translations").closest("button")).toHaveAttribute("aria-current", "page");
  });

  it("calls onChange when a tab is clicked", () => {
    const onChange = vi.fn();
    render(<WorkspaceTabs tabs={tabs} activeTab="overview" onChange={onChange} />);
    fireEvent.click(screen.getByText("Translations"));
    expect(onChange).toHaveBeenCalledWith("translations");
  });
});
```

- [ ] **Step 2: Implement**

```tsx
// editor/src/components/WorkspaceTabs.tsx
export interface WorkspaceTab {
  id: string;
  label: string;
  badge?: number;
}

interface WorkspaceTabsProps {
  tabs: WorkspaceTab[];
  activeTab: string;
  onChange: (tabId: string) => void;
}

export function WorkspaceTabs({ tabs, activeTab, onChange }: WorkspaceTabsProps) {
  return (
    <div role="tablist" className="flex border-b border-zinc-800 bg-zinc-950 px-2">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-current={isActive ? "page" : undefined}
            onClick={() => onChange(tab.id)}
            className={
              isActive
                ? "flex items-center gap-2 border-b-2 border-blue-500 px-4 py-2 text-sm text-zinc-100"
                : "flex items-center gap-2 px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200"
            }
          >
            <span>{tab.label}</span>
            {typeof tab.badge === "number" && tab.badge > 0 && (
              <span className="rounded-full bg-amber-700 px-1.5 py-0.5 text-[10px] font-semibold text-amber-100">
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Run tests**

```bash
cd editor && npx vitest run src/components/WorkspaceTabs.test.tsx
```

Expected: 4 PASS.

- [ ] **Step 4: Commit**

```bash
git add editor/src/components/WorkspaceTabs.tsx editor/src/components/WorkspaceTabs.test.tsx
git commit -m "feat(editor): WorkspaceTabs component (tab strip with active state + badge)"
```

### Task E2: Wire `?tab=` query param in workspace route

**Files:**
- Modify: `editor/src/routes/workspace.$workspaceId.tsx`

- [ ] **Step 1: Locate the route definition + main render**

The route should already use `createFileRoute("/workspace/$workspaceId")`. We add a search-param schema for `?tab=`.

- [ ] **Step 2: Add search params type + reader**

Near the top of the file, modify the `Route` definition :

```tsx
type WorkspaceSearch = { tab?: "overview" | "translations" | "data-sources" };

export const Route = createFileRoute("/workspace/$workspaceId")({
  component: WorkspacePage, // (existing component name, adapt)
  validateSearch: (search: Record<string, unknown>): WorkspaceSearch => {
    const t = search.tab;
    if (t === "translations" || t === "data-sources") return { tab: t };
    return { tab: "overview" };
  },
});
```

Inside the component :

```tsx
const { tab } = Route.useSearch();
const navigate = useNavigate();
const setTab = (next: "overview" | "translations" | "data-sources") =>
  navigate({ search: { tab: next } });
```

`activeTab` for the WorkspaceTabs component is `tab ?? "overview"`.

- [ ] **Step 3: Render `WorkspaceTabs` between top bar and content**

In the JSX, after the top bar row (the `<div className="flex h-12 ...">` block) and BEFORE the branch toolbar / main content, ADD :

```tsx
import { WorkspaceTabs } from "@/components/WorkspaceTabs";
import { totalMissing } from "@/lib/i18nUsages"; // already imported

// inside the render :
const missing = pack ? totalMissing(pack) : 0;
const tabs = [
  { id: "overview", label: t("workspace.tabs.overview") },
  { id: "translations", label: t("workspace.tabs.translations"), badge: missing > 0 ? missing : undefined },
  { id: "data-sources", label: t("workspace.tabs.dataSources") },
];

// JSX:
<WorkspaceTabs tabs={tabs} activeTab={tab ?? "overview"} onChange={(id) => setTab(id as any)} />
```

Add i18n keys `workspace.tabs.overview`, `workspace.tabs.translations`, `workspace.tabs.dataSources` in fr/en.

- [ ] **Step 4: Conditional content render**

Wrap the existing canvas/EditorPane SplitPane in a conditional block — only render when tab === "overview". For "translations" and "data-sources", render placeholder for now (real content lands in E3/E4) :

```tsx
{tab === "overview" && (
  <div className="min-h-0 flex-1">
    {isDesktop ? (
      <SplitPane …>
        …
      </SplitPane>
    ) : (
      // existing mobile layout
    )}
  </div>
)}
{tab === "translations" && (
  <div className="p-6 text-zinc-500">(Translations content lands in next task)</div>
)}
{tab === "data-sources" && (
  <div className="p-6 text-zinc-500">(Data Sources content lands in next task)</div>
)}
```

- [ ] **Step 5: Run editor tests**

```bash
cd editor && npx vitest run
```

Expected: no regression. Some tests may now fail if they assume the canvas is always rendered — investigate and update assertions to add `?tab=overview` to the test URL (use `validateSearch` to default).

- [ ] **Step 6: Commit**

```bash
git add editor/src/routes/workspace.\$workspaceId.tsx editor/src/locales/
git commit -m "feat(editor): workspace shell wires ?tab= query param + tab strip"
```

### Task E3: Translations tab = inline TranslationPanel

**Files:**
- Modify: `editor/src/routes/workspace.$workspaceId.tsx`
- Modify: `editor/src/features/translations/TranslationPanel.tsx` (if needed for embedded rendering)

- [ ] **Step 1: Inspect TranslationPanel**

```bash
cd editor && head -50 src/features/translations/TranslationPanel.tsx
```

Note whether it expects to be rendered as a modal (with `open` / `onClose` props) or can be rendered inline.

- [ ] **Step 2: If modal-only, add an `embedded` mode**

If TranslationPanel currently has a modal wrapper (e.g. `Sheet` / `Dialog`), wrap its inner content in an exported `TranslationPanelContent` component so it can be rendered without the modal chrome. Example pattern :

```tsx
// editor/src/features/translations/TranslationPanel.tsx
export function TranslationPanelContent({ pack }: { pack: Pack }) {
  // … all the actual editor UI, no modal chrome
}

export function TranslationPanel({ pack, open, onClose }: TranslationPanelProps) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-96">
        <TranslationPanelContent pack={pack} />
      </SheetContent>
    </Sheet>
  );
}
```

If TranslationPanel is already split or has an embedded mode, skip this step.

- [ ] **Step 3: Replace placeholder in workspace route**

In the workspace route's `tab === "translations"` branch, replace the placeholder with :

```tsx
{tab === "translations" && pack && (
  <div className="min-h-0 flex-1 overflow-auto p-4">
    <TranslationPanelContent pack={pack} />
  </div>
)}
```

Add import `import { TranslationPanelContent } from "@/features/translations/TranslationPanel";`.

- [ ] **Step 4: Remove the old top-bar `Languages` button + `translationsOpen` state**

In the workspace route, find the `<TopBarIconButton onClick={() => setTranslationsOpen(true)}>` (line ~217 with `<Languages>` icon) — DELETE this block. Also delete the `const [translationsOpen, setTranslationsOpen] = useState(false);` declaration. Also delete the `<TranslationPanel open={translationsOpen} … />` modal at the bottom of the JSX.

- [ ] **Step 5: Run editor tests**

```bash
cd editor && npx vitest run
```

Expected: existing TranslationPanel tests may fail if they test the modal API. Update them to test the new `TranslationPanelContent` directly (without the modal wrapper assertions).

- [ ] **Step 6: Commit**

```bash
git add editor/src/routes/workspace.\$workspaceId.tsx editor/src/features/translations/
git commit -m "feat(editor): Translations tab inline + remove modal trigger from top bar"
```

### Task E4: Data Sources tab = inline DataSourcesPanel

**Files:**
- Modify: `editor/src/routes/workspace.$workspaceId.tsx`
- Modify: `editor/src/features/data/DataSourcesPanel.tsx` (if needed)

Same pattern as E3.

- [ ] **Step 1: Inspect + adapt DataSourcesPanel if it's modal-only**

Wrap its inner content in `DataSourcesPanelContent` exportable component (same pattern as E3 Step 2).

- [ ] **Step 2: Render in workspace route**

In the `tab === "data-sources"` branch, replace the placeholder :

```tsx
{tab === "data-sources" && pack && (
  <div className="min-h-0 flex-1 overflow-auto p-4">
    <DataSourcesPanelContent pack={pack} />
  </div>
)}
```

Add import.

- [ ] **Step 3: Remove the old top-bar `Database` button + state**

Delete the `<button onClick={() => setDataSourcesOpen(true)}>` block (the one with `<Database>` icon, line ~232) and the `const [dataSourcesOpen, setDataSourcesOpen] = useState(false);` state, and the `<DataSourcesPanel open={dataSourcesOpen} …/>` modal at the bottom.

- [ ] **Step 4: Run tests + commit**

```bash
cd editor && npx vitest run
```

```bash
git add editor/src/routes/workspace.\$workspaceId.tsx editor/src/features/data/
git commit -m "feat(editor): Data Sources tab inline + remove modal trigger from top bar"
```

---

## Phase F — Top bar refactor + kebab dropdown

### Task F1: TopBarKebabMenu component — TDD

**Files:**
- Create: `editor/src/components/TopBarKebabMenu.tsx`
- Create: `editor/src/components/TopBarKebabMenu.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// editor/src/components/TopBarKebabMenu.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TopBarKebabMenu } from "./TopBarKebabMenu";

describe("TopBarKebabMenu", () => {
  const baseProps = {
    onImport: vi.fn(),
    onExport: vi.fn(),
    onOpenPatterns: vi.fn(),
    onDelete: vi.fn(),
  };

  it("renders the kebab trigger button", () => {
    render(<TopBarKebabMenu {...baseProps} />);
    expect(screen.getByRole("button", { name: /more|menu|⋮/i })).toBeInTheDocument();
  });

  it("opens menu on click and shows Import/Export/Patterns/Delete", () => {
    render(<TopBarKebabMenu {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /more|menu|⋮/i }));
    expect(screen.getByText(/Importer|Import/i)).toBeInTheDocument();
    expect(screen.getByText(/Exporter|Export/i)).toBeInTheDocument();
    expect(screen.getByText(/Patterns/i)).toBeInTheDocument();
    expect(screen.getByText(/Supprimer|Delete/i)).toBeInTheDocument();
  });

  it("calls the right handler when an item is clicked", () => {
    const onDelete = vi.fn();
    render(<TopBarKebabMenu {...baseProps} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: /more|menu|⋮/i }));
    fireEvent.click(screen.getByText(/Supprimer|Delete/i));
    expect(onDelete).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement**

Reuse the existing shadcn `DropdownMenu` already imported in `workspace.$workspaceId.tsx`. If shadcn is set up, use it; otherwise inline a controlled dropdown.

```tsx
// editor/src/components/TopBarKebabMenu.tsx
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "react-i18next";
import { MoreVertical } from "lucide-react";

interface TopBarKebabMenuProps {
  onImport: () => void;
  onExport: () => void;
  onOpenPatterns: () => void;
  onDelete: () => void;
}

export function TopBarKebabMenu({ onImport, onExport, onOpenPatterns, onDelete }: TopBarKebabMenuProps) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("topbar.more")}
        className="flex h-8 w-8 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
      >
        <MoreVertical className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onImport}>{t("topbar.import")}</DropdownMenuItem>
        <DropdownMenuItem onClick={onExport}>{t("topbar.export")}</DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenPatterns}>{t("patterns.title")}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onDelete} className="text-red-400 focus:text-red-300">
          {t("topbar.deletePack")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

Add i18n keys `topbar.more`, `topbar.import`, `topbar.export` in fr/en if missing. (`topbar.deletePack` and `patterns.title` already exist.)

- [ ] **Step 3: Run tests**

```bash
cd editor && npx vitest run src/components/TopBarKebabMenu.test.tsx
```

Expected: 3 PASS.

- [ ] **Step 4: Commit**

```bash
git add editor/src/components/TopBarKebabMenu.tsx editor/src/components/TopBarKebabMenu.test.tsx editor/src/locales/
git commit -m "feat(editor): TopBarKebabMenu dropdown component"
```

### Task F2: Wire TopBarKebabMenu in workspace route + remove moved items

**Files:**
- Modify: `editor/src/routes/workspace.$workspaceId.tsx`

- [ ] **Step 1: Wire the kebab + remove moved items**

In the workspace route's top bar JSX, REMOVE :
- `<PackIOButtons pack={pack} />` (the import/export buttons)
- `<EditorLangSwitcher />` (now in /settings via Phase D — keep the file deleted? no, the component is still used in /settings. Just remove the JSX usage here.)
- The Patterns gallery `<TopBarIconButton ... PatternsGallery />` (with BookOpen icon)
- The Delete pack button (the red `<button>` with `t("topbar.deletePack")`)

REPLACE with the new kebab + retain the still-prominent items :

```tsx
import { TopBarKebabMenu } from "@/components/TopBarKebabMenu";
import { PackIOButtons } from "..."; // existing — note where it's defined

// Inside the top bar JSX, the simplified row :
<div className="flex h-12 shrink-0 items-center gap-2 border-zinc-800 border-b bg-zinc-950 px-2">
  <div className="min-w-0 flex-1 truncate px-1 font-mono text-sm text-zinc-200">
    {pack?.name ?? "—"}
  </div>
  {pack ? <LangSwitcher pack={pack} /> : null}
  <UndoRedoButtons />
  {pack ? <DeployButtons pack={pack} packId={pId} /> : null}
  {pack && (
    <TopBarKebabMenu
      onImport={() => triggerImport()}
      onExport={() => triggerExport(pack)}
      onOpenPatterns={() => setPatternsOpen(true)}
      onDelete={() => setShowDeleteDialog(true)}
    />
  )}
</div>
```

Where `triggerImport` / `triggerExport` are extracted from the previous `PackIOButtons` component. If extracting is too invasive, alternative : import the PackIOButtons internals (likely two function handlers exported alongside the button JSX) directly.

If `PackIOButtons` is one monolithic component, the cleanest V1 approach : keep `PackIOButtons` mounted in the kebab menu by wrapping its internals. The least disruptive path : EXPORT named handlers `importPack()` / `exportPack(pack)` from `PackIOButtons.tsx` for reuse here.

Pragmatic fallback if `PackIOButtons` internals are tangled : leave the import/export buttons OUT of the kebab for V1 and document the gap. (User said Import/Export should be in the kebab — so make every effort to land them there.)

- [ ] **Step 2: Verify `patternsOpen` state + `<PatternsGallery>` modal stays**

The PatternsGallery is still a modal — only the **trigger** moved into the kebab. The state `const [patternsOpen, setPatternsOpen] = useState(false);` stays. The `<PatternsGallery open={patternsOpen} onClose={…} />` modal at the bottom of the JSX also stays. Same for the delete dialog (`<DeletePackDialog />`).

- [ ] **Step 3: Run editor tests**

```bash
cd editor && npx vitest run
```

Expected: all green minus the 5 pre-existing LoginForm/SignupForm. Investigate any NEW failure.

- [ ] **Step 4: Smoke test in browser**

Open `http://localhost:5173/workspace/<any_id>`. Verify :
- Top bar is simpler : pack name, pack lang, undo/redo, deploy, kebab ⋮
- Kebab opens dropdown : Import / Export / Patterns / ─── / Delete
- Tabs visible : Overview (active) / Translations / Data Sources
- Click Translations → URL `?tab=translations`, content swaps to TranslationPanel
- EditorLangSwitcher is gone from top bar (it's in /settings now)

- [ ] **Step 5: Commit**

```bash
git add editor/src/routes/workspace.\$workspaceId.tsx
git commit -m "feat(editor): simplified top bar (kebab dropdown for secondary actions)"
```

---

## Phase G — Verification + docs

### Task G1: Full test sweep

- [ ] Run `cd backend && bun test` — expect 462+ pass / 25-27 pre-existing flakes
- [ ] Run `cd editor && npx vitest run` — expect 858+ pass / 5 pre-existing fails
- [ ] Run `cd plugin && ./gradlew test` — expect all green (no plugin changes in this plan, sanity check only)

### Task G2: Docker smoke

- [ ] `docker compose restart backend` — verify `[migrate] done` (new editor_language migration applied)
- [ ] In browser :
  - [ ] `http://localhost:5173/settings` — Apparence section + language switcher visible
  - [ ] Change language via the switcher → confirm `PATCH /api/v1/auth/me` fires in DevTools network tab (logged-in user)
  - [ ] Logout, reload, change language again → no PATCH (anonymous)
  - [ ] Login again → if backend has a value, the editor picks it up + i18n switches
  - [ ] `http://localhost:5173/workspace/<id>` — tab strip with 3 tabs, click each to confirm content swaps
  - [ ] `http://localhost:5173/workspace/<id>?tab=translations` — direct deeplink loads on Translations tab
  - [ ] Top bar has kebab `⋮` ; click → Import/Export/Patterns/Delete options

### Task G3: Docs sync

- [ ] Update `CLAUDE.md` :
  - Add note about `/settings` route + `users.editor_language`
  - Update reference to Workspace UI (now has tabs)
- [ ] Update `.claude/skills/sync-docs/doc-impact-map.yaml` :
  - `backend/src/routes/auth.ts` → ensure CLAUDE.md is listed (probably already)
  - Add `editor/src/routes/settings.tsx` → CLAUDE.md (new route, user-facing)
  - Add `editor/src/components/WorkspaceTabs.tsx` → CLAUDE.md (workspace structure change)

Commit :
```bash
git add CLAUDE.md .claude/skills/sync-docs/doc-impact-map.yaml
git commit -m "docs: workspace tabs + settings page + editor_language sync"
```

---

## Self-Review

**1. Spec coverage**

| Spec §6.1 item | Covered by |
|---|---|
| `WorkspaceShell` component | E1 (`WorkspaceTabs`) + E2 (route wires tabs) |
| Tab routes / state via ?tab= | E2 |
| Workspace tab : Overview | E2 (default render = existing canvas) |
| Workspace tab : Translations | E3 |
| Workspace tab : Data Sources | E4 |
| Top bar refactor | F2 |
| Kebab dropdown | F1 + F2 |
| Badge translations missing on tab | E2 (`tabs` array uses `totalMissing(pack)` for badge) |
| Sidebar Settings button | D3 |
| /settings route + sections sidebar | D2 |
| Section Apparence | D1 |
| Backend `users.editor_language` | A1 + A2 + A3 |
| Sync flow login/change | B1 + B2 + B3 |

All §6.1 items covered.

**2. Placeholder scan**

No "TBD", "TODO", "implement later" in plan body. A few `(adapt to existing helpers …)` notes which are guidance to the implementer, not placeholders — the surrounding code blocks contain the actual implementation.

**3. Type consistency**

- `WorkspaceTab.id: string` in E1, used as `"overview" | "translations" | "data-sources"` in E2 — narrowed string literal type at the workspace route's `validateSearch`. Consistent.
- `editor_language` field naming : `editor_language` (snake_case) in DB + API DTO. Editor reads `currentUser.editor_language` directly. Consistent across A1/A2/A3/B1/B2/B3.
- `TopBarKebabMenu` props match the handlers wired in F2 (`onImport`, `onExport`, `onOpenPatterns`, `onDelete`). Consistent.
- `TranslationPanelContent` / `DataSourcesPanelContent` are new exports in E3/E4. Need confirmation that the wrap is feasible at impl time — fallback path documented in E3 Step 2.

**4. Notable risk + mitigation**

- **`PackIOButtons` extraction** (F2) — if the existing component is tangled, the implementer has explicit fallback guidance to leave Import/Export out of the kebab for V1 and document the gap. The user wanted them in the kebab, so the implementer should push to extract handlers cleanly.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-27-workspace-shell-and-settings.md`.**
