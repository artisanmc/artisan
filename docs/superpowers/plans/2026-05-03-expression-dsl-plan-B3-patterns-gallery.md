# Expression DSL — Plan B3: Patterns Gallery

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a "Cheat sheet" / patterns gallery — a modal accessible from a top-bar button that shows ~15 reference snippets (lore + condition + action shapes) admins can copy and paste into their own fields. Self-served documentation. No magic insertion (the spec's "click pattern → insert into focused field" is deferred to a later plan, since we'd need focused-field tracking infrastructure first).

**Architecture:** A new `<PatternsGallery>` React component renders a grid of cards, each with name + description + monospace snippet + copy-to-clipboard button. Mounted as a Sheet (existing primitive) triggered from a `BookOpen` icon button in the top-bar of `pack.$packId.tsx`. All snippet content + names + descriptions are i18n-keyed under `patterns.*`. No new schema, no new DSL features, no new editor wiring.

**Tech Stack:** React 19, existing `<Sheet>`, `<SheetContent>`, `<SheetHeader>`, `<SheetTitle>` from shadcn (already imported at `pack.$packId.tsx`), `lucide-react` for icons, `react-i18next`. Browser `navigator.clipboard.writeText` for copy. No new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-05-03-expression-dsl-design.md` §4.5 (Patterns gallery — 15 entries V1). Snippets adapted to current grammar (no `has_perm()` function — uses `%player_has_permission_*%` PAPI workaround as the spec notes).

**Out of scope (subsequent plans):**
- Click-to-insert at the focused field (requires field-focus tracking)
- Toolbar buttons (Placeholder picker, Conditional inserter, List join inserter — Plan B3.x or later)
- Live preview integration

---

## File Structure

```
web/src/features/help/
├── PatternsGallery.tsx              # NEW — the modal Sheet with grid + copy buttons
└── patterns.ts                      # NEW — array of 15 patterns (id, snippet, kind)

web/src/routes/pack.$packId.tsx      # Modify — add a BookOpen button + Sheet wiring

web/src/locales/
├── en.ts                            # New patterns.* block (15 names + 15 descriptions + UI strings)
└── fr.ts                            # Same block, French
```

---

## Task 1: Pattern data module

**Files:**
- Create: `web/src/features/help/patterns.ts`

- [ ] **Step 1: Write the patterns module**

```typescript
// web/src/features/help/patterns.ts
/**
 * Static catalog of 15 reference snippets shown in the Patterns Gallery.
 *
 * Each pattern has:
 *  - id: stable key for i18n (pattern.<id>.name and pattern.<id>.desc)
 *  - kind: lore | condition | action — drives the badge color
 *  - snippet: the literal text the admin copies. Verbatim, no
 *             interpolation. Quotes inside snippets are intentional
 *             (the DSL grammar requires them for string literals).
 */

export type PatternKind = "lore" | "condition" | "action";

export interface Pattern {
  id: string;
  kind: PatternKind;
  snippet: string;
}

export const PATTERNS: Pattern[] = [
  { id: "placeholder", kind: "lore", snippet: "{quest.name}" },
  {
    id: "colorByAmount",
    kind: "lore",
    snippet: '{quest.gold > 1000 ? "<gold>" : "<gray>"}{quest.gold}',
  },
  {
    id: "vipBadge",
    kind: "lore",
    snippet: '{%player_has_permission_vip% == "true" ? "VIP" : ""}',
  },
  { id: "joinComma", kind: "lore", snippet: '{quest.tags.join(", ")}' },
  { id: "joinNewline", kind: "lore", snippet: '{quest.tags.join("\\n")}' },
  { id: "pageOfN", kind: "lore", snippet: "Page {index + 1} of {count}" },
  { id: "starOnFirst", kind: "lore", snippet: '{first ? "★ " : ""}{quest.name}' },
  {
    id: "lockedIfNoPerm",
    kind: "lore",
    snippet:
      '{%player_has_permission_shop_vip% == "true" ? "" : "<dark_gray>(VIP required)</dark_gray>"}',
  },
  {
    id: "compareBalanceToPrice",
    kind: "lore",
    snippet:
      '{%vault_eco_balance% >= quest.gold ? "<green>Buy" : "<red>Too expensive"}',
  },
  {
    id: "rarityPrefix",
    kind: "lore",
    snippet: '{quest.rarity == "legendary" ? "<gold>★ " : ""}{quest.name}',
  },
  { id: "countTags", kind: "lore", snippet: "{quest.tags.length()} categories" },
  { id: "firstOrDefault", kind: "lore", snippet: "{quest.tags.first()}" },
  { id: "cycleCategory", kind: "action", snippet: "set_arg_cycle_next: arg=current_tag, list=categories" },
  { id: "resetCategory", kind: "action", snippet: 'set_arg: arg=current_tag, value="weapon"' },
  { id: "i18nReuse", kind: "lore", snippet: "{i18n:common.coins}" },
];
```

- [ ] **Step 2: Add a small sanity test (1 file)**

Create `web/src/features/help/patterns.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { PATTERNS } from "./patterns";

