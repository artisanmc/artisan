# Theming System — Design Spec

**Date:** 2026-06-04
**Status:** Validated 2026-06-04

**Goal:** Replace the current single-mode warm-terracotta palette (perceived as "Halloween-themed") with a clean, neutral dark/light system that lets us iterate on colors by editing one file. Add a real light mode. Decouple components from raw color tokens so the next palette change costs ~5 minutes instead of a 100-file sweep.

---

## 1. Problem statement

Current state (`editor/src/styles/globals.css`):

- Single mode (dark) with warm/terracotta palette: `--terra` orange, `--brick` red, `--gold`, `--sage` on warm-brown surfaces (`--bg #1A1815`, `--raised #221F1B`).
- Aesthetic reads as Halloween / autumnal — too much warmth, too much identity for an editor whose job is to make user content (Minecraft items, screenshots, custom textures) shine.
- ~100 files reference raw color tokens directly (`var(--terra)`, `var(--ink)`, `var(--bg)`). Changing the palette means grepping 100 files.
- No light mode at all.
- Some shadcn-style aliases (`--background`, `--primary`) already exist but coexist with raw-token usage in components — no enforced layering.

---

## 2. Architecture: 3-layer token system

### Layer 1 — Raw palette (reference only, never consumed by components)

Defined once in `:root`, the same in both themes. Components MUST NOT use these directly.

```css
/* Neutrals (Slate-ish, cool gray) */
--gray-50:  #F8FAFC;
--gray-100: #F1F5F9;
--gray-200: #E2E8F0;
--gray-300: #CBD5E1;
--gray-400: #94A3B8;
--gray-500: #64748B;
--gray-600: #475569;
--gray-700: #334155;
--gray-800: #1F242E;
--gray-900: #181B22;
--gray-950: #0F1115;

/* Brand accent — Emerald */
--emerald-300: #6EE7B7;
--emerald-400: #34D399;
--emerald-500: #10B981;
--emerald-600: #059669;
--emerald-700: #047857;
--emerald-800: #065F46;

/* Status — red / amber */
--red-400: #F87171;
--red-500: #EF4444;
--red-600: #DC2626;
--amber-400: #FBBF24;
--amber-500: #F59E0B;
--amber-600: #D97706;
```

### Layer 2 — Semantic tokens (the component API)

This is **what every component uses.** Redefined per theme via `[data-theme="..."]` on `<html>`. Components reference `var(--surface)`, never `var(--gray-900)`.

```css
:root, :root[data-theme="dark"] {
  /* Surfaces */
  --surface:           var(--gray-950);   /* page bg */
  --surface-raised:    var(--gray-900);   /* cards, modals */
  --surface-raised-2:  var(--gray-800);   /* hover, nested raised */
  --surface-inset:     #0A0C10;           /* inputs, code blocks */
  --surface-hover:     var(--gray-800);

  /* Text */
  --text:              var(--gray-100);   /* primary */
  --text-mut:          var(--gray-400);   /* secondary, captions */
  --text-faint:        var(--gray-500);   /* tertiary, disabled */
  --text-on-accent:    #FFFFFF;

  /* Borders */
  --border-soft:       #2A2F3A;
  --border:            #3C424F;
  --border-strong:     var(--gray-600);

  /* Brand accent (interactive surfaces — CTAs, focus rings, active links) */
  --brand:             var(--emerald-500);
  --brand-hover:       var(--emerald-600);
  --brand-fg:          #FFFFFF;
  --brand-soft:        rgba(16, 185, 129, 0.12);   /* tinted bg, focus rings */
  --brand-line:        rgba(16, 185, 129, 0.48);   /* tinted border */

  /* Status */
  --success:           var(--emerald-400);  /* transient OK, online dot */
  --success-soft:      rgba(52, 211, 153, 0.14);
  --warning:           var(--amber-500);
  --warning-soft:      rgba(245, 158, 11, 0.14);
  --danger:            var(--red-500);
  --danger-soft:       rgba(239, 68, 68, 0.14);

  /* Shadows / rings */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, .30);
  --shadow-md: 0 6px 20px -8px rgba(0, 0, 0, .55);
  --shadow-lg: 0 22px 60px -18px rgba(0, 0, 0, .66);
  --ring-brand: 0 0 0 3px var(--brand-soft), 0 0 0 1px var(--brand-line);
}

:root[data-theme="light"] {
  /* Surfaces */
  --surface:           #FFFFFF;
  --surface-raised:    var(--gray-50);
  --surface-raised-2:  var(--gray-100);
  --surface-inset:     var(--gray-100);
  --surface-hover:     var(--gray-100);

  /* Text */
  --text:              #0F172A;
  --text-mut:          var(--gray-600);
  --text-faint:        var(--gray-400);
  --text-on-accent:    #FFFFFF;

  /* Borders */
  --border-soft:       var(--gray-200);
  --border:            var(--gray-300);
  --border-strong:     var(--gray-400);

  /* Brand accent (darker on white for AA contrast) */
  --brand:             var(--emerald-600);
  --brand-hover:       var(--emerald-700);
  --brand-fg:          #FFFFFF;
  --brand-soft:        rgba(5, 150, 105, 0.10);
  --brand-line:        rgba(5, 150, 105, 0.40);

  /* Status (darker for white-bg readability) */
  --success:           var(--emerald-700);
  --success-soft:      rgba(5, 150, 105, 0.10);
  --warning:           var(--amber-600);
  --warning-soft:      rgba(217, 119, 6, 0.10);
  --danger:            var(--red-600);
  --danger-soft:       rgba(220, 38, 38, 0.10);

  /* Shadows lighter on light bg */
  --shadow-sm: 0 1px 2px rgba(15, 23, 42, .06);
  --shadow-md: 0 6px 20px -8px rgba(15, 23, 42, .12);
  --shadow-lg: 0 22px 60px -18px rgba(15, 23, 42, .18);
  --ring-brand: 0 0 0 3px var(--brand-soft), 0 0 0 1px var(--brand-line);
}
```

