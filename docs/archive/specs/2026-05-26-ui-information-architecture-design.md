# UI Information Architecture Design

> Spec brainstormed on 2026-05-26 to frame Artisan's main navigation as modules arrive. Source of truth for the corresponding implementation plan.

**Goal** — Replace the placeholder sidebar (`Menus` + `Commands` which both pointed to `/networks`, a legacy of the modular monolith migration) with a real information architecture that scales up to the arrival of third-party modules (Shop V1.5, Quests V2…). Along the way, rename "Pack" to avoid confusion with "resource pack" and fix the structure of a Module page that will be used in V1.5+.

**Status** — Spec validated. V1 implementation = sidebar restructure + rename. Module hub UI documented but implemented in V1.5 when shop arrives.

---

## 1. Vocabulary

| Before | After | Why |
|---|---|---|
| Pack | **Workspace** | "Pack" evokes resource/datapack in a Minecraft context. "Workspace" is neutral and industry-standard. |
| Canvas (of the Module hub) | **Overview** | Default view of a page (Workspace or Module), not a reference to the Konva implementation. |

The word "Workspace" is used identically in EN and FR (the English-speaking market is larger, and "Espace" in FR is less clear).

**Rename perimeter**:
- ✅ UI labels everywhere
- ✅ Route `/pack/$packId` → `/workspace/$workspaceId`
- ❌ DB type `packs` (table), columns `pack_id`, `packs.id` — not touched (refactor not worth it)
- ❌ WS protocol — `pack_id`, `pack_hashes`, `bundle_available.pack_id` (changing = breaking, out of scope)
- ❌ REST API — `/api/v1/user/packs/*`, `/api/v1/networks/:id/packs/*` (versioned, breaking = needs v2)

Consequence: "Pack" stays an internal term (DB, protocol, API) but disappears on the user side. That is OK — admins never see the DB schema.

## 2. Sidebar (always visible)

Composition from top to bottom:

```
┌─────────────────────────────┐
│ [My Network ▼]              │  ← Network dropdown
├─────────────────────────────┤
│ MY WORKSPACES               │
│  📋 Main menu               │  ← workspaces of the current network
│  🏠 Lobby                   │
│  ⭐ Ranks                   │
│  + New workspace            │
│                             │
│ INSTALLED MODULES           │
│  ┌─────────────────────┐    │
│  │ No module           │    │  ← V1: empty state
│  │ installed. Shop,    │    │
│  │ Quests… coming.     │    │
│  └─────────────────────┘    │
└─────────────────────────────┘
```

### 2.1 Network dropdown

- Shows the name of the active Network.
- Click → dropdown listing all the user's Networks (membership). Click on another Network = switch.
- A "Manage networks" entry at the bottom of the dropdown → `/networks` page (list + settings, current behavior).
- Empty state: if the user has no Network (case after /artisan setup without the complete flow), redirect straight to `/networks` or `/setup`.

### 2.2 "MY WORKSPACES" section

- Lists the workspaces of the active Network, ordered by updated_at desc (most-recently-edited first).
- Click on a workspace → navigate `/workspace/$workspaceId`.
- "+ New workspace" → creation modal (name + description, as today).
- Visible **always**, even if the list is empty (with a more visible + button in the middle).

### 2.3 "INSTALLED MODULES" section

- **V1**: factual empty state. Text:
  > No module installed. Artisan-compatible plugins (Shop, Quests, etc.) will appear here when you add them to your server.

  No promo, no "coming soon", no Discord link — a neutral signal that this space exists and will fill up.

- **V1.5+** (out of V1 implementation scope, documented here for the future plan):
  - Lists the installed modules aggregated from the active Network's server_keys.
  - Source of truth: `hello.installed_modules: [{id, version}, …]` that each plugin sends (already specified in `versioning.md` §4.1). Backend stores per server_key, derives the union for a Network.
  - If two server_keys of the same Network have different module versions (rare case), take the highest version and log a UI warning.
  - Click on a module → navigate `/module/$moduleId` (separate route — a module is not a workspace).

## 3. Workspace page `/workspace/$workspaceId`

**V1 behavior**: identical to the current `/pack/$packId`, just the path renamed and the UI labels updated.

No tabs at the top. The Konva canvas takes up most of the screen, with the PackMiniSidebar on the left to navigate between the workspace's menus, and the panels (Library, Translations, DataSources, History, BranchSwitcher) reachable via the existing buttons.

A single visible UI change: every "Pack" label becomes "Workspace".

## 4. Module page `/module/$moduleId` (V1.5+, spec only)

**Out of V1 implementation scope.** Documented here because the structure dictates the shape of the `FrontendModule` interface we already laid down in the modular monolith migration.

### 4.1 Shell: tabs at the top

```
┌──────────────────────────────────────────────────┐
│ 🛒 Shop v1.0 · main branch                       │
├──────────────────────────────────────────────────┤
│ [Overview] [Data] [Categories]                   │  ← tabs
├──────────────────────────────────────────────────┤
│                                                  │
│  (content of the active tab)                     │
│                                                  │
└──────────────────────────────────────────────────┘
```

### 4.2 Tabs