describe("PATTERNS", () => {
  it("ships 15 entries", () => {
    expect(PATTERNS).toHaveLength(15);
  });

  it("each entry has unique id", () => {
    const ids = PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each entry has a non-empty snippet", () => {
    for (const p of PATTERNS) {
      expect(p.snippet.length).toBeGreaterThan(0);
    }
  });

  it("each kind is one of lore | condition | action", () => {
    for (const p of PATTERNS) {
      expect(["lore", "condition", "action"]).toContain(p.kind);
    }
  });
});
```

- [ ] **Step 3: Run, biome, commit**

```bash
cd web && npm test -- patterns.test --run
cd web && ./node_modules/.bin/biome check src/features/help/
git add web/src/features/help/patterns.ts web/src/features/help/patterns.test.ts
git commit -m "feat(help): add Patterns Gallery data module (15 entries)"
```

---

## Task 2: PatternsGallery component

**Files:**
- Create: `web/src/features/help/PatternsGallery.tsx`

- [ ] **Step 1: Write the component**

```typescript
// web/src/features/help/PatternsGallery.tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PATTERNS, type Pattern, type PatternKind } from "./patterns";

interface PatternsGalleryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const KIND_BADGE: Record<PatternKind, string> = {
  lore: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30",
  condition: "bg-amber-500/15 text-amber-200 border-amber-500/30",
  action: "bg-purple-500/15 text-purple-200 border-purple-500/30",
};