### Layer 3 — shadcn aliases (compat)

`editor/src/components/ui/*` (dialog, dropdown-menu, tabs, button) uses Tailwind / shadcn token names (`--background`, `--primary`, `--ring`, etc.). Map those onto Layer 2 so we don't need to edit those vendored components.

Naming note: we renamed our brand accent to `--brand` (not `--accent`) specifically to avoid colliding with shadcn's `--accent`, which means "hover/highlight bg" in their convention. Now both names coexist cleanly: `--brand` = primary action, shadcn's `--accent` = subtle hover tint (we map it to `--surface-hover`).

```css
:root {
  --background: var(--surface);
  --foreground: var(--text);
  --card: var(--surface-raised);
  --card-foreground: var(--text);
  --popover: var(--surface-raised);
  --popover-foreground: var(--text);
  --primary: var(--brand);
  --primary-foreground: var(--brand-fg);
  --secondary: var(--surface-raised-2);
  --secondary-foreground: var(--text);
  --muted: var(--surface-raised);
  --muted-foreground: var(--text-mut);
  --accent: var(--surface-hover);       /* shadcn meaning: hover/highlight bg */
  --accent-foreground: var(--text);
  --destructive: var(--danger);
  --destructive-foreground: #FFFFFF;
  --border: var(--border);
  --input: var(--border);
  --ring: var(--brand-line);
}
```

---

## 3. Theme switching mechanism

### Source of truth

```
priority order (initial load):
  1. localStorage["artisan.theme"]    -> "dark" | "light"
  2. authStore.currentUser?.theme     -> from GET /api/auth/me
  3. window.matchMedia("(prefers-color-scheme: dark)").matches
```

The chosen value is written to `document.documentElement.dataset.theme` (becomes `<html data-theme="dark">` or `light`).

### State management

New `editor/src/state/themeStore.ts`:

```ts
type Theme = "dark" | "light";

interface ThemeState {
  theme: Theme;
  setTheme: (next: Theme) => void;
  // syncs to <html data-theme> immediately;
  // fires-and-forgets PATCH /api/auth/me { theme } if logged in
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: detectInitialTheme(),
      setTheme: (next) => {
        document.documentElement.dataset.theme = next;
        set({ theme: next });
        // fire-and-forget user sync (same pattern as editor_language in uiStore)
        if (useAuthStore.getState().currentUser) {
          fetch(`${API_URL}/api/auth/me`, {
            method: "PATCH", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ theme: next }),
          }).catch(() => {});
        }
      },
    }),
    { name: "artisan.theme", partialize: (s) => ({ theme: s.theme }) },
  ),
);

function detectInitialTheme(): Theme {
  const stored = localStorage.getItem("artisan.theme");
  if (stored === "\"dark\"" || stored === "\"light\"") return JSON.parse(stored) as Theme;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
```

### Bootstrapping

In `main.tsx` (BEFORE React mount, to avoid FOUC):

