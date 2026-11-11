# Placeholder discovery in text fields

**Status:** design approved, ready for implementation planning
**Author:** brainstorm 2026-05-30
**Related code:** `editor/src/lib/placeholders.ts`, `editor/src/features/canvas/menuPreviewScope.ts`, `editor/src/domain/types.ts` (ContextInput, DataSource, ConnectorSpec)

## Context

Today, when an admin edits a text field in the Artisan editor (an item title, an action's `send_message` text, a menu's `show_title` action…) they have no in-editor signal for **which placeholders are available**. They know `{player}` works in theory but don't know which custom names the active menu accepted, what data sources expose what fields, or what an iteration alias is called for this element. The result: they leave the editor to dig through the menu's `contextInputs`, the pack's `dataSources`, and the connector specs, then come back and type a string that may or may not resolve at runtime.

This spec covers the **discovery** of available placeholders inside text fields — telling the user what they can type. It does NOT cover validation/linting of placeholders they've already typed (out of scope for v1, kept easy to add later).

## Goals

- Show the available placeholders **without leaving the field being edited**.
- Make the discovery mechanism **discoverable** itself (no hidden hotkey).
- **Filter automatically by scope** — the dropdown surfaces only placeholders that will resolve in *this* particular field (menu vs element vs action vs dialog).
- Stay **out of the way** when the user knows what they're typing.

## Non-goals (v1)

- Lint / highlight existing placeholders in the text value
- Validation at commit / deploy time
- PAPI placeholder discovery (`%player_name%` style stays manual — PAPI users know their plugin)
- MiniMessage tag discovery (`<gold>`, `<bold>`…)
- Mouse-driven insertion from a side panel (rejected during brainstorming — combined hint + button option was not chosen)
- Per-module extensibility (future modules registering their own entries — natural extension point, not built in v1)

## User decisions (brainstorm)

| Question | Choice |
|---|---|
| Pain point | "I don't know WHAT to type" → discovery-first |
| Surfacing pattern | Autocomplete inline triggered by `{` |
| Trigger char(s) | `{` only |
| Discoverability hint | Inline hint line under each text field |
| Detail per row | Name + type + sample value |
| Path navigation | Flat (all leaves listed, search-by-typing) |
| Scope coverage v1 | LText fields only (title/lore/action texts/menu titles/dialog titles) |

## Architecture

Three units, each independently testable.