- **Overview** (always present, the first): the canvas. Pre-filled with the menus / commands / dialogs that the plugin seeded at module bootstrap. Editable like a normal workspace.
- **Following tabs**: declared by the plugin via its `FrontendModule`. Each tab = name + React component + (optional) JSON Schema rendered via `<SchemaForm>`.

Example for Shop V1.5:
```ts
const shopModule: FrontendModule = {
  id: "shop",
  displayName: "Shop",
  schemaVersion: "shop/v1",
  sidebar: { icon: ShopIcon, label: "Shop", to: "/module/shop" },
  tabs: [
    // Overview is implicit, added by the shell
    { id: "data", label: "Data", schema: shopItemListSchema },
    { id: "categories", label: "Categories", schema: shopCategoriesSchema },
  ],
  routes: [],
};
```

### 4.3 Discovery on the plugin side

How does the editor know a Shop module exists?
1. The Java plugin `ArtisanShop.jar` is installed on an MC server.
2. At the WS hello, it sends `installed_modules: [{id: "shop", version: "1.0.0"}, …]`.
3. Backend persists per server_key (table `server_modules`, to create in V1.5).
4. The editor fetches a Network's modules = union of the modules of its server_keys.
5. To render the Module page, the editor needs the `FrontendModule` on the JS side. Two options to explore in V1.5:
   - (a) Bundle the `FrontendModule`s JS in the editor app (static registry). Works for official Artisan modules.
   - (b) Load dynamically from a CDN or from the backend endpoint. Necessary for third-party modules V3+.

V1.5 probably ships with (a). (b) wait for V3+.

## 5. V1 removal

To remove from the current sidebar:
- "Menus" entry pointing to `/networks`
- "Commands" entry pointing to `/networks`

These entries came from the modular monolith migration where we laid down the `menus` and `commands` `FrontendModule`s as placeholders. The new sidebar takes their place.

The `menus` and `commands` `FrontendModule`s can stay in the editor code (`editor/src/modules/{menus,commands}/index.ts`) — they keep their conceptual usefulness in the registry. We just remove them from the sidebar rendering.

## 6. V1 implementation scope

What is implemented now:

| Item | Detail |
|---|---|
| `WorkspaceSidebar` component | Replaces the current `ModuleSidebar`. Network dropdown + Workspaces section + Modules section (empty state). |
| Network dropdown component | Reads `useAuthStore` + `useNetworksStore`, handles switching. |
| Workspaces section | Fetch via `listNetworkPacks(networkId)` (existing backend route). |
| Modules section empty state | Fixed text (no API call in V1). |
| Route rename | `editor/src/routes/pack.$packId.tsx` → `workspace.$workspaceId.tsx`. The `/pack/:id` route stays mounted as a stub that calls `useNavigate({ to: "/workspace/$id", replace: true })` on mount, to preserve bookmarks and external links. |
| UI label rename | All user-facing `Pack` → `Workspace`. Includes breadcrumbs, modals, error messages, toasts. |
| Sidebar deletion | Remove the rendering of the `menus` and `commands` modules (the registry keeps them, just not displayed). |

What is NOT implemented in V1 (deferred V1.5):
- `/module/$moduleId` page and its tabs shell
- `installed_modules` detection from the WS hello (backend storage side + editor fetch side)
- `FrontendModule.tabs[]` type extension (interface)
- `<SchemaForm>` wiring to the Data tabs

## 7. V1 edge cases

- **User without a Network**: redirect to `/setup` (existing behavior preserved).
- **User with a single Network**: the dropdown shows the name but does not show the switching menu (just a discreet caret, no spam).
- **Switching Network with a workspace open**: navigate to `/networks/$newNetworkId` (the new network's home page), not to a random workspace. The user sees the new list of workspaces.
- **Legacy deeplink `/pack/abc123`**: the `/pack/$packId` route stays mounted but does `useNavigate({ to: "/workspace/$packId", replace: true })` on mount (client-side redirect, preserves bookmarks and external links).

## 8. Deferred non-decisions

Not settled here (to dig into when the need emerges):
- **Module = per network or per server_key?** In V1.5+, if a Network has 3 server_keys and only one of them has Shop installed, does Shop appear in the Network's sidebar? Probably yes (the admin manages Shop for that server from the editor). But to validate when we implement.
- **Tab order / pin**: V1.5+ — can the user reorder a Module's tabs? V1.5 = no, order dictated by the plugin. To revisit with feedback.
- **Workspace pinning**: can the user pin their favorite workspaces at the top of the list? V1 = no, sort by updated_at. To revisit with feedback.

---

## Appendix: captured user decisions

1. **Q: Pack = Module or Pack ≠ Module?** → **B (separate Workspaces vs Modules)**
2. **Q: How to rename Pack?** → **Workspace** (EN + FR)
3. **Q: Internal layout?** → **Workspace = canvas only. Module = canvas + tabs**
4. **Q: How to rename Canvas?** → **Overview**
5. **Q: Network hierarchy in the sidebar?** → **B (Network dropdown at the top)**
6. **Q: Modules section V1?** → **Factual empty state**
7. **Q: Rename the route path too?** → **Yes**
