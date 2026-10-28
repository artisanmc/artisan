# Workspace Shell + Settings Page Design

> Spec brainstormed on 2026-05-27. Extends `docs/superpowers/specs/2026-05-26-ui-information-architecture-design.md` §3 — the Workspace goes from "full-screen canvas without tabs" to "tabbed shell with Overview by default + built-in Translations + Data Sources". Aligns the Workspace with the Module hub (same structure).

**Goal** — Declutter the canvas top bar (too many buttons for the user), unify Workspace and Module behind the same tabbed shell, and create a dedicated Settings page to host UI preferences (editor language in V1, other sections later).

**Status** — Spec validated on 2026-05-27. V1 implementation below.

---

## 1. Captured decisions

User answers to the brainstorming:

1. **Architectural pivot** — Workspace becomes a tabbed shell (like the Module). **OK**.
2. **Editor language storage** — localStorage + backend sync if logged in (`B`).
3. **Settings** — dedicated `/settings` page with sections (`C`), not a popover.
4. **Top bar kebab dropdown** — Import + Export + Delete pack (`B`).
5. **PatternsGallery** — moved into the kebab (`B`).

---

## 2. Workspace shell

**Lexicon** — "shell" here means the internal structure of the `/workspace/$workspaceId` route (top bar + tab strip + content). It is different from the global `WorkspaceSidebar` (mounted in `__root.tsx`, to the left of the `Outlet`) which stays unchanged apart from the addition of the Settings button §4.1.

### 2.1 Layout