```
┌──────────────────────────────────────────────────────────┐
│  PlaceholderCatalog (pure module)                        │
│    compute(pack, location) → PlaceholderEntry[]          │
└──────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────┐
│  PlaceholderInput (React component)                      │
│    wraps <input> / <textarea>                            │
│    handles `{`-triggered popup, filter, insert           │
│    renders the inline hint                               │
└──────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────┐
│  v1 call sites (drop-in replacement):                    │
│    • ElementEditor title / lore LText fields             │
│    • Menu title composer text-bearing layers             │
│    • Action editor (send_message.text, show_title.title, │
│      .subtitle)                                          │
│    • Dialog title + dialog buttons' send_message         │
└──────────────────────────────────────────────────────────┘
```

**Why this partition**:

- `PlaceholderCatalog` is **pure** and reusable — same data structure will feed a future linter / a "show resolved value on hover" overlay / a module-specific autocomplete.
- `PlaceholderInput` is **catalog-agnostic** — receives entries as a prop. Domain knowledge stays in the catalog; UX knowledge stays in the component.
- Call sites change one component name (e.g. `<Input>` → `<PlaceholderInput location={...}>`) without touching their state-management or save logic.

## PlaceholderCatalog

### Input: `FieldLocation`

```ts
type FieldLocation =
  | { kind: "menu"; menuId: MenuId }
  | { kind: "element"; menuId: MenuId; elementId: ElementId }
  | { kind: "action"; menuId: MenuId; elementId: ElementId; clickType: ClickType }
  | { kind: "dialog"; dialogId: DialogId }
  | { kind: "dialog-action"; dialogId: DialogId; buttonId: string };
```

The caller (the field renderer) knows where it is in the pack and constructs the location.

### Output: `PlaceholderEntry`

```ts
interface PlaceholderEntry {
  /** Path to insert, no braces. Examples: "player", "quest.name", "pagination.page". */
  path: string;
  /** Domain type label for display. Values: "player" | "string" | "integer" | "number" | "boolean" | "list" | "object" (object only when a list-of-object's items have no flatten — rare). */
  type: string;
  /** A rendered preview value, e.g. "Steve" or "1". null when sample is unavailable. */
  sample: string | null;
  /** Source category — drives the dropdown grouping and a small grey tag in the row. */
  origin: "context" | "iteration" | "pagination" | "source";
}
```

### Resolution rules by `FieldLocation`

| Source | `menu` | `element` | `action` | `dialog` | `dialog-action` |
|---|:---:|:---:|:---:|:---:|:---:|
| `menu.contextInputs` (primitive) | ✓ | ✓ | ✓ | — | — |
| `menu.contextInputs` (sourceRef → dataSource / connector) flatten to leaves | ✓ | ✓ | ✓ | — | — |
| Element iteration alias leaves (`alias.<leaf>` when `element.iterates`) | — | ✓ | ✓ | — | — |
| Pagination (`pagination.page`, `pagination.totalPages`) | — | ✓ (when iterates) | ✓ (when iterates) | — | — |
| `dialog.contextInputs` | — | — | — | ✓ | ✓ |

**Flattening rule**: a contextInput whose type is `object { name, reward }` produces entries `{alias}.name` and `{alias}.reward` (not `{alias}` itself). A `list of object { name, reward }` referenced through an `iterates` produces `{itemAlias}.name`, `{itemAlias}.reward` plus pagination. Primitives stay as single entries (`{player}`, `{quest_id}`).

**List contextInputs at menu scope (not iterated)**: a contextInput of type `list` (whether of primitives or of objects) at menu scope is **omitted** from the catalog. It has no useful single-value placement — placing `{quests}` inline yields `[object Object,…]`. The data only becomes accessible once an element wraps it in `iterates`, at which point the iteration alias entries cover it.

**Sample computation**: reuse `buildPreviewScope(menu, pack)` from `menuPreviewScope.ts`. For `action` locations, the scope is the parent menu's scope. For `dialog`, scope is the dialog's own (empty in v1 since dialogs don't yet declare contextInputs — leave the resolution branch in place for the future).

**Missing sample**: `sample = null`. Renders as `—`. The row stays selectable.

**Removed dataSource**: a `sourceRef` whose target dataSource was deleted yields **no entries** (the input is broken anyway). One `console.warn` per render in dev, no UI surfacing.

### Sort + grouping

Entries returned in stable order:

1. By `origin`: `context` → `iteration` → `pagination` → `source` (when sources surface directly, which is rare since they're usually accessed via inputs).
2. Within each origin, alphabetic by `path`.

The dropdown renders one small grey group label per origin (`Context`, `Iteration (quest)`, `Pagination`). Inside a group, rows are alpha.

## PlaceholderInput

### Props

```ts
interface PlaceholderInputProps {
  value: string;
  onChange: (v: string) => void;
  /** Domain location — used by the catalog to compute available entries. */
  location: FieldLocation;
  multiline?: boolean;
  placeholder?: string;
  /** Default true. Set false on fields where the hint would be redundant (e.g. nested fields). */
  showHint?: boolean;
}
```

### Memoization

```ts
const entries = useMemo(
  () => PlaceholderCatalog.compute(pack, location),
  [pack, location],
);
```

`pack` comes from `useAccountStore`. The selector subscribes to the pack ref; immer ensures it shifts only when something inside actually changed. Location object identity is the caller's responsibility — `useMemo` it at the call site if it's built inline.

### Interaction cycle

1. **Trigger**: user types `{` → `onKeyDown` captures it, records caret position, sets `{ open: true, query: "", triggerCol: cursorCol }`. The `{` is inserted into the value normally.
2. **While open**:
   - Alphanum / `.` / `_` keystrokes extend `query` (also inserted into the value normally; we read from the value).
   - Backspace shortens query; if user backspaces past the original `{`, the popup closes.
   - `}` or whitespace → close without insertion (interpreted: user typed a literal brace or moved on).
   - Esc → close without insertion.
   - ↑ / ↓ → cycle `highlightedIndex`.
   - Tab or Enter → splice the highlighted entry's `path` plus a closing `}` at the caret, close the popup. The original `{` was already typed, so we insert `<path>}` after it.
3. **Click outside** → close without insertion.

### Caret-anchored positioning

Dropdown is an absolutely-positioned `<div>` whose `left`/`top` are computed from `getBoundingClientRect()` on the input + caret pixel offset. Use a small standalone helper (`getCaretCoordinates`) so it works for both `<input>` and `<textarea>`. Auto-flip to anchor above the input when the dropdown would overflow the viewport bottom.

In jsdom tests, `getCaretCoordinates` falls back to `(0, 0)` — tests use role/text queries, not screen positions.

### Filtering

```ts
const filtered = entries.filter((e) =>
  e.path.toLowerCase().includes(query.toLowerCase()),
);
```

Substring, case-insensitive. Good enough for v1. Sort comes from the catalog, not re-sorted by the input. Fuzzy ranking deferred.

### Empty state

If `filtered.length === 0`, render a single row `No variable matches "{query}"` (or `No variable available in this context` if `entries.length === 0` initially). The popup stays open until the user types `}`, presses Esc, or clicks away — they don't get the "I typed `{` and nothing happened" effect.

### Hint

Below the input, a `text-[11px] text-[var(--ink-faint)]` line:

> Type "{" to insert a variable

Renders only when `showHint && entries.length > 0`. Hidden when popup is open (avoids redundant noise).

### A11y

`role="combobox"` on the input, `aria-expanded`, `aria-controls` pointing at the popup `<div role="listbox">`, `aria-activedescendant` tracking the highlighted entry's `id`.

## Error handling & edge cases

| Case | Behavior |
|---|---|
| `pack` not loaded yet / `menuId` not found | Catalog returns `[]`. Popup empty state. No crash. |
| `sourceRef` points at a deleted `dataSource` | Entry omitted. `console.warn` once. |
| Sample non-renderable (`null`, `undefined`, object) | `sample = null` → renders `—`. Row still insertable. |
| Caret position not computable (jsdom) | Anchor at (0,0). Test queries are role-based, not position-based. |
| User opens with `{`, closes with Esc, reopens with `{` | Each open is fresh component state. |
| Long textarea with internal scroll | Dropdown is screen-coord anchored, follows the caret. |
| Query matches nothing | Empty text row, popup stays open until Esc/`}`/blur. |
| Several `{` in the buffer (`{a} {b|` with caret after `b`) | Popup attaches to the most recent `{` to the left of the caret. When closed, next `{` typed reopens. |

## What v1 will NOT do

- Lint / highlight resolved placeholders inside the value text
- Re-trigger autocomplete on existing placeholders (e.g. `Ctrl+Space` inside `{quest.foo|}`)
- PAPI / MiniMessage autocomplete
- Mouse-driven side-panel insertion
- Module-injected entries (extension point left intentional in the catalog signature so it's a sub-day add later)

## Testing

### `PlaceholderCatalog.test.ts` (pure)

- Menu without contextInputs → `[]` (unless the element iterates, in which case pagination is present in element/action scope only).
- Menu with primitive contextInput → entry with sample = coerced default per `coerceDefault`.
- Menu with sourceRef contextInput targeting a pack dataSource of type `object {name, reward}` → entries `{alias}.name` and `{alias}.reward`, type tags `"string"` / `"integer"`, samples from the dataSource value.
- Menu with sourceRef targeting an imported connector list `of object` → entries flatten the item type, plus `pagination.*` only when wrapped inside an `iterates` element.
- Element without `iterates` → no iteration / pagination entries.
- Element `iterates: { source: "quests", alias: "quest" }` → `quest.<leaf>` plus `pagination.page`, `pagination.totalPages`.
- `FieldLocation.action` returns identical entries to its parent element.
- `FieldLocation.dialog` returns only dialog.contextInputs (empty for now; tests the branch).
- Pack with referenced-but-deleted dataSource → entry omitted, no throw.

### `PlaceholderInput.test.tsx`

- Type `{` → popup opens, all entries visible.
- Type `{qu` → only entries containing `qu` after filter.
- ↓ then Tab → first matching entry inserted at caret, popup closes.
- Esc → closes without insertion; `{` remains.
- Space → closes; the `{ ` stays as typed.
- Click row → inserts that entry, closes.
- Backspace past the original `{` → closes.
- `{xyz` matching nothing → empty-state row.
- Hint visible when `showHint` is true and entries.length > 0; hidden when popup is open.

### Call-site integration smoke

- ElementEditor → type `{` in title field → first row contains `player` (assuming menu has a `player` contextInput).
- Element iterates → `quest.*` entries present.
- send_message action editor inherits the same scope as its parent element.

## Verification

End-to-end manual check on a real workspace:

1. `cd editor && npm run dev` (already running via Docker compose).
2. Open `/workspace/$id`, click an element with `appearances[0].title` editable.
3. Type `{` → dropdown appears at caret with the menu's contextInputs.
4. Add a contextInput on the menu via the menu editor → reopen → new entry appears.
5. Toggle `element.iterates` on → reopen → iteration alias entries appear with pagination.
6. Add a dataSource referenced by a sourceRef contextInput → entries flatten its fields.

Run the focused suites:

```bash
cd editor
npx vitest run src/lib/placeholderCatalog
npx vitest run src/features/inputs/PlaceholderInput
```

Full regression:

```bash
cd editor
npx vitest run --no-coverage
```

## Out-of-scope follow-ups (recorded for later)

- **Inline lint**: once the catalog is shipped, a separate render pass over the value can highlight unresolved placeholders in red and resolved ones in terra. Same catalog data feeds both.
- **PAPI autocomplete**: needs a registry of installed PAPI extensions (server-side). Defer until we surface the per-server module set.
- **Module-specific entries**: when a future `shop` module wants its actions to expose `{purchase.item}` etc., the catalog signature can grow to `compute(pack, location, moduleCatalogs)` without breaking existing call sites.
- **Per-binding compat hint**: "this placeholder won't resolve on server X because module Y is missing" — depends on the module-aware binding work already on the roadmap.