```ts
const initial = useThemeStore.getState().theme;
document.documentElement.dataset.theme = initial;
```

In `authStore.hydrate()` (in `editor/src/state/authStore.ts`): after fetching `/api/auth/me`, if `user.theme` exists AND no localStorage value exists yet, call `useThemeStore.getState().setTheme(user.theme)`. This implements the priority rule "user pref wins over OS pref but loses to explicit localStorage choice".

### UI surface

New `ThemeSwitcher` component, rendered in `/settings` under the existing "Apparence" section (next to `EditorLangSwitcher`).

Binary toggle (Dark / Light only) — no explicit "System" option in the UI. The OS preference acts as the implicit default until the user makes a choice; once they toggle, that choice sticks via localStorage + backend.

```tsx
// editor/src/components/ThemeSwitcher.tsx
// Two-button segmented control: [☾ Dark] [☀ Light]
```

No CSS transition on the swap. `<html data-theme>` flips, surfaces repaint instantly — no `transition: background-color`. This avoids the half-themed flash and keeps the swap honest.

---

## 4. Backend changes

### Schema

```sql
ALTER TABLE users ADD COLUMN theme TEXT;
-- nullable: NULL = no preference, client uses OS/localStorage
```

Drizzle update:

```ts
// backend/src/db/schema.ts (users table)
theme: text("theme"),  // "dark" | "light" | null
```

### Endpoint extension

`PATCH /api/auth/me` already accepts `{ editor_language? }`. Extend body type to:

```ts
{ editor_language?: string | null; theme?: "dark" | "light" | null }
```

Validation: theme must be `"dark"` | `"light"` | `null` (others 422).

`GET /api/auth/me` already returns the user object. Adding `theme` to the SELECT and the response shape is straightforward.

### Tests

- Migration applies cleanly: existing user rows get `theme = NULL`.
- `PATCH /me { theme: "light" }` persists and returns updated value.
- `PATCH /me { theme: "invalid" }` returns 422.
- `GET /me` includes `theme` field.

---

## 5. Migration of existing components (raw → semantic)

### Approach: per-surface batches, not per-file

Roughly the surfaces and their owning files:

1. **Root chrome** — `WorkspaceSidebar`, `WorkspaceTopBarControls`, `__root.tsx`
2. **Setup / auth screens** — `SetupWizard`, `SetupWizardSteps/*`, `LoginForm`, `SignupForm`, `TrustGatePage`
3. **/networks/:id** — route file + `network-detail/*` (ServerCard, kebab, modals)
4. **Workspace canvas chrome** — `FlowCanvas`, `Stage`, `MenuProperties`, `LayersPanel` (NOT the Konva drawing primitives — those stay color-hardcoded for now since they render the Minecraft scene, not UI chrome)
5. **Modals & dialogs** — `Dialog`, `DropdownMenu`, `NewWorkspaceDialog`, `DeletePackDialog`, `Toaster`
6. **History / commits UI** — `HistoryTab`, `TranslationPanel`, `DataSourcesPanel`
7. **Library & assets** — `Library`, `AssetsTab`, item pickers

### Mechanical translation table

| OLD | NEW |
|---|---|
| `var(--bg)`, `var(--bg-deep)` | `var(--surface)` |
| `var(--raised)`, `var(--card-surface)` | `var(--surface-raised)` |
| `var(--raised-2)` | `var(--surface-raised-2)` |
| `var(--inset)` | `var(--surface-inset)` |
| `var(--hover)` | `var(--surface-hover)` |
| `var(--ink)` | `var(--text)` |
| `var(--ink-2)`, `var(--ink-mut)` | `var(--text-mut)` |
| `var(--ink-faint)` | `var(--text-faint)` |
| `var(--line-soft)` | `var(--border-soft)` |
| `var(--line)` | `var(--border)` |
| `var(--line-strong)` | `var(--border-strong)` |
| `var(--terra)`, `var(--terra-deep)` (as primary CTA color) | `var(--brand)` / `var(--brand-hover)` |
| `var(--terra-soft)` | `var(--brand-soft)` |
| `var(--terra-line)` | `var(--brand-line)` |
| `var(--sage)` (as success/online) | `var(--success)` |
| `var(--sage-soft)` | `var(--success-soft)` |
| `var(--gold)` (as warning) | `var(--warning)` |
| `var(--gold-soft)` | `var(--warning-soft)` |
| `var(--brick)` (as destructive) | `var(--danger)` |
| `var(--brick-soft)` | `var(--danger-soft)` |
| `var(--sand)`, `var(--sand-soft)` | DELETE (no semantic equivalent — case-by-case decision: usually maps to `var(--surface-raised-2)` for soft tints, or `var(--text-mut)` for subtle text) |