export function PatternsGallery({ open, onOpenChange }: PatternsGalleryProps) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-2xl border-zinc-800 bg-zinc-950 text-zinc-100"
      >
        <SheetHeader>
          <SheetTitle className="text-zinc-100">{t("patterns.title")}</SheetTitle>
        </SheetHeader>
        <p className="mt-2 text-[12px] text-zinc-400">{t("patterns.intro")}</p>
        <div className="mt-4 space-y-3">
          {PATTERNS.map((p) => (
            <PatternCard key={p.id} pattern={p} />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PatternCard({ pattern }: { pattern: Pattern }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pattern.snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API failures (older browsers, no permission) — silent
      // fallback: select the text. We could surface a toast here later.
    }
  };

  return (
    <div className="rounded border border-zinc-800 bg-zinc-900 p-3">
      <div className="mb-1 flex items-center gap-2">
        <span
          className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase ${KIND_BADGE[pattern.kind]}`}
        >
          {pattern.kind}
        </span>
        <span className="text-[12px] font-semibold text-zinc-100">
          {t(`patterns.entries.${pattern.id}.name`)}
        </span>
      </div>
      <p className="mb-2 text-[11px] text-zinc-400">
        {t(`patterns.entries.${pattern.id}.desc`)}
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 break-all rounded bg-zinc-950 px-2 py-1.5 font-mono text-[11px] text-zinc-200">
          {pattern.snippet}
        </code>
        <button
          type="button"
          onClick={copy}
          title={t(copied ? "patterns.copied" : "patterns.copy")}
          className="flex h-7 w-7 items-center justify-center rounded border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TS + biome**

```bash
cd web && npx tsc --noEmit
cd web && ./node_modules/.bin/biome check src/features/help/PatternsGallery.tsx
```

- [ ] **Step 3: Commit**

```bash
git add web/src/features/help/PatternsGallery.tsx
git commit -m "feat(help): add PatternsGallery sheet component"
```

---

## Task 3: i18n keys

**Files:**
- Modify: `web/src/locales/en.ts`
- Modify: `web/src/locales/fr.ts`

- [ ] **Step 1: Add patterns block in en.ts**

Add a new top-level block `patterns:` (place it alphabetically after the existing top-level blocks). Use this exact content:

```typescript
  patterns: {
    title: "Cheat sheet",
    intro: "Click copy on any snippet to use it in your own fields.",
    copy: "Copy",
    copied: "Copied!",
    entries: {
      placeholder: {
        name: "Show a placeholder",
        desc: "The simplest case — display a context value or iteration field.",
      },
      colorByAmount: {
        name: "Color by amount",
        desc: "Different MiniMessage tag depending on a numeric threshold.",
      },
      vipBadge: {
        name: "VIP badge if permission",
        desc: "Show a label only when the player has a permission.",
      },
      joinComma: {
        name: "Join a list with commas",
        desc: "Concatenate every item of a list using a separator.",
      },
      joinNewline: {
        name: "Join a list on new lines",
        desc: "One item per line, e.g. for multi-line lores.",
      },
      pageOfN: {
        name: "Page index of total",
        desc: "Display the current iteration position in 'Page X of N' style.",
      },
      starOnFirst: {
        name: "Star on first item",
        desc: "Add a marker on the first iteration only.",
      },
      lockedIfNoPerm: {
        name: "Locked text if missing perm",
        desc: "Show a 'VIP required' hint when the player lacks the permission.",
      },
      compareBalanceToPrice: {
        name: "Compare balance to price",
        desc: "Green vs red label depending on whether the player can afford it.",
      },
      rarityPrefix: {
        name: "Rarity prefix",
        desc: "Add a star prefix only for legendary items.",
      },
      countTags: {
        name: "Count items in a list",
        desc: "Display the length of a list value.",
      },
      firstOrDefault: {
        name: "First item of a list",
        desc: "Pick the first element — empty string when the list is empty.",
      },
      cycleCategory: {
        name: "Cycle a category at click",
        desc: "Action shape for moving an arg to the next value of a list.",
      },
      resetCategory: {
        name: "Reset a category",
        desc: "Action shape for setting an arg to a literal value.",
      },
      i18nReuse: {
        name: "Reuse a translation key",
        desc: "Inline reference to another translation — handy for shared terms.",
      },
    },
  },
```

- [ ] **Step 2: Add patterns block in fr.ts**

Same shape, French strings:

```typescript
  patterns: {
    title: "Aide-mémoire",
    intro: "Clique sur copier pour réutiliser un snippet dans tes propres champs.",
    copy: "Copier",
    copied: "Copié !",
    entries: {
      placeholder: {
        name: "Afficher un placeholder",
        desc: "Le cas le plus simple — afficher une valeur de contexte ou un champ d'itération.",
      },
      colorByAmount: {
        name: "Couleur selon le montant",
        desc: "Tag MiniMessage différent selon un seuil numérique.",
      },
      vipBadge: {
        name: "Badge VIP si permission",
        desc: "Afficher un label uniquement si le joueur a une permission.",
      },
      joinComma: {
        name: "Joindre une liste avec virgules",
        desc: "Concatène chaque élément d'une liste avec un séparateur.",
      },
      joinNewline: {
        name: "Joindre une liste sur des lignes",
        desc: "Un élément par ligne, par exemple pour les lores multi-lignes.",
      },
      pageOfN: {
        name: "Index sur total",
        desc: "Affiche la position courante de l'itération en 'Page X sur N'.",
      },
      starOnFirst: {
        name: "Étoile sur le premier",
        desc: "Marqueur uniquement sur la première itération.",
      },
      lockedIfNoPerm: {
        name: "Texte verrouillé sans perm",
        desc: "Affiche '(VIP requis)' quand le joueur n'a pas la permission.",
      },
      compareBalanceToPrice: {
        name: "Comparer solde et prix",
        desc: "Label vert ou rouge selon que le joueur peut acheter.",
      },
      rarityPrefix: {
        name: "Préfixe selon la rareté",
        desc: "Ajoute une étoile uniquement aux items légendaires.",
      },
      countTags: {
        name: "Compter les éléments d'une liste",
        desc: "Affiche la longueur d'une valeur liste.",
      },
      firstOrDefault: {
        name: "Premier élément d'une liste",
        desc: "Prend le premier élément — chaîne vide si la liste est vide.",
      },
      cycleCategory: {
        name: "Cycler une catégorie au clic",
        desc: "Forme d'action pour passer un arg à la valeur suivante d'une liste.",
      },
      resetCategory: {
        name: "Réinitialiser une catégorie",
        desc: "Forme d'action pour définir un arg à une valeur littérale.",
      },
      i18nReuse: {
        name: "Réutiliser une clé i18n",
        desc: "Référence inline vers une autre traduction — pratique pour les termes partagés.",
      },
    },
  },
```

- [ ] **Step 3: Verify and commit**

```bash
cd web && npx tsc --noEmit
cd web && ./node_modules/.bin/biome check src/locales/en.ts src/locales/fr.ts
git add web/src/locales/en.ts web/src/locales/fr.ts
git commit -m "feat(help): add i18n keys for Patterns Gallery"
```

---

## Task 4: Mount the trigger in the top-bar

**Files:**
- Modify: `web/src/routes/pack.$packId.tsx`

- [ ] **Step 1: Add imports**

At the top of `pack.$packId.tsx`, add:

```typescript
import { PatternsGallery } from "@/features/help/PatternsGallery";
```

And in the existing `lucide-react` import, add `BookOpen`:

```typescript
import { Boxes, BookOpen, Download, Globe, Languages, Redo2, Undo2, Upload } from "lucide-react";
```

- [ ] **Step 2: Add state in the component**

Inside `PackCanvasPage`, near the other `useState` hooks (around line 56-57 where `packsOpen` and `translationsOpen` live), add:

```typescript
  const [patternsOpen, setPatternsOpen] = useState(false);
```

- [ ] **Step 3: Add the trigger button + gallery render**

Find the top-bar section in the JSX. There's typically a row of buttons near `Languages`, `Translations`, `Undo/Redo`. Pick a spot and insert:

```typescript
            <button
              type="button"
              onClick={() => setPatternsOpen(true)}
              title={t("patterns.title")}
              className="flex h-8 w-8 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <BookOpen className="h-4 w-4" />
            </button>
```

Then near where other Sheets/dialogs are rendered (e.g. after `<TranslationPanel ... />` or where translations sheet is rendered), add:

```typescript
      <PatternsGallery open={patternsOpen} onOpenChange={setPatternsOpen} />
```

If you can't immediately tell where the top-bar buttons live, search for `<Languages` or `Languages className=` in `pack.$packId.tsx` — that's a sibling button that's already mounted. Place the new button next to it.

- [ ] **Step 4: Verify, lint, commit**

```bash
cd web && npx tsc --noEmit
cd web && npm test -- --run 2>&1 | tail -5
cd web && ./node_modules/.bin/biome check src/routes/pack.$packId.tsx
git add web/src/routes/pack.$packId.tsx
git commit -m "feat(help): mount PatternsGallery trigger in pack top-bar"
```

Expected: 268+ tests pass (4 from Task 1 added → ~272), build clean.

---

## Task 5: Manual smoke test

- [ ] **Step 1: Start dev server**

```bash
cd web && npm run dev
```

Open `http://localhost:5173/`. Navigate into a pack.

- [ ] **Step 2: Find the BookOpen button in the top-bar and click it**

Verify the right-side Sheet slides in showing 15 cards, each with a colored badge (lore/condition/action), name, description, monospace snippet, and a copy button.

- [ ] **Step 3: Click copy on a few patterns**

Verify the icon flips to a checkmark briefly (1.5s). Paste somewhere (a text editor) and verify the literal snippet was copied — quotes preserved, no interpolation.

- [ ] **Step 4: Switch language**

If you can switch language in the editor, do so and verify pattern names + descriptions are translated.

- [ ] **Step 5: Stop dev server**

`Ctrl+C`. If any bugs found, fix and commit.

---

## What ships at the end of Plan B3

- A "Cheat sheet" Sheet accessible from a `BookOpen` icon button in the pack top-bar
- 15 ready-to-copy snippets covering common lore + action patterns
- Snippets are localized in en + fr
- Copy-to-clipboard works
- 4 unit tests on the patterns data

## What does NOT ship (subsequent plans)

- Click-to-insert at focused field (needs focused-field tracking)
- Actual toolbar buttons in lore/title/text editors (Placeholder picker, Conditional inserter, List-join inserter)
- Live preview integration
- Autocomplete on `{` / `.`
- Plain-language error messages
