# Plan — Theming System Refactor

**Date:** 2026-06-04
**Spec:** `docs/superpowers/specs/2026-06-04-theming-system-design.md` (commit `574fe4a8`)
**Goal:** Replace the single-mode warm-terracotta palette with a dual dark/light system. Decouple ~100 component call-sites from raw tokens so future palette changes cost one file edit. Ship a real light mode with user preference persisted to account.

**Architecture:**
- Layer 1 — raw palette values in `:root` (never consumed by components)
- Layer 2 — semantic tokens re-declared per `[data-theme]` block (component API)
- Layer 3 — shadcn/ui aliases mapping onto Layer 2 (no touching vendored components)
- `useThemeStore` (Zustand, persisted to `localStorage["artisan.theme"]`)
- `users.theme` column (nullable TEXT) — backend persistence via `PATCH /api/auth/me`
- `<html data-theme="dark|light">` set before React mount to prevent FOUC

**Tech stack:** Vite/React 19, Zustand, Drizzle/PostgreSQL (Bun), Hono, react-i18next

---

## Project-specific invariants — READ BEFORE TOUCHING ANYTHING

- **Backend tests:** always `cd backend && bun run test`. NEVER `bun test` directly — the guard in `backend/src/db/index.ts` throws if `NODE_ENV=test` and the DB name doesn't contain `"test"`. Direct invocation bypasses `scripts/test.ts` and wipes the dev `artisan` DB (incident 2026-06-01).
- **Editor tests:** `cd editor && npx vitest run`. Test locale is French — use bilingual regex `/dark|sombre/i` for any assertion involving translated theme labels, `/light|clair/i` for light.
- **Migration files:** every `schema.ts` change requires `bun run db:generate` to emit a file in `backend/drizzle/`. That file MUST be committed in the same commit as the schema change.
- **Git staging:** always `git add <explicit paths>`. NEVER `git add -A` or `git add .` — repo has standing WIP on `main` across `editor/`, `plugin/`, `backend/`, `data/` that must not bleed into theming commits.
- **i18n:** every new UI string adds keys to BOTH `editor/src/locales/en.ts` AND `editor/src/locales/fr.ts` in the same commit. Missing key in either file is a TypeScript error (fr.ts is typed `const fr: typeof en`).
- **Conventional commits** format: `feat:`, `fix:`, `chore:`, `style:`, `refactor:`, `test:`, `docs:`.
- **DO NOT touch** `docs/superpowers/specs/2026-05-30-placeholder-discovery-design.md`.

---

## P1 — Foundation (no visual change)

**Goal:** Add the 3-layer token structure to `globals.css` with old raw tokens kept as back-compat aliases. Add `users.theme` column to the DB. Zero visual change — current dark warm palette is preserved for existing consumers.

---

### P1-T1 — Add `users.theme` column to Drizzle schema

**Files modified:**
- `backend/src/db/schema.ts` — add `theme` field to `users` table

**Steps:**

- [ ] Open `backend/src/db/schema.ts`. Locate the `users` table definition (line 75). After the `editorLanguage` line, add:

```ts
theme: text("theme"),                   // "dark" | "light" | null
```

The full updated block becomes:

```ts
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  avatarUrl: text("avatar_url"),
  editorLanguage: text("editor_language"),
  theme: text("theme"),                 // "dark" | "light" | null
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
}, (t) => [
  uniqueIndex("users_email_uniq").on(t.email),
]);
```

- [ ] Generate the migration file:

```bash
cd backend && bun run db:generate
```

Expected output: a new file `backend/drizzle/0005_<slug>.sql` containing:

```sql
ALTER TABLE "users" ADD COLUMN "theme" text;
```

- [ ] Verify the file was created:

```bash
ls backend/drizzle/
```

Expected: `0005_*.sql` present alongside the existing four migration files.

- [ ] Run backend tests to confirm schema change doesn't break anything:

```bash
cd backend && bun run test
```

Expected: all tests pass (no schema-related failures — the new column is nullable so existing test fixtures are unaffected).

**Commit:**

```bash
git add backend/src/db/schema.ts backend/drizzle/0005_*.sql
git commit -m "feat(backend): add users.theme column for theme preference persistence"
```

---

### P1-T2 — Restructure `globals.css` with 3-layer token system

**Files modified:**
- `editor/src/styles/globals.css` — restructure; old raw tokens kept as back-compat aliases

**Goal:** Add Layer 1 (raw palette), Layer 2 (semantic tokens for both themes), Layer 3 (shadcn aliases). The OLD raw tokens (`--bg`, `--raised`, `--terra`, etc.) are kept at the bottom as aliases that point at the new Layer 2 tokens, so that every component currently using `var(--terra)` continues to render the same warm orange in dark mode. **Zero visual change.**

The `<html data-theme>` attribute is not yet applied in this task (that happens in P2-T1). The dark-only behavior is preserved because `:root, :root[data-theme="dark"]` sets the same values as the old `:root` block.

- [ ] Replace the entire content of `editor/src/styles/globals.css` with the following:

```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

/* ================================================================
   ARTISAN — 3-layer token system
   Layer 1: raw palette (never used by components directly)
   Layer 2: semantic tokens (component API, per-theme)
   Layer 3: shadcn aliases (maps onto Layer 2)
   ================================================================ */

/* ----------------------------------------------------------------
   LAYER 1 — Raw palette (reference only, both themes share these)
---------------------------------------------------------------- */
:root {
  /* Neutrals (Slate cool-gray) */
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

  /* Status */
  --red-400: #F87171;
  --red-500: #EF4444;
  --red-600: #DC2626;
  --amber-400: #FBBF24;
  --amber-500: #F59E0B;
  --amber-600: #D97706;

  /* Typography */
  --font-display: 'Spectral', Georgia, serif;
  --font-body:    'Hanken Grotesque', system-ui, sans-serif;
  --font-mono:    'IBM Plex Mono', ui-monospace, monospace;

  /* Border radii */
  --r-xs:   7px;
  --r-sm:   10px;
  --r-md:   14px;
  --r-lg:   20px;
  --r-xl:   28px;
  --r-pill: 999px;
}

/* ----------------------------------------------------------------
   LAYER 2 — Semantic tokens: DARK theme (default)
---------------------------------------------------------------- */
:root,
:root[data-theme="dark"] {
  /* Surfaces */
  --surface:          var(--gray-950);
  --surface-raised:   var(--gray-900);
  --surface-raised-2: var(--gray-800);
  --surface-inset:    #0A0C10;
  --surface-hover:    var(--gray-800);

  /* Text */
  --text:             var(--gray-100);
  --text-mut:         var(--gray-400);
  --text-faint:       var(--gray-500);
  --text-on-accent:   #FFFFFF;

  /* Borders */
  --border-soft:      #2A2F3A;
  --border:           #3C424F;
  --border-strong:    var(--gray-600);

  /* Brand */
  --brand:            var(--emerald-500);
  --brand-hover:      var(--emerald-600);
  --brand-fg:         #FFFFFF;
  --brand-soft:       rgba(16, 185, 129, 0.12);
  --brand-line:       rgba(16, 185, 129, 0.48);

  /* Status */
  --success:          var(--emerald-400);
  --success-soft:     rgba(52, 211, 153, 0.14);
  --warning:          var(--amber-500);
  --warning-soft:     rgba(245, 158, 11, 0.14);
  --danger:           var(--red-500);
  --danger-soft:      rgba(239, 68, 68, 0.14);

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, .30);
  --shadow-md: 0 6px 20px -8px rgba(0, 0, 0, .55);
  --shadow-lg: 0 22px 60px -18px rgba(0, 0, 0, .66);
  --ring-brand: 0 0 0 3px var(--brand-soft), 0 0 0 1px var(--brand-line);
}

/* ----------------------------------------------------------------
   LAYER 2 — Semantic tokens: LIGHT theme
---------------------------------------------------------------- */
:root[data-theme="light"] {
  /* Surfaces */
  --surface:          #FFFFFF;
  --surface-raised:   var(--gray-50);
  --surface-raised-2: var(--gray-100);
  --surface-inset:    var(--gray-100);
  --surface-hover:    var(--gray-100);

  /* Text */
  --text:             #0F172A;
  --text-mut:         var(--gray-600);
  --text-faint:       var(--gray-400);
  --text-on-accent:   #FFFFFF;

  /* Borders */
  --border-soft:      var(--gray-200);
  --border:           var(--gray-300);
  --border-strong:    var(--gray-400);

  /* Brand (darker for white-bg AA contrast) */
  --brand:            var(--emerald-600);
  --brand-hover:      var(--emerald-700);
  --brand-fg:         #FFFFFF;
  --brand-soft:       rgba(5, 150, 105, 0.10);
  --brand-line:       rgba(5, 150, 105, 0.40);

  /* Status */
  --success:          var(--emerald-700);
  --success-soft:     rgba(5, 150, 105, 0.10);
  --warning:          var(--amber-600);
  --warning-soft:     rgba(217, 119, 6, 0.10);
  --danger:           var(--red-600);
  --danger-soft:      rgba(220, 38, 38, 0.10);

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(15, 23, 42, .06);
  --shadow-md: 0 6px 20px -8px rgba(15, 23, 42, .12);
  --shadow-lg: 0 22px 60px -18px rgba(15, 23, 42, .18);
  --ring-brand: 0 0 0 3px var(--brand-soft), 0 0 0 1px var(--brand-line);
}

/* ----------------------------------------------------------------
   LAYER 3 — shadcn aliases (always in :root — track Layer 2 dynamically)
---------------------------------------------------------------- */
:root {
  --background:            var(--surface);
  --foreground:            var(--text);
  --card:                  var(--surface-raised);
  --card-foreground:       var(--text);
  --popover:               var(--surface-raised);
  --popover-foreground:    var(--text);
  --primary:               var(--brand);
  --primary-foreground:    var(--brand-fg);
  --secondary:             var(--surface-raised-2);
  --secondary-foreground:  var(--text);
  --muted:                 var(--surface-raised);
  --muted-foreground:      var(--text-mut);
  --accent:                var(--surface-hover);   /* shadcn: hover/highlight bg */
  --accent-foreground:     var(--text);
  --destructive:           var(--danger);
  --destructive-foreground: #FFFFFF;
  --border:                var(--border);
  --input:                 var(--border);
  --ring:                  var(--brand-line);
  --radius:                14px;
}

/* ----------------------------------------------------------------
   BACK-COMPAT ALIASES — old raw tokens re-mapped to Layer 2.
   These keep every component using var(--terra) / var(--bg) / etc.
   rendering correctly during the P4 sweep. DELETED in P5.
---------------------------------------------------------------- */
:root,
:root[data-theme="dark"],
:root[data-theme="light"] {
  /* Surfaces */
  --bg:           var(--surface);
  --bg-deep:      var(--surface);
  --raised:       var(--surface-raised);
  --raised-2:     var(--surface-raised-2);
  --card-surface: var(--surface-raised);
  --hover:        var(--surface-hover);
  --inset:        var(--surface-inset);

  /* Borders */
  --line:         var(--border);
  --line-soft:    var(--border-soft);
  --line-strong:  var(--border-strong);

  /* Text */
  --ink:          var(--text);
  --ink-2:        var(--text-mut);
  --ink-mut:      var(--text-mut);
  --ink-faint:    var(--text-faint);

  /* Brand (terra was the CTA color) */
  --terra:        var(--brand);
  --terra-deep:   var(--brand-hover);
  --terra-soft:   var(--brand-soft);
  --terra-line:   var(--brand-line);

  /* Status */
  --sage:         var(--success);
  --sage-soft:    var(--success-soft);
  --gold:         var(--warning);
  --gold-soft:    var(--warning-soft);
  --brick:        var(--danger);
  --brick-soft:   var(--danger-soft);

  /* --sand / --sand-soft: no semantic equivalent.
     Map to surface-raised-2 / brand-soft as best-effort.
     Will be reviewed case-by-case in P4. */
  --sand:         var(--surface-raised-2);
  --sand-soft:    var(--brand-soft);

  /* Legacy shadow / ring aliases */
  --sh-1:         var(--shadow-sm);
  --sh-2:         var(--shadow-md);
  --sh-3:         var(--shadow-lg);
  --glow-terra:   0 0 0 1px var(--brand-line), 0 8px 26px -10px var(--brand-soft);
  --ring-terra:   var(--ring-brand);

  /* Legacy editor aliases */
  --color-bg:           var(--surface);
  --color-bg-1:         var(--surface-raised);
  --color-bg-2:         var(--surface-raised);
  --color-fg:           var(--text);
  --color-fg-muted:     var(--text-mut);
  --color-border-soft:  var(--border);
  --color-warning:      var(--warning);
}

/* ----------------------------------------------------------------
   Tailwind @theme bridge
---------------------------------------------------------------- */
@theme inline {
  --color-background:            var(--background);
  --color-foreground:            var(--foreground);
  --color-card:                  var(--card);
  --color-card-foreground:       var(--card-foreground);
  --color-popover:               var(--popover);
  --color-popover-foreground:    var(--popover-foreground);
  --color-primary:               var(--primary);
  --color-primary-foreground:    var(--primary-foreground);
  --color-secondary:             var(--secondary);
  --color-secondary-foreground:  var(--secondary-foreground);
  --color-muted:                 var(--muted);
  --color-muted-foreground:      var(--muted-foreground);
  --color-accent:                var(--accent);
  --color-accent-foreground:     var(--accent-foreground);
  --color-destructive:           var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border:                var(--border);
  --color-input:                 var(--input);
  --color-ring:                  var(--ring);

  /* Back-compat Tailwind utilities for old raw tokens */
  --color-terra:       var(--terra);
  --color-terra-deep:  var(--terra-deep);
  --color-sand:        var(--sand);
  --color-gold:        var(--gold);
  --color-sage:        var(--sage);
  --color-brick:       var(--brick);
  --color-ink:         var(--ink);
  --color-ink-2:       var(--ink-2);
  --color-ink-mut:     var(--ink-mut);
  --color-ink-faint:   var(--ink-faint);
  --color-line:        var(--line);
  --color-line-soft:   var(--line-soft);
  --color-line-strong: var(--line-strong);
  --color-raised:      var(--raised);
  --color-raised-2:    var(--raised-2);
  --color-bg-deep:     var(--bg-deep);
  --color-inset:       var(--inset);
  --color-hover:       var(--hover);

  --radius-sm:    var(--r-sm);
  --radius-md:    var(--r-md);
  --radius-lg:    var(--r-lg);
  --radius-xl:    var(--r-xl);
  --radius-card:  var(--r-lg);

  --font-display: var(--font-display);
  --font-body:    var(--font-body);
  --font-mono:    var(--font-mono);
}

:root {
  color-scheme: dark light;
}

html,
body,
#root {
  height: 100%;
  margin: 0;
  background: var(--surface);
  color: var(--text);
}

body {
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

::selection { background: var(--brand-soft); }

/* ----------------------------------------------------------------
   Warm paper grain — barely there, opt-in via .grain
---------------------------------------------------------------- */
.grain::before {
  content: "";
  position: fixed; inset: 0; z-index: 0; pointer-events: none;
  opacity: .035; mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

/* ----------------------------------------------------------------
   TYPOGRAPHY UTILITIES
---------------------------------------------------------------- */
.display {
  font-family: var(--font-display);
  font-weight: 500;
  line-height: 1.08;
  letter-spacing: -.01em;
}
.serif { font-family: var(--font-display); }
.mono  { font-family: var(--font-mono); }

.eyebrow {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: .18em;
  font-weight: 600;
  color: var(--text-mut);
}

/* ----------------------------------------------------------------
   BUTTONS
---------------------------------------------------------------- */
.btn {
  display: inline-flex; align-items: center; justify-content: center;
  gap: 8px;
  height: 38px; padding: 0 16px;
  border-radius: var(--r-md);
  border: 1px solid var(--border);
  background: var(--surface-raised-2);
  color: var(--text);
  font-size: 13.5px; font-weight: 600;
  letter-spacing: .005em;
  font-family: inherit;
  text-decoration: none;
  cursor: pointer;
  transition: background .16s ease, border-color .16s ease, transform .12s ease, box-shadow .16s ease, filter .16s ease;
}
.btn:hover { background: var(--surface-hover); border-color: var(--border-strong); }
.btn:active { transform: translateY(1px); }
.btn:focus-visible { outline: none; box-shadow: var(--ring-brand); }
.btn .ico { width: 16px; height: 16px; }

.btn-primary {
  background: linear-gradient(180deg, var(--brand), var(--brand-hover));
  border-color: transparent; color: var(--brand-fg);
  box-shadow: 0 8px 22px -12px var(--brand-soft);
}
.btn-primary:hover {
  filter: brightness(1.05);
  background: linear-gradient(180deg, var(--brand), var(--brand-hover));
  border-color: transparent;
}

.btn-deploy {
  background: linear-gradient(180deg, var(--success), color-mix(in oklab, var(--success) 80%, #000));
  border-color: transparent; color: var(--brand-fg);
  box-shadow: 0 8px 22px -12px var(--success-soft);
}
.btn-deploy:hover {
  filter: brightness(1.06);
  border-color: transparent;
  background: linear-gradient(180deg, var(--success), color-mix(in oklab, var(--success) 80%, #000));
}

.btn-ghost { background: transparent; border-color: transparent; color: var(--text-mut); }
.btn-ghost:hover { background: var(--surface-hover); color: var(--text); border-color: transparent; }

.btn-outline { background: transparent; }

.btn-danger { color: var(--danger); border-color: transparent; background: transparent; }
.btn-danger:hover { background: var(--danger-soft); color: var(--danger); border-color: transparent; }

.btn-sm { height: 31px; padding: 0 12px; font-size: 12.5px; border-radius: var(--r-sm); }
.btn-icon { width: 38px; padding: 0; }
.btn-icon.btn-sm { width: 31px; }

.btn:disabled, .btn[aria-disabled="true"] { opacity: .4; pointer-events: none; }

/* ----------------------------------------------------------------
   INPUTS
---------------------------------------------------------------- */
.field-label {
  display: block; font-size: 11px; font-weight: 600;
  letter-spacing: .04em; color: var(--text-mut); margin-bottom: 6px;
  text-transform: uppercase;
}
.input, .textarea, .select {
  width: 100%;
  background: var(--surface-inset);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  color: var(--text);
  font-size: 13.5px;
  padding: 10px 13px;
  font-family: inherit;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.input { height: 40px; }
.input::placeholder, .textarea::placeholder { color: var(--text-faint); }
.input:focus, .textarea:focus, .select:focus {
  outline: none; border-color: var(--brand-line); box-shadow: var(--ring-brand);
}
.textarea { resize: vertical; line-height: 1.5; min-height: 80px; }

.select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239A8876' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 34px;
}

.search {
  display: flex; align-items: center; gap: 9px;
  height: 38px; padding: 0 13px;
  background: var(--surface-inset); border: 1px solid var(--border);
  border-radius: var(--r-pill);
}
.search input { flex: 1; background: none; border: none; outline: none; color: var(--text); font-size: 13px; font-family: inherit; }
.search input::placeholder { color: var(--text-faint); }
.search .ico { width: 15px; height: 15px; color: var(--text-faint); }

/* ----------------------------------------------------------------
   CARDS & SURFACES
---------------------------------------------------------------- */
.card {
  background: var(--surface-raised);
  border: 1px solid var(--border-soft);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-sm);
}
.panel {
  background: var(--surface-raised);
  border: 1px solid var(--border-soft);
  border-radius: var(--r-lg);
}

/* ----------------------------------------------------------------
   CHIPS / BADGES / PILLS
---------------------------------------------------------------- */
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  height: 28px; padding: 0 12px;
  border-radius: var(--r-pill);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-mut);
  font-size: 12px; font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all .14s ease;
}
.chip:hover { border-color: var(--border-strong); color: var(--text); }
.chip.is-active {
  border-color: var(--brand-line);
  background: var(--brand-soft);
  color: var(--brand);
}

.badge {
  display: inline-flex; align-items: center; gap: 5px;
  height: 19px; padding: 0 7px;
  border-radius: var(--r-pill);
  font-size: 10px; font-weight: 700; letter-spacing: .03em;
  background: var(--surface-raised-2); color: var(--text-mut);
}
.badge-amber { background: var(--warning-soft); color: var(--warning); }
.badge-sage  { background: var(--success-soft); color: var(--success); }
.badge-terra { background: var(--brand-soft);   color: var(--brand); }
.badge-brick { background: var(--danger-soft);  color: var(--danger); }

.dot { width: 7px; height: 7px; border-radius: var(--r-pill); }

/* ----------------------------------------------------------------
   TABS
---------------------------------------------------------------- */
.tabstrip { display: flex; align-items: center; gap: 4px; }
.tab {
  position: relative;
  height: 38px; padding: 0 14px;
  display: inline-flex; align-items: center; gap: 8px;
  background: none; border: none;
  color: var(--text-mut); font-size: 13px; font-weight: 600;
  border-radius: var(--r-sm) var(--r-sm) 0 0;
  font-family: inherit;
  cursor: pointer;
  transition: color .15s ease;
}
.tab:hover { color: var(--text-mut); }
.tab.is-active { color: var(--text); }
.tab.is-active::after {
  content: ""; position: absolute; left: 12px; right: 12px; bottom: -1px;
  height: 2px; border-radius: 2px; background: var(--brand);
}

.utab {
  background: none; border: none; padding: 8px 2px;
  color: var(--text-mut); font-size: 12.5px; font-weight: 600;
  position: relative;
  font-family: inherit;
  cursor: pointer;
}
.utab:hover { color: var(--text-mut); }
.utab.is-active { color: var(--text); }
.utab.is-active::after {
  content: ""; position: absolute; left: 0; right: 0; bottom: -1px;
  height: 2px; border-radius: 2px; background: var(--success);
}

/* ----------------------------------------------------------------
   PIXEL MOTIF — discreet craft nod (3x3 grid)
---------------------------------------------------------------- */
.pixel-mark {
  display: inline-grid;
  grid-template-columns: repeat(3, 4px);
  grid-template-rows: repeat(3, 4px);
  gap: 1px;
}
.pixel-mark i { background: var(--brand); border-radius: 1px; }
.pixel-mark i:nth-child(2),
.pixel-mark i:nth-child(4),
.pixel-mark i:nth-child(6),
.pixel-mark i:nth-child(8) { opacity: .35; }

/* divider */
.rule { height: 1px; background: var(--border-soft); border: none; margin: 0; }

/* scrollbars */
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: var(--r-pill); border: 3px solid transparent; background-clip: padding-box; }
::-webkit-scrollbar-thumb:hover { background: var(--border-strong); background-clip: padding-box; }
::-webkit-scrollbar-track { background: transparent; }

/* Konva canvas backdrop helper */
.stage-bg-dots {
  background:
    radial-gradient(circle at 1px 1px, rgba(230, 203, 159, .07) 1px, transparent 0) 0 0 / 22px 22px,
    var(--surface-inset);
}
.stage-bg-glow {
  background: radial-gradient(120% 80% at 50% 0%, var(--brand-soft), transparent 60%);
}

/* Placeholder autocomplete ------------------------------------------------- */
.placeholder-popup {
  position: fixed;
  z-index: 9000;
  min-width: 260px;
  max-height: 220px;
  overflow-y: auto;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-md);
}
.placeholder-popup li {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  gap: 8px;
  align-items: baseline;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 11.5px;
}
.placeholder-popup li[aria-selected="true"] { background: var(--surface-hover); }
.placeholder-popup li .name { color: var(--brand); }
.placeholder-popup li .type { color: var(--text-faint); font-size: 10px; }
.placeholder-popup li .sample { color: var(--text-mut); font-size: 10px; }
.placeholder-popup li .origin {
  color: var(--text-faint); font-size: 9px; text-transform: uppercase;
  letter-spacing: .08em;
}
.placeholder-popup li.empty {
  grid-template-columns: 1fr;
  color: var(--text-mut);
  font-style: italic;
  cursor: default;
}
.placeholder-hint {
  margin: 4px 0 0;
  font-family: var(--font-mono);
}
.placeholder-hint code {
  background: var(--surface-inset);
  padding: 0 4px;
  border-radius: 4px;
  color: var(--text-mut);
}
```