The sweep can be partially automated with a careful regex script that handles the simple 1:1 cases, leaving `--sand` and ambiguous `--terra` uses (where terra is decorative, not action-coded) for manual review.

### Backward compat during sweep

The old raw tokens stay defined in `globals.css` until the sweep completes — so a half-migrated codebase still renders. Once `grep -rn "var(--terra)" editor/src` returns zero hits, raw tokens get deleted from `globals.css` (they survive in their `--gray-*` / `--emerald-*` form as Layer 1).

---

## 6. Out of scope (V2)

- **Custom themes per user** (beyond dark/light). Possible later via `--accent` override in user settings.
- **High-contrast mode**. WCAG AAA pass would need separate tokens; dark/light pair targets AA only.
- **Konva canvas Minecraft scene colors** (chest backgrounds, slot grids, item glyphs). Those are deliberately not themed — they represent the in-game look and must stay constant in both modes. Only the chrome AROUND the canvas (toolbar, panels, modals) themes.
- **Theme transition animations** (smooth color crossfade on toggle). Adds complexity; opening shot is hard cut.

---

## 7. Testing

### Foundation tests
- `themeStore.test.ts` — initial detection precedence, persistence, `<html data-theme>` mutation, fire-and-forget sync.
- `auth.test.ts` (backend) — extend with theme PATCH cases.
- `ThemeSwitcher.test.tsx` — clicking each option updates store and DOM.

### Sweep tests
Per-surface sweep does NOT need new tests — existing component tests just continue to pass after the token swap. (The token swap doesn't change any behavior, only class names if Tailwind utilities or inline `style={{ color: "var(--ink)" }}`-style swaps.)

### Manual smoke
- Toggle dark ↔ light in `/settings` → all surfaces switch instantly, no FOUC on next load.
- AA contrast pass (eyeball with browser devtools accessibility audit) for text-on-surface and text-on-accent pairs in both modes.
- Verify the green accent doesn't clash with the Minecraft canvas content (which has its own palette).

---

## 8. Phasing

**P1 — Foundation (no visual change)**
Add the new Layer 1 + Layer 2 + shadcn-alias mapping in `globals.css`. Keep all the OLD raw tokens alongside, still mapping to the existing warm palette. The new tokens (`--surface`, `--accent`, etc.) coexist with the old. `<html data-theme>` is set but only "dark" is used initially with the OLD palette translated into the new tokens. Light theme block is also added but no UI toggles to it yet. Backend `users.theme` column added.

**P2 — UI surface for switching**
`useThemeStore`, `ThemeSwitcher` in `/settings`, bootstrap in `main.tsx`, `/api/auth/me` `theme` field, `authStore.hydrate()` integration. After P2, toggling exists and works — but light mode looks ugly because half the surfaces are still using raw tokens that don't redefine across themes.

**P3 — Palette swap**
Change the SEMANTIC token values in `globals.css` to the new neutral + emerald palette. Dark mode is now visually different (cooler / less warm). Light mode is fully usable (because semantic tokens are the only thing that switches per theme). Components still using raw warm tokens look out of place — that's the cue for P4.

**P4 — Sweep**
Migrate raw-token call sites per surface (8 batches per §5). Each batch = one PR/commit, runs full test suite, no regressions. After every batch, both themes look more cohesive.

**P5 — Cleanup**
Once sweep is at zero raw-token usage, delete the raw `--terra`, `--bg`, `--ink` etc. from `globals.css`. Keep `--emerald-*`, `--gray-*`, `--red-*`, `--amber-*` as the source palette (Layer 1).

**P6 — Tune**
Test thoroughly in browser. Adjust hex values in semantic tokens until both modes feel right. This phase touches ONE file: `globals.css`.

---

## 9. Resolved design decisions

1. **shadcn `--accent` collision** — Our brand accent is named `--brand` (not `--accent`). shadcn's `--accent` keeps its native meaning (hover/highlight bg) and maps to `--surface-hover`. See §2.3.
2. **Theme transition CSS** — Hard cut. No `transition: background-color`. See §3 UI surface.
3. **System "auto" mode** — Two-option UI (`[Dark] [Light]`). System pref is the implicit default until the user toggles. See §3 UI surface.