```
┌─────────────────────────────────────────────────────────────┐
│ [Pack name]  [Pack lang ▾]  [Undo Redo]  [Deploy]  [⋮]      │  ← top bar
├─────────────────────────────────────────────────────────────┤
│ [Overview *]  [Translations]  [Data Sources]                │  ← full-page tabs
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  (Active tab: Konva canvas, or Translations, or DS)         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Built-in tabs

| Tab | Content | Source |
|---|---|---|
| **Overview** (default) | The current Konva canvas (menus/commands/dialogs inline). No behavior change. | Existing: `Stage` + `EditorPane` in `SplitPane`. |
| **Translations** | The Translations page full-screen. Replaces the overlay triggered today by the top bar's `Languages` button. | Adapt `TranslationPanel` to display as a page (not modal). |
| **Data Sources** | Same, full-screen. | Adapt `DataSourcesPanel`. |

### 2.3 Modules extension (V1.5+, out of V1 impl scope)

The Module hub (already specified in yesterday's spec §4) keeps the same structure. The built-in tabs (Overview / Translations / Data Sources) are common to Workspace + Module; the Module adds its tabs (Data, Categories…) declared by the plugin via its `FrontendModule.tabs[]`.

### 2.4 Navigation between tabs

Query param `?tab=overview|translations|data-sources` on `/workspace/$workspaceId`. Default `overview`. Switching = `useNavigate({ search: { tab: "translations" } })`. Allows deeplinks + clean back/forward.

---

## 3. Simplified top bar

### 3.1 Composition after refactor

From left to right:

1. **Pack name** (display)
2. **`LangSwitcher`** — language selector for the pack's **content** (controls what the canvas shows in preview)
3. **`UndoRedoButtons`**
4. **`DeployButtons`**
5. **Kebab `⋮`** — dropdown

### 3.2 Kebab dropdown content

```
┌─────────────────────────┐
│ Import a pack           │
│ Export the pack         │
│ Patterns gallery        │
│ ─────────────────────── │
│ Delete this workspace   │  ← red, at the bottom, separated
└─────────────────────────┘
```

The separator isolates the destructive action.

### 3.3 Elements removed from the top bar

- `EditorLangSwitcher` → moved to `/settings` §4
- Translations button (`Languages` icon + badge) → replaced by the tab
- Data Sources button (`Database` icon) → replaced by the tab
- Patterns gallery button (`BookOpen` icon) → in the kebab
- Delete pack button (red) → in the kebab
- `PackIOButtons` (import + export) → in the kebab

### 3.4 "Translations missing" badge

The numeric badge on the current Translations button (count of untranslated keys) — to carry over onto the "Translations" tab itself when `totalMissing(pack) > 0`.

---

## 4. Settings sidebar + `/settings` page

### 4.1 Button in the sidebar

`WorkspaceSidebar` gains a **Settings button at the bottom** (sticky bottom of the sidebar, under the Modules section):

```
┌─────────────────────────┐
│ [Network Dropdown ▾]    │
├─────────────────────────┤
│ MY WORKSPACES           │
│  • Main menu            │
│  • Lobby                │
│  • + New workspace      │
│                         │
│ INSTALLED MODULES       │
│  No module installed.   │
├─────────────────────────┤
│ ⚙ Settings              │  ← sticky bottom
└─────────────────────────┘
```

Layout: the sidebar becomes `flex flex-col`, the scrollable middle area takes `flex-1`, the Settings button is at the bottom.

### 4.2 `/settings` route

New route `editor/src/routes/settings.tsx`. Internal layout: sections sidebar on the left, content on the right.

```
┌───────────────────┬─────────────────────────────────┐
│ Appearance *      │  Appearance                     │
│ (future: Account) │  ┌────────────────────────────┐ │
│                   │  │ Editor language:           │ │
│                   │  │ [EditorLangSwitcher]       │ │
│                   │  └────────────────────────────┘ │
└───────────────────┴─────────────────────────────────┘
```

V1 only ships the **Appearance** section. Stubs for Account / Notifications remain for future iterations.

---

## 5. Editor language storage

### 5.1 Architecture

- **Client-side source of truth**: `localStorage["i18nextLng"]` (key already used by react-i18next).
- **If the user is logged in**: also persisted on the backend in `users.editor_language` (new nullable TEXT column).
- **Anonymous**: localStorage only.

### 5.2 Sync flow

| Trigger | Action |
|---|---|
| **At boot (hydrate)** | `getMe()` returns the user with `editor_language?`. If present and different from `localStorage["i18nextLng"]` → overwrite localStorage + `i18n.changeLanguage(serverValue)`. |
| **On change (user clicks EditorLangSwitcher in /settings)** | Update localStorage + `i18n.changeLanguage(newValue)` immediately. If logged in: `PATCH /api/v1/auth/me { editor_language: newValue }` async (fire-and-forget, non-blocking). |
| **On login** | Same as boot — fetch the user's `editor_language`, sync localStorage. |
| **On logout** | Keep localStorage as is (the anonymous user keeps their preference in their browser). |

### 5.3 Backend changes

- **Schema**: new column `users.editor_language` (nullable TEXT, default NULL).
- **Drizzle migration**: `backend/drizzle/000X_add_user_editor_language.sql`.
- **Endpoint**: `PATCH /api/v1/auth/me` body `{ editor_language?: string }` → updates the session-cookie user's `users.editor_language`. Returns `{ user: AuthUserDto }`.
- **Extended endpoint**: `GET /api/v1/auth/me` now returns `editor_language` in the `user` DTO.

### 5.4 Edge cases

- **Backend down** at the time of the change: localStorage is updated directly, the PATCH fails silently (console warn log). At the next reload, if the user re-fetches via `getMe()`, the backend returns the old value — but localStorage has the new one. Conflict? We stay on the STRATEGY backend = source of truth for logged-in: if the backend returns a value, overwrite localStorage. **Practical consequence**: if the user changes the language offline (backend down), the change is local only and will be overwritten at the next getMe(). Acceptable as a V1 limitation.
- **Anonymous → login transition**: if the anonymous user has "fr" in localStorage and logs into an account that has "en" on the backend → overwrite localStorage with "en". If we want to preserve the anonymous choice: add a step "do you want to keep your preferred language?" — not critical V1, default = backend wins.

---

## 6. V1 scope

### 6.1 In scope

| Item | Detail |
|---|---|
| `WorkspaceShell` component | Tabs at the top. Default `?tab=overview`. Switching via URL param. |
| Tab routes / state | Query param, no file-based subroutes (overkill). |
| Workspace tab: Overview | The existing canvas (Stage + EditorPane). No functional change. |
| Workspace tab: Translations | Adapt `TranslationPanel` to display as a page (not modal). |
| Workspace tab: Data Sources | Adapt `DataSourcesPanel`. |
| Top bar refactor | Removal of the moved items, addition of the kebab dropdown. |
| Kebab dropdown component | Import / Export / Patterns / ─── / Delete pack. |
| Translations missing badge | On the "Translations" tab (replaces the badge of the removed button). |
| Sidebar Settings button | Sticky bottom, link to `/settings`. |
| `/settings` route + sections sidebar | Split layout. Appearance section visible. |
| Appearance section | Contains the adapted `EditorLangSwitcher`. |
| Backend `users.editor_language` | Migration + PATCH endpoint + extended GET. |
| Login/change sync flow | Code in `authStore.hydrate` + `EditorLangSwitcher` onChange. |

### 6.2 Out of scope (deferred V1.5 or later)

- Moving `/account` into `/settings` (Account page will be added later)
- Settings sections other than Appearance (Notifications, Workspaces defaults, etc.)
- Rework of the Patterns gallery content (just moved)
- Module-injected tabs (already specified in yesterday's spec §4, not affected here)
- Internal restructure of `TranslationPanel` beyond the minimum for it to display as a page

---

## 7. Migration / breaking notes

- The `TranslationPanel` component today expects to be rendered in an overlay/modal controlled by `translationsOpen` state. New usage: rendered inline on the tab page. No API breaking but layout adjustments.
- Same for `DataSourcesPanel`.
- The current `EditorLangSwitcher` is a button component in the top bar. Migrated as is into `/settings` (just a mount point move), the component itself is minimally adapted to call the backend sync in addition to `i18n.changeLanguage`.

---

## 8. UI edge cases

- **Tab switching with unsaved changes**: autosave already exists (`usePackAutoSave` 2s debounce). In theory no unsaved changes. Edge to validate in QA.
- **Deeplink `/workspace/$id?tab=translations`**: page loads directly on this tab. Browser back/forward works.
- **Translations / Data Sources tab rendered without a loaded pack**: show a "Pack loading…" state consistent with the canvas.
- **Pack deleted while the user is on a non-Overview tab**: navigate to `/` (same behavior as today on the canvas).

---

## 9. Deferred non-decisions

To dig into when the need emerges:
- **Pack content LangSwitcher position**: stays in the top bar for V1 (controls the canvas). Could migrate to the head of the Translations tab in V2 if the user only uses it there.
- **Settings sections sidebar: tabs vs list**: to decide when adding the 2nd section. V1 = vertical list fixed on the left, 1 visible section.
- **Mobile UX**: V1 = the top bar and tabs scroll horizontally on overflow. No mobile-specific design. To iterate.