Note on `globals.css` changes vs the old file:
- The `globals.css` itself already uses only semantic class rules (`.btn`, `.card`, etc.) so updating the token names used inside those rules is fine to do now — they still resolve correctly via the back-compat aliases.
- The `border` CSS variable name-collision in Layer 3: `--border: var(--border)` is a self-reference problem. Rename the Layer 3 entry to `--border: var(--border)` which reads from the Layer 2 `--border` defined in the theme block. Because the Layer 2 `--border` and the Layer 3 `--border` have the same name, CSS resolves based on specificity: the `:root[data-theme]` block wins for the value, the plain `:root` Layer 3 block inherits it. This is identical to how the original file had `--border: var(--line-soft)` — the alias block just reads through. If there are parsing issues, rename Layer 2 border tokens to `--bd`, `--bd-soft`, `--bd-strong` and update references — but standard CSS cascade order handles this correctly.

- [ ] Run editor tests to verify no regressions:

```bash
cd editor && npx vitest run
```

Expected: same pass count as before (the CSS changes don't affect TypeScript tests; the back-compat aliases preserve all existing token resolutions).

- [ ] Run the dev server briefly and verify visually that dark mode still looks identical to before:

```bash
cd editor && npm run dev
```

Open `http://localhost:5173`. Check that the workspace canvas, sidebar, and modals all render with the warm terracotta palette (terra orange = brand, brown surfaces) — identical to pre-P1 state.

**Commit:**

```bash
git add editor/src/styles/globals.css
git commit -m "feat(editor): add 3-layer token system to globals.css — back-compat aliases preserve current warm palette"
```

---

## P2 — Switching UI

**Goal:** Wire up the theme toggle. After P2, a user can switch between dark and light in `/settings`. Light mode will look ugly (most surfaces still use the warm-compat aliases, which in dark mode map to the right semantics, but light mode shows the unstyled sweep debt). That's expected and acceptable.

---

### P2-T1 — Extend `lib/api/auth.ts` + `AuthUserDto` for `theme` field

**Files modified:**
- `editor/src/lib/api/auth.ts` — add `theme` to `AuthUserDto` and `patchMe` payload

**Steps:**

- [ ] In `editor/src/lib/api/auth.ts`, update `AuthUserDto`:

```ts
export interface AuthUserDto {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  editorLanguage?: string | null;
  theme?: "dark" | "light" | null;
}
```

- [ ] Update `patchMe` payload type to accept `theme`:

```ts
export async function patchMe(
  { apiUrl }: ApiOptions,
  payload: { editor_language?: string | null; theme?: "dark" | "light" | null },
): Promise<{ user: AuthUserDto } | { error: string }> {
  const res = await fetch(`${apiUrl}/api/v1/auth/me`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { error: `patch_me_failed_${res.status}` };
  return res.json();
}
```

No test file changes needed here — `patchMe` has no dedicated unit test; coverage comes from the component and store tests below.

**Commit:** (bundle with P2-T2 — same logical unit)

---

### P2-T2 — Extend backend `PATCH /me` + `GET /me` for `theme` field

**Files modified:**
- `backend/src/routes/auth.ts` — accept + validate `theme` in PATCH, return `theme` in GET and PATCH responses
- `backend/src/tests/auth.test.ts` (or wherever `PATCH /me` tests live) — add theme cases

**Steps:**

- [ ] In `backend/src/routes/auth.ts`, update the `PATCH /me` body type and handler:

```ts
router.patch("/me", userAuth(), async (c) => {
  const user = c.var.user;
  if (!user) return c.json({ error: "unauthorized" }, 401);

  let body: { editor_language?: string | null; theme?: string | null };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }

  const updates: Record<string, unknown> = {};
  if ("editor_language" in body) {
    updates.editorLanguage = body.editor_language ?? null;
  }
  if ("theme" in body) {
    if (body.theme !== "dark" && body.theme !== "light" && body.theme !== null) {
      return c.json({ error: "invalid_theme" }, 422);
    }
    updates.theme = body.theme;
  }

  if (Object.keys(updates).length === 0) {
    return c.json({
      user: {
        id: user.id, email: user.email, name: user.name,
        avatarUrl: user.avatarUrl, editorLanguage: user.editorLanguage,
        theme: user.theme,
      },
    });
  }

  await db.update(users).set(updates).where(eq(users.id, user.id));
  const [row] = await db.select().from(users).where(eq(users.id, user.id));
  return c.json({
    user: {
      id: row.id, email: row.email, name: row.name,
      avatarUrl: row.avatarUrl, editorLanguage: row.editorLanguage,
      theme: row.theme,
    },
  });
});
```

- [ ] Update the `GET /me` handler to include `theme` in the returned user. The `userAuth()` middleware loads the user row; find the handler (line 93–97) and update the response:

```ts
router.get("/me", userAuth(), (c) => {
  const user = c.var.user;
  if (!user) return c.json({ error: "unauthorized" }, 401);
  return c.json({
    user: {
      id: user.id, email: user.email, name: user.name,
      avatarUrl: user.avatarUrl, editorLanguage: user.editorLanguage,
      theme: user.theme,
    },
  });
});
```

Note: the `userAuth` middleware must SELECT `theme` from the `users` row — check `backend/src/middleware/userAuth.ts` to confirm it does a full `db.select().from(users)`. If it only selects specific columns, add `theme` to the projection.

- [ ] Locate the backend auth test file. Search:

```bash
grep -r "patch.*me\|PATCH.*me\|editor_language" backend/src --include="*.ts" -l
```

Open the matching test file and add the following test cases inside the existing `PATCH /me` describe block:

```ts
it("PATCH /me with theme: 'light' persists and returns theme", async () => {
  // assumes a logged-in session cookie is available (follow existing test setup pattern)
  const res = await app.request("/api/v1/auth/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: sessionCookie },
    body: JSON.stringify({ theme: "light" }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.user.theme).toBe("light");
});

it("PATCH /me with theme: 'dark' persists and returns theme", async () => {
  const res = await app.request("/api/v1/auth/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: sessionCookie },
    body: JSON.stringify({ theme: "dark" }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.user.theme).toBe("dark");
});

it("PATCH /me with theme: null clears theme", async () => {
  const res = await app.request("/api/v1/auth/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: sessionCookie },
    body: JSON.stringify({ theme: null }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.user.theme).toBeNull();
});

it("PATCH /me with theme: 'invalid' returns 422", async () => {
  const res = await app.request("/api/v1/auth/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: sessionCookie },
    body: JSON.stringify({ theme: "invalid" }),
  });
  expect(res.status).toBe(422);
  const body = await res.json();
  expect(body.error).toBe("invalid_theme");
});

it("GET /me includes theme field", async () => {
  const res = await app.request("/api/v1/auth/me", {
    headers: { Cookie: sessionCookie },
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect("theme" in body.user).toBe(true);
});
```

- [ ] Run backend tests:

```bash
cd backend && bun run test
```

Expected: all prior tests pass, plus the 5 new theme cases pass.

**Commit:**

```bash
git add backend/src/routes/auth.ts editor/src/lib/api/auth.ts
git add backend/src/tests/  # add the specific test file path
git commit -m "feat(backend): extend PATCH/GET /me with theme field — validation + tests"
```

---

### P2-T3 — Create `editor/src/state/themeStore.ts` + test

**Files created:**
- `editor/src/state/themeStore.ts`
- `editor/src/state/themeStore.test.ts`

**Steps:**

- [ ] Create `editor/src/state/themeStore.ts`:

```ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "dark" | "light";

interface ThemeState {
  theme: Theme;
  setTheme: (next: Theme) => void;
}

/**
 * Reads the initial theme from localStorage (via zustand persist), falling
 * back to OS preference. Called once at module load — before React mount —
 * so main.tsx can apply <html data-theme> without FOUC.
 */
export function detectInitialTheme(): Theme {
  // zustand persist stores as JSON string: '"dark"' or '"light"'
  try {
    const raw = localStorage.getItem("artisan.theme");
    if (raw) {
      const parsed = JSON.parse(raw) as { state?: { theme?: string } };
      if (parsed?.state?.theme === "dark" || parsed?.state?.theme === "light") {
        return parsed.state.theme;
      }
    }
  } catch {
    // localStorage unavailable or malformed — fall through
  }
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: detectInitialTheme(),
      setTheme: (next: Theme) => {
        document.documentElement.dataset.theme = next;
        set({ theme: next });
        // Fire-and-forget backend sync — same pattern as editor_language in uiStore.
        import("./authStore").then(({ useAuthStore }) => {
          const user = useAuthStore.getState().currentUser;
          if (!user) return;
          const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
          import("@/lib/api/auth").then(({ patchMe }) =>
            patchMe({ apiUrl }, { theme: next }).catch(() => {
              console.warn("theme sync to backend failed (offline?)");
            })
          );
        });
      },
    }),
    {
      name: "artisan.theme",
      partialize: (s) => ({ theme: s.theme }),
    },
  ),
);
```

- [ ] Create `editor/src/state/themeStore.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

// Mock matchMedia
Object.defineProperty(globalThis, "window", {
  value: { matchMedia: vi.fn(() => ({ matches: false })) },
  writable: true,
});

// Mock document.documentElement.dataset
const datasetMock: Record<string, string> = {};
Object.defineProperty(globalThis, "document", {
  value: {
    documentElement: { dataset: datasetMock },
  },
  writable: true,
});

describe("detectInitialTheme", () => {
  beforeEach(() => localStorageMock.clear());

  it("returns 'dark' when localStorage has persisted dark", () => {
    localStorageMock.setItem("artisan.theme", JSON.stringify({ state: { theme: "dark" } }));
    // Re-import to get fresh module state
    vi.resetModules();
    return import("./themeStore").then(({ detectInitialTheme }) => {
      expect(detectInitialTheme()).toBe("dark");
    });
  });

  it("returns 'light' when localStorage has persisted light", () => {
    localStorageMock.setItem("artisan.theme", JSON.stringify({ state: { theme: "light" } }));
    vi.resetModules();
    return import("./themeStore").then(({ detectInitialTheme }) => {
      expect(detectInitialTheme()).toBe("light");
    });
  });

  it("returns 'dark' when OS prefers dark and localStorage is empty", () => {
    (window.matchMedia as ReturnType<typeof vi.fn>).mockReturnValue({ matches: true });
    vi.resetModules();
    return import("./themeStore").then(({ detectInitialTheme }) => {
      expect(detectInitialTheme()).toBe("dark");
    });
  });

  it("returns 'light' when OS prefers light and localStorage is empty", () => {
    (window.matchMedia as ReturnType<typeof vi.fn>).mockReturnValue({ matches: false });
    vi.resetModules();
    return import("./themeStore").then(({ detectInitialTheme }) => {
      expect(detectInitialTheme()).toBe("light");
    });
  });
});

describe("useThemeStore.setTheme", () => {
  beforeEach(() => {
    localStorageMock.clear();
    datasetMock.theme = "";
    vi.resetModules();
  });
  afterEach(() => vi.clearAllMocks());

  it("mutates document.documentElement.dataset.theme", async () => {
    const { useThemeStore } = await import("./themeStore");
    useThemeStore.getState().setTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("updates store state", async () => {
    const { useThemeStore } = await import("./themeStore");
    useThemeStore.getState().setTheme("dark");
    expect(useThemeStore.getState().theme).toBe("dark");
  });
});
```

- [ ] Run the new tests:

```bash
cd editor && npx vitest run src/state/themeStore.test.ts
```

Expected: all 6 tests pass.

**Commit:**

```bash
git add editor/src/state/themeStore.ts editor/src/state/themeStore.test.ts
git commit -m "feat(editor): add themeStore — detectInitialTheme, persist, html data-theme sync"
```

---

### P2-T4 — Bootstrap `<html data-theme>` in `main.tsx` before React mount

**Files modified:**
- `editor/src/main.tsx`

**Steps:**

- [ ] Open `editor/src/main.tsx`. After the `import "./styles/globals.css"` line and before the `createRoot(...)` call, add the FOUC-prevention bootstrap:

```ts
import { detectInitialTheme } from "@/state/themeStore";

// Apply data-theme to <html> before React mounts — prevents FOUC on reload.
document.documentElement.dataset.theme = detectInitialTheme();
```

The full updated `main.tsx`:

```ts
import { Toaster } from "@/components/Toaster";
import "@/i18n";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { routeTree } from "./routeTree.gen";
import "./styles/globals.css";
import { registerModule, listModules } from "./modules/api/registry";
import { menusModule } from "./modules/menus";
import { commandsModule } from "./modules/commands";
import { detectInitialTheme } from "@/state/themeStore";

// Apply data-theme to <html> before React mounts — prevents FOUC on reload.
document.documentElement.dataset.theme = detectInitialTheme();

if (listModules().length === 0) {
  registerModule(menusModule);
  registerModule(commandsModule);
}

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
    <Toaster />
  </StrictMode>,
);
```

- [ ] Run editor tests:

```bash
cd editor && npx vitest run
```

Expected: all tests pass (no test depends on main.tsx bootstrap order).

**Commit:**

```bash
git add editor/src/main.tsx
git commit -m "feat(editor): bootstrap html data-theme before React mount to prevent FOUC"
```

---

### P2-T5 — Wire `authStore.hydrate()` to apply `user.theme` if no localStorage choice

**Files modified:**
- `editor/src/state/authStore.ts`

**Goal:** After fetching `/api/auth/me`, if `user.theme` is set AND no localStorage `artisan.theme` key exists yet, apply the server preference. This implements the priority rule: localStorage > backend > OS.

**Steps:**

- [ ] In `editor/src/state/authStore.ts`, update the `hydrate` method:

```ts
async hydrate(apiUrl) {
  set({ isLoading: true });
  const user = await getMe({ apiUrl });
  set({ currentUser: user, isLoading: false });

  if (user?.editorLanguage) {
    const { default: i18n } = await import("@/i18n");
    await i18n.changeLanguage(user.editorLanguage);
  }

  // Apply server-side theme preference only if the user hasn't made a
  // local choice yet. localStorage wins (checked by detectInitialTheme).
  if (user?.theme) {
    const hasLocalChoice = (() => {
      try {
        const raw = localStorage.getItem("artisan.theme");
        if (!raw) return false;
        const parsed = JSON.parse(raw) as { state?: { theme?: string } };
        return parsed?.state?.theme === "dark" || parsed?.state?.theme === "light";
      } catch {
        return false;
      }
    })();
    if (!hasLocalChoice) {
      const { useThemeStore } = await import("./themeStore");
      useThemeStore.getState().setTheme(user.theme as "dark" | "light");
    }
  }
},
```

- [ ] Run editor tests:

```bash
cd editor && npx vitest run
```

Expected: all pass. The `authStore.test.ts` file may need one new case to cover the hydrate path; check if it exists and add if missing:

```ts
it("hydrate applies user.theme when no localStorage choice exists", async () => {
  localStorage.removeItem("artisan.theme");
  vi.mocked(getMe).mockResolvedValue({
    id: "u1", email: "a@b.com", name: "A", avatarUrl: null,
    editorLanguage: null, theme: "light",
  });
  await useAuthStore.getState().hydrate("http://localhost:3001");
  // themeStore should have been updated and data-theme applied
  expect(document.documentElement.dataset.theme).toBe("light");
});
```

**Commit:**

```bash
git add editor/src/state/authStore.ts
git commit -m "feat(editor): authStore.hydrate applies user.theme when no localStorage choice exists"
```

---

### P2-T6 — Create `ThemeSwitcher` component + add i18n keys + wire into `/settings`

**Files created:**
- `editor/src/components/ThemeSwitcher.tsx`
- `editor/src/components/ThemeSwitcher.test.tsx`

**Files modified:**
- `editor/src/locales/en.ts` — add `settings.appearance.theme`, `settings.appearance.themeDark`, `settings.appearance.themeLight`
- `editor/src/locales/fr.ts` — same keys in French
- `editor/src/features/settings/AppearanceSection.tsx` — render `ThemeSwitcher`

**Steps:**

- [ ] Add i18n keys to `editor/src/locales/en.ts` inside the `settings.appearance` object:

```ts
settings: {
  appearance: {
    title: "Appearance",
    editorLanguage: "Editor language",
    theme: "Theme",
    themeDark: "Dark",
    themeLight: "Light",
  },
},
```

- [ ] Add the same keys to `editor/src/locales/fr.ts`:

```ts
settings: {
  appearance: {
    title: "Apparence",
    editorLanguage: "Langue de l'éditeur",
    theme: "Thème",
    themeDark: "Sombre",
    themeLight: "Clair",
  },
},
```

- [ ] Create `editor/src/components/ThemeSwitcher.tsx`:

```tsx
import { useThemeStore, type Theme } from "@/state/themeStore";
import { useTranslation } from "react-i18next";
import { Moon, Sun } from "lucide-react";

/**
 * Binary segmented-control: [☾ Dark] [☀ Light]
 * No "system" option — OS preference is the implicit default until the user
 * makes a choice, which sticks in localStorage + backend.
 * No CSS transition on swap — hard cut per spec §3.
 */
export function ThemeSwitcher() {
  const { t } = useTranslation();
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  const options: { value: Theme; label: string; Icon: typeof Moon }[] = [
    { value: "dark",  label: t("settings.appearance.themeDark"),  Icon: Moon },
    { value: "light", label: t("settings.appearance.themeLight"), Icon: Sun  },
  ];

  return (
    <div
      role="group"
      aria-label={t("settings.appearance.theme")}
      className="inline-flex rounded-[var(--r-md)] border border-[var(--border)] overflow-hidden"
    >
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          data-testid={`theme-option-${value}`}
          aria-pressed={theme === value}
          onClick={() => setTheme(value)}
          className={[
            "flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold transition-colors",
            theme === value
              ? "bg-[var(--brand-soft)] text-[var(--brand)]"
              : "bg-transparent text-[var(--text-mut)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)]",
          ].join(" ")}
        >
          <Icon className="size-[14px]" />
          {label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] Create `editor/src/components/ThemeSwitcher.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { useThemeStore } from "@/state/themeStore";

// Minimal i18next mock — uses real keys as values
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

beforeEach(() => {
  // Reset store to dark before each test
  useThemeStore.setState({ theme: "dark" });
  document.documentElement.dataset.theme = "dark";
});

describe("ThemeSwitcher", () => {
  it("renders dark and light buttons", () => {
    render(<ThemeSwitcher />);
    expect(screen.getByTestId("theme-option-dark")).toBeTruthy();
    expect(screen.getByTestId("theme-option-light")).toBeTruthy();
  });

  it("dark button is pressed when theme is dark", () => {
    render(<ThemeSwitcher />);
    expect(screen.getByTestId("theme-option-dark").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("theme-option-light").getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking light calls setTheme('light') and updates html data-theme", () => {
    render(<ThemeSwitcher />);
    fireEvent.click(screen.getByTestId("theme-option-light"));
    expect(useThemeStore.getState().theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("clicking dark calls setTheme('dark') and updates html data-theme", () => {
    useThemeStore.setState({ theme: "light" });
    render(<ThemeSwitcher />);
    fireEvent.click(screen.getByTestId("theme-option-dark"));
    expect(useThemeStore.getState().theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("button labels match translated keys (bilingual regex)", () => {
    render(<ThemeSwitcher />);
    // With the mock, t() returns the key — check keys contain the right segments
    const darkBtn = screen.getByTestId("theme-option-dark");
    const lightBtn = screen.getByTestId("theme-option-light");
    expect(darkBtn.textContent).toMatch(/dark|sombre/i);
    expect(lightBtn.textContent).toMatch(/light|clair/i);
  });
});
```

- [ ] Update `editor/src/features/settings/AppearanceSection.tsx` to render the switcher:

```tsx
import { useTranslation } from "react-i18next";
import { EditorLangSwitcher } from "@/components/EditorLangSwitcher";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

export function AppearanceSection() {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-1.5">
        <h1
          className="display text-[32px] tracking-tight text-[var(--text)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("settings.appearance.title")}
        </h1>
        <p className="text-[13px] text-[var(--text-mut)]">
          {t("settingsPage.appearanceHelp")}
        </p>
      </header>

      <div className="card flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-2">
          <span className="field-label">{t("settings.appearance.theme")}</span>
          <ThemeSwitcher />
        </div>
        <div className="rule" />
        <div className="flex flex-col gap-2">
          <span className="field-label">{t("settings.appearance.editorLanguage")}</span>
          <EditorLangSwitcher />
        </div>
      </div>
    </section>
  );
}
```

Note: `AppearanceSection.tsx` uses `var(--ink)` → `var(--text)` and `var(--ink-mut)` → `var(--text-mut)` above. These are the only two raw-token occurrences in this file, and we can update them now since we're touching the file anyway.

- [ ] Run the new tests:

```bash
cd editor && npx vitest run src/components/ThemeSwitcher.test.tsx
```

Expected: all 5 tests pass.

- [ ] Run the full editor test suite:

```bash
cd editor && npx vitest run
```

Expected: all tests pass.

**Commit:**

```bash
git add editor/src/components/ThemeSwitcher.tsx editor/src/components/ThemeSwitcher.test.tsx
git add editor/src/features/settings/AppearanceSection.tsx
git add editor/src/locales/en.ts editor/src/locales/fr.ts
git commit -m "feat(editor): ThemeSwitcher component — binary Dark/Light toggle wired into /settings"
```

---

## P3 — Palette swap

**Goal:** The back-compat aliases in `globals.css` currently map old tokens to the new Layer 2 semantic tokens, but the semantic tokens themselves still hold the OLD warm Atelier hex values (from P1 where we preserved visual parity). Now we swap the Layer 2 values to the new neutral + emerald palette. After this commit, dark mode looks cool-gray + green instead of warm-brown + orange. Light mode becomes fully usable because it only depends on semantic tokens.

This phase touches ONE file: `editor/src/styles/globals.css`.

---

### P3-T1 — Swap Layer 2 semantic token values to neutral/emerald palette

**Files modified:**
- `editor/src/styles/globals.css` — update only the Layer 2 `:root[data-theme="dark"]` and `:root[data-theme="light"]` blocks

**Steps:**

After P1-T2, the Layer 2 dark block already has the correct neutral/emerald values (they were written into globals.css as part of the P1 restructure). Verify this is the case:

- [ ] Confirm that `globals.css` Layer 2 dark block contains `var(--gray-950)` for `--surface` and `var(--emerald-500)` for `--brand`. If the P1 restructure was done correctly (file written verbatim from P1-T2 instructions), these are already present.

- [ ] The only change needed in P3 is to verify both light and dark themes look correct visually. Run the dev server:

```bash
cd editor && npm run dev
```

- [ ] Open `http://localhost:5173/settings` in the browser.
- [ ] Toggle Dark → Light → Dark using the `ThemeSwitcher` (from P2).
- [ ] Manual smoke checklist:
  - Dark: background is `#0F1115` (deep charcoal), CTAs are emerald green, text is `#F1F5F9` light gray. No orange/brown surfaces.
  - Light: background is white, surfaces are gray-50/100, CTAs emerald, text `#0F172A` dark navy.
  - No FOUC on page reload in either mode.
  - Konva canvas chrome (stage-bg-dots backdrop) looks neutral, not orange-glow.
  - Sidebar and top bar switch together with the canvas chrome.
  - Components still using old aliases (via the back-compat layer) render cohesively because back-compat maps `--terra` → `--brand`, `--bg` → `--surface`, etc.

- [ ] Run editor tests to confirm no regressions from the visual change:

```bash
cd editor && npx vitest run
```

Expected: all pass (tests check behavior, not hex values).

**Commit:**

```bash
git add editor/src/styles/globals.css
git commit -m "style(editor): swap Layer 2 semantic tokens to neutral-slate + emerald palette — dark and light modes cohesive"
```

Note: if P1-T2 was written verbatim, this commit may be a no-op (globals.css already has the new palette). In that case the commit captures the "P3 milestone reached" intent and the manual smoke verification above is the deliverable.

---

## P4 — Sweep (raw → semantic, per surface)

**Goal:** Replace all remaining `var(--terra)`, `var(--bg)`, `var(--ink)`, `var(--raised)`, `var(--line)`, `var(--sage)`, `var(--gold)`, `var(--brick)`, `var(--sand)` call-sites in component files with their semantic equivalents from the §5 translation table. Each surface batch is one commit. After all 8 batches, `grep -rn "var(--terra\|--bg\|--ink\|--raised\|--line-soft\|--line-strong\|--sage\|--gold\|--brick\|--sand\|--hover\|--inset\|--card-surface)" editor/src --include="*.tsx" --include="*.ts" --include="*.css"` (excluding `globals.css`) returns zero hits.

**Mechanical translation table** (from spec §5):

| OLD token | NEW token |
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
| `var(--terra)`, `var(--terra-deep)` (as CTA) | `var(--brand)`, `var(--brand-hover)` |
| `var(--terra-soft)` | `var(--brand-soft)` |
| `var(--terra-line)` | `var(--brand-line)` |
| `var(--sage)` (as success/online) | `var(--success)` |
| `var(--sage-soft)` | `var(--success-soft)` |
| `var(--gold)` (as warning) | `var(--warning)` |
| `var(--gold-soft)` | `var(--warning-soft)` |
| `var(--brick)` (as destructive) | `var(--danger)` |
| `var(--brick-soft)` | `var(--danger-soft)` |
| `var(--sh-1)`, `var(--sh-2)`, `var(--sh-3)` | `var(--shadow-sm)`, `var(--shadow-md)`, `var(--shadow-lg)` |
| `var(--ring-terra)`, `var(--glow-terra)` | `var(--ring-brand)` |
| `var(--sand)`, `var(--sand-soft)` | Case-by-case: usually `var(--surface-raised-2)` for soft bg tints, `var(--text-mut)` for subtle text. Review each occurrence manually. |

**Before starting each batch:** run `grep -rn "var(--terra\|--bg[^-]\|--raised\|--ink\|--line\|--hover\|--inset\|--sage\|--gold\|--brick\|--sand\|--card-surface)" editor/src --include="*.tsx" -l` to see which files remain.

---

### P4-T1 — Root chrome sweep

**Surface:** `WorkspaceSidebar`, `WorkspaceTopBarControls`, `__root.tsx`

**Steps:**

- [ ] Find all three files:

```bash
grep -rn "var(--terra\|var(--bg\|var(--ink\|var(--raised\|var(--line\|var(--hover\|var(--inset\|var(--sage\|var(--brick\|var(--sand" editor/src/routes/__root.tsx editor/src/components/WorkspaceSidebar.tsx editor/src/components/WorkspaceTopBarControls.tsx
```

- [ ] For each occurrence, apply the mechanical translation table above. Pay special attention to:
  - `var(--terra)` in active states / selected nav items → `var(--brand)`
  - `var(--ink)` on text elements → `var(--text)`
  - `var(--ink-mut)` on secondary labels → `var(--text-mut)`
  - `var(--bg)` / `var(--raised)` on sidebar backgrounds → `var(--surface)` / `var(--surface-raised)`
  - `var(--line-soft)` on dividers and borders → `var(--border-soft)`
  - Online dot colors using `var(--sage)` → `var(--success)`

- [ ] Run editor tests:

```bash
cd editor && npx vitest run
```

Expected: all pass.

**Commit:**

```bash
git add editor/src/routes/__root.tsx editor/src/components/WorkspaceSidebar.tsx editor/src/components/WorkspaceTopBarControls.tsx
git commit -m "style(editor): P4 sweep — root chrome (WorkspaceSidebar, WorkspaceTopBarControls, __root)"
```

---

### P4-T2 — Setup / auth screens sweep

**Surface:** `SetupWizard`, `SetupWizardSteps/*`, `LoginForm`, `SignupForm`, `TrustGatePage`

**Steps:**

- [ ] Find all files in the setup and auth features:

```bash
grep -rn "var(--terra\|var(--bg\|var(--ink\|var(--raised\|var(--line\|var(--hover\|var(--inset\|var(--sage\|var(--brick\|var(--sand" editor/src/features/setup/ editor/src/features/auth/ editor/src/routes/login.tsx editor/src/routes/signup.tsx --include="*.tsx" --include="*.ts" -l
```

- [ ] Apply the translation table to every hit. Particular attention:
  - `var(--terra)` on CTA buttons and step-indicator active dots → `var(--brand)`
  - `var(--terra-soft)` on active step backgrounds → `var(--brand-soft)`
  - `var(--brick)` on error states → `var(--danger)`
  - `var(--brick-soft)` on error backgrounds → `var(--danger-soft)`
  - `var(--ink-faint)` on placeholder text → `var(--text-faint)`

- [ ] Run editor tests:

```bash
cd editor && npx vitest run
```

Expected: all pass.

**Commit:**

```bash
git add editor/src/features/setup/ editor/src/features/auth/ editor/src/routes/login.tsx editor/src/routes/signup.tsx
git commit -m "style(editor): P4 sweep — setup wizard + auth screens"
```

---

### P4-T3 — `/networks/:id` sweep

**Surface:** `editor/src/routes/networks.$id.tsx` + `editor/src/features/network-detail/` (ServerCard, modals, kebab menu, server key list)

**Steps:**

- [ ] Find all files:

```bash
grep -rn "var(--terra\|var(--bg\|var(--ink\|var(--raised\|var(--line\|var(--hover\|var(--inset\|var(--sage\|var(--brick\|var(--sand" editor/src/routes/networks* editor/src/features/network-detail/ --include="*.tsx" -l
```

- [ ] Apply the translation table. Notable cases:
  - `var(--sage)` on the "online" status dot → `var(--success)`
  - `var(--sage-soft)` on the online indicator background → `var(--success-soft)`
  - `var(--gold)` on warning badges (e.g. key expiry) → `var(--warning)`
  - `var(--terra)` on primary action buttons → `var(--brand)`
  - `var(--brick)` on destructive actions (delete server key) → `var(--danger)`

- [ ] Run editor tests:

```bash
cd editor && npx vitest run
```

Expected: all pass.

**Commit:**

```bash
git add editor/src/routes/networks* editor/src/features/network-detail/
git commit -m "style(editor): P4 sweep — /networks/:id route + network-detail components"
```

---

### P4-T4 — Workspace canvas chrome sweep

**Surface:** `FlowCanvas`, `Stage`, `MenuProperties`, `LayersPanel`

**Important:** Do NOT change colors on Konva drawing primitives (chest grid, slot colors, item renders). Only the DOM chrome around the canvas is in scope.

**Steps:**

- [ ] Find all files:

```bash
grep -rn "var(--terra\|var(--bg\|var(--ink\|var(--raised\|var(--line\|var(--hover\|var(--inset\|var(--sage\|var(--brick\|var(--sand" editor/src/features/canvas/FlowCanvas.tsx editor/src/features/canvas/Stage.tsx editor/src/features/canvas/MenuProperties.tsx editor/src/features/canvas/title/composer/LayersPanel.tsx --include="*.tsx"
```

- [ ] Apply the translation table to DOM-level JSX (className strings, inline style props). Skip any `fill=`, `stroke=`, or Konva `Rect`/`Line` color props.
  - `var(--terra)` on selected menu border / active state → `var(--brand)`
  - `var(--line-soft)` on panel dividers → `var(--border-soft)`
  - `var(--raised)` on panel backgrounds → `var(--surface-raised)`
  - `var(--ink-mut)` on secondary panel labels → `var(--text-mut)`

- [ ] Run editor tests (includes canvas refactor tests: SlotItem, PaginationControls, menuFanout, etc.):

```bash
cd editor && npx vitest run
```

Expected: all pass.

**Commit:**

```bash
git add editor/src/features/canvas/FlowCanvas.tsx editor/src/features/canvas/Stage.tsx editor/src/features/canvas/MenuProperties.tsx editor/src/features/canvas/title/composer/LayersPanel.tsx
git commit -m "style(editor): P4 sweep — workspace canvas chrome (FlowCanvas, Stage, MenuProperties, LayersPanel)"
```

---

### P4-T5 — Modals & dialogs sweep

**Surface:** shadcn `Dialog`, `DropdownMenu`, `NewWorkspaceDialog`, `DeletePackDialog`, `Toaster`, `ConflictResolutionModal`

**Steps:**

- [ ] Find all files:

```bash
grep -rn "var(--terra\|var(--bg\|var(--ink\|var(--raised\|var(--line\|var(--hover\|var(--inset\|var(--sage\|var(--brick\|var(--sand" editor/src/components/ui/ editor/src/features/canvas/dialogs/ editor/src/components/Toaster.tsx --include="*.tsx" -l
```

Note: `editor/src/components/ui/` files are vendored shadcn components. They use shadcn token names (`--background`, `--primary`, `--destructive`) which are already mapped to Layer 2 via Layer 3. The only raw-token occurrences in these files would be custom overrides added on top of the vendor code. Check each occurrence carefully; if the file is purely vendored with no local raw-token additions, skip it.

- [ ] Apply the translation table to non-vendored dialog components only.
  - `var(--brick)` / `var(--brick-soft)` on destructive confirm dialogs → `var(--danger)` / `var(--danger-soft)`
  - `var(--sage)` on success toast icons → `var(--success)`
  - `var(--gold)` on warning toasts → `var(--warning)`

- [ ] Run editor tests (includes DeletePackDialog, ConflictResolutionModal, ConflictBanner tests):

```bash
cd editor && npx vitest run
```

Expected: all pass.

**Commit:**

```bash
git add editor/src/components/ui/ editor/src/features/canvas/dialogs/ editor/src/components/Toaster.tsx
git commit -m "style(editor): P4 sweep — modals, dialogs, toaster"
```

---

### P4-T6 — History / commits / translations / data-sources sweep

**Surface:** `HistoryTab`, `TranslationPanel`, `DataSourcesPanel`, branch UI

**Steps:**

- [ ] Find all files:

```bash
grep -rn "var(--terra\|var(--bg\|var(--ink\|var(--raised\|var(--line\|var(--hover\|var(--inset\|var(--sage\|var(--brick\|var(--sand" editor/src/features/history/ editor/src/features/translations/ editor/src/features/data-sources/ editor/src/features/branches/ --include="*.tsx" -l
```

- [ ] Apply the translation table.
  - `var(--terra)` on commit badges (current branch indicator) → `var(--brand)`
  - `var(--sage)` on "deployed" indicators → `var(--success)`
  - `var(--gold)` on "pending changes" warnings → `var(--warning)`
  - `var(--line-soft)` on commit timeline connectors → `var(--border-soft)`
  - `var(--ink-faint)` on commit metadata timestamps → `var(--text-faint)`

- [ ] Run editor tests:

```bash
cd editor && npx vitest run
```

Expected: all pass.

**Commit:**

```bash
git add editor/src/features/history/ editor/src/features/translations/ editor/src/features/data-sources/ editor/src/features/branches/
git commit -m "style(editor): P4 sweep — history, translations, data-sources, branches"
```

---

### P4-T7 — Library & assets sweep

**Surface:** `Library`, `AssetsTab`, `AssetUploadDialog`, `AssetImportFontDialog`, `AssetDetailPanel`, item pickers

**Steps:**

- [ ] Find all files:

```bash
grep -rn "var(--terra\|var(--bg\|var(--ink\|var(--raised\|var(--line\|var(--hover\|var(--inset\|var(--sage\|var(--brick\|var(--sand" editor/src/features/library/ editor/src/features/assets/ --include="*.tsx" -l
```

- [ ] Apply the translation table.
  - `var(--terra)` on selected item highlight ring → `var(--brand)`
  - `var(--terra-soft)` on selected item background → `var(--brand-soft)`
  - `var(--ink-mut)` on item count labels → `var(--text-mut)`
  - `var(--raised)` on library panel backgrounds → `var(--surface-raised)`
  - `var(--line)` on asset grid cell borders → `var(--border)`

- [ ] Run editor tests (includes AssetUploadDialog, AssetsTab, Library, mcModelRenderer tests):

```bash
cd editor && npx vitest run
```

Expected: all pass.

**Commit:**

```bash
git add editor/src/features/library/ editor/src/features/assets/
git commit -m "style(editor): P4 sweep — library + assets panels"
```

---

### P4-T8 — Verification grep + final test run

**Goal:** Confirm zero raw-token call-sites remain outside of `globals.css`.

**Steps:**

- [ ] Run the verification grep:

```bash
grep -rn "var(--terra\|var(--bg[^-]\|var(--bg-deep\|var(--raised\|var(--card-surface\|var(--hover[^-]\|var(--inset[^-]\|var(--ink[^-]\|var(--ink-2\|var(--ink-mut\|var(--ink-faint\|var(--line[^-]\|var(--line-soft\|var(--line-strong\|var(--sage[^-]\|var(--sage-soft\|var(--gold[^-]\|var(--gold-soft\|var(--brick[^-]\|var(--brick-soft\|var(--sand[^-]\|var(--sand-soft\|var(--sh-1\|var(--sh-2\|var(--sh-3\|var(--ring-terra\|var(--glow-terra)" editor/src --include="*.tsx" --include="*.ts" --include="*.css" --exclude="globals.css"
```

Expected: zero results. If any remain, address them before proceeding to P5.

- [ ] Run the full editor test suite one final time:

```bash
cd editor && npx vitest run
```

Expected: 965+ tests pass, zero failures.

- [ ] Run backend tests to confirm no regressions:

```bash
cd backend && bun run test
```

Expected: all pass.

---

## P5 — Cleanup

**Goal:** Delete the back-compat raw aliases from `globals.css` now that zero components reference them.

---

### P5-T1 — Delete back-compat aliases from `globals.css`

**Files modified:**
- `editor/src/styles/globals.css` — remove the entire `/* BACK-COMPAT ALIASES */` block + the `@theme inline` entries for old token names

**Steps:**

- [ ] Open `editor/src/styles/globals.css`. Remove the entire section marked `/* BACK-COMPAT ALIASES — old raw tokens re-mapped to Layer 2. [...] DELETED in P5. */` including all its contents.

- [ ] In the `@theme inline` block, remove the following lines (they were back-compat Tailwind utility bridges for the old tokens):

```css
/* Remove these lines from @theme inline: */
--color-terra:       var(--terra);
--color-terra-deep:  var(--terra-deep);
--color-sand:        var(--sand);
--color-gold:        var(--gold);
--color-sage:        var(--sage);
--color-brick:       var(--brick);
--color-ink:         var(--ink);
--color-ink-2:       var(--ink-2);
--color-ink-mut:     var(--ink-mut);
--color-ink-faint:   var(--ink-faint);
--color-line:        var(--line);
--color-line-soft:   var(--line-soft);
--color-line-strong: var(--line-strong);
--color-raised:      var(--raised);
--color-raised-2:    var(--raised-2);
--color-bg-deep:     var(--bg-deep);
--color-inset:       var(--inset);
--color-hover:       var(--hover);
```

- [ ] Run the verification grep again to confirm `globals.css` itself no longer defines the old tokens (they should be fully gone):

```bash
grep -n "\-\-terra\|\-\-bg[^-]\|\-\-raised\|\-\-ink\b\|\-\-sage\b\|\-\-gold\b\|\-\-brick\b\|\-\-sand\b" editor/src/styles/globals.css
```

Expected: zero results (only `--gray-*`, `--emerald-*`, `--red-*`, `--amber-*` Layer 1 names, and the semantic `--surface`, `--text`, `--border`, `--brand`, `--success`, `--warning`, `--danger` Layer 2 names remain).

- [ ] Run the full editor test suite:

```bash
cd editor && npx vitest run
```

Expected: all pass.

- [ ] Run the dev server and do a final visual check:

```bash
cd editor && npm run dev
```

Both dark and light modes render correctly. No missing colors / invisible text.

**Commit:**

```bash
git add editor/src/styles/globals.css
git commit -m "style(editor): P5 cleanup — remove back-compat raw token aliases from globals.css"
```

---

## P6 — Tune

**Goal:** Iterate on hex values in `globals.css` until both modes feel right. Open-ended; one commit per round of adjustments.

---

### P6-T1 — Browser tuning pass (open-ended)

**Files modified:**
- `editor/src/styles/globals.css` — ONLY the Layer 1 raw palette values and/or Layer 2 semantic token values

**Steps:**

- [ ] Run the dev server:

```bash
cd editor && npm run dev
```

- [ ] Open `http://localhost:5173` and navigate through: workspace canvas, `/settings`, `/networks/:id`, setup wizard, modals, library, assets, history tab, translations panel.

- [ ] For each mode (dark and light), verify:
  - **Text legibility:** `--text` on `--surface` meets WCAG AA (4.5:1 for normal text). Use Chrome DevTools accessibility inspector.
  - **Brand accent:** emerald CTAs are visible against dark backgrounds without being garish. Hover state (`--brand-hover`) is perceptibly darker/muted.
  - **Success/warning/danger** indicators are distinguishable from each other and from the brand color.
  - **Borders:** `--border-soft` and `--border` are both visible in both themes without being heavy.
  - **The Konva canvas area** (chess-dot backdrop) doesn't clash with the new palette — the `stage-bg-dots` radial gradient uses a warm dot color; consider replacing `rgba(230, 203, 159, .07)` with `rgba(148, 163, 184, .07)` (neutral slate) for light mode coherence if needed. This is a minor aesthetic call.

- [ ] Edit hex values in Layer 1 and/or Layer 2 as needed. Only `globals.css` changes.

- [ ] Run editor tests after each round to confirm no regressions:

```bash
cd editor && npx vitest run
```

Expected: all pass (tests are not sensitive to specific hex values).

**Commit per round:**

```bash
git add editor/src/styles/globals.css
git commit -m "style(editor): P6 tune — [brief description of what was adjusted, e.g. lighten surface-raised-2 in light mode, darken brand-hover]"
```

Repeat as many rounds as needed. P6 is complete when both modes pass a subjective quality bar and the AA contrast check.

---

## Summary checklist

| Phase | Deliverable | Done |
|---|---|---|
| P1-T1 | `users.theme` Drizzle migration committed | |
| P1-T2 | `globals.css` 3-layer restructure + back-compat aliases | |
| P2-T1 | `AuthUserDto` + `patchMe` typed for `theme` | |
| P2-T2 | Backend `PATCH/GET /me` handles theme + tests | |
| P2-T3 | `themeStore.ts` + tests | |
| P2-T4 | `main.tsx` FOUC prevention bootstrap | |
| P2-T5 | `authStore.hydrate` applies server theme if no localStorage | |
| P2-T6 | `ThemeSwitcher` + i18n keys + wired into `/settings` | |
| P3-T1 | Palette swap visual smoke | |
| P4-T1 | Root chrome sweep | |
| P4-T2 | Setup/auth sweep | |
| P4-T3 | /networks/:id sweep | |
| P4-T4 | Canvas chrome sweep | |
| P4-T5 | Modals/dialogs sweep | |
| P4-T6 | History/translations/data-sources sweep | |
| P4-T7 | Library/assets sweep | |
| P4-T8 | Verification grep + final test run | |
| P5-T1 | Back-compat aliases deleted from globals.css | |
| P6-T1 | Browser tuning pass(es) | |
