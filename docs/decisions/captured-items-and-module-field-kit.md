# Captured items + Minecraft field kit for module forms

**Status:** accepted (2026-07-17)
**Builds on:** `item-templates-and-data-library.md` (Item templates), the custom-items
pipeline (`CustomItemsManager` + `SoftDepRegistry`), and the modular monolith
(`docs/architecture/modules.md`).

## Context

Real production shops (SpartaCube `config.yml`) are made of **full serialized
ItemStacks**: Nexo items (paper + custom_model_data + `nexo:id`), player heads
(profile + base64 texture), spawners with block-entity data, cosmetic elytras with
attribute modifiers, enchant glints. A `Material`-string icon field cannot carry
this, and per-plugin mappings (one code path per item system) don't scale. The
module forms (boutique screen) also hand-roll raw inputs, and `buy_commands` is a
bare textarea while the core already has a full actions/conditions engine.

## Decision

**2026-09 update — item extensions.** Item values may `extends` another item, inherit absent fields, and expose the immediate resolved item as `{base.title}`, `{base.lore}`, `{base.count}` and `{base.material}`. `ItemEditor` is shared by catalog fields and canvas properties; resetting a field restores inheritance without extracting the captured stack.

**2026-09-17 revision — the base lore is kept by default.** Keeping the base item's lore is what an author wants nearly every time, so it is no longer something to ask for: explicit lore is APPENDED below the base lore, `extends` included (it used to force replacement, which is why `{base.lore}` was sprinkled through catalogues and appearances nobody wrote it into). Dropping the base lore is an explicit act — `lore_mode: replace`, surfaced as a checkbox next to the lore field. `{base.lore}` stays available to place the base lore elsewhere in the lines; where it appears, it positions the lore instead of it being prepended, so nothing is ever rendered twice. Explicit empty lore only clears the lore under `lore_mode: replace`. A leading `{base.lore}` that now says exactly what the default says is stripped at project import (`normalizeBaseLore`).

### 1. Captured item — the universal item value

A **Captured item** is a project-level entity:

```
CapturedItem = {
  id, name,
  stack:   <opaque serialized ItemStack (Bukkit YAML)>   ← runtime truth, never interpreted by the editor
  display: { material, headTexture?, enchanted?, count?, name? }  ← derived ONCE at capture
}
```

The display descriptor is derived **generically** from vanilla components
(`custom_model_data`, `profile`, `enchantments`, `item_name`) — no per-plugin
branch. One optional enrichment at capture: ask the existing `CustomItemSource`s
to recognize the stack (`NexoItems.idFromItem` etc.); if recognized, `display
.material` becomes that custom ref (real 3D icon in the editor). Unrecognized
items degrade to base material + head/glint — still fully functional.

### 2. `item:<id>` — one more universal material ref

The material-ref grammar (`DIAMOND_SWORD` | `nexo:<id>` | …) gains `item:<id>`:
the editor renders the captured display descriptor; the plugin **deserializes the
stored stack** (exact NBT fidelity); the bundle exports the stack under the
project (`items/<id>.yml`). Templates, appearances, and the boutique `icon` field
all consume it identically — universality lives in the ref system, **never** in
per-item icon overrides at the set/menu layer (re-affirms the no-override rule of
`item-templates-and-data-library.md`).

**A ref is additive, not opaque** (2026-08-06). The referenced item keeps what it
says about itself, and the appearance layers on top of it:

| | Referenced item | Appearance | Result |
|---|---|---|---|
| lore | `Tranchante` | `Prix : 500` | `Tranchante` then `Prix : 500` — **appended** |
| name | `Épée du VIP` | `Offre du jour` | `Offre du jour` — the appearance **wins** |
| name | `Épée du VIP` | (none) | `Épée du VIP` |

A name can't concatenate, so the element wins there; lore can, and dropping the
item's own lines is exactly what made a ref feel lossy — a boutique icon lost
everything the captured item said. `MenuRenderer.buildItem` starts from the
resolved stack and appends (`MenuRendererCapturedLoreTest`); the canvas preview
mirrors it through `capturedPresentation` so the editor shows what the player
sees. This holds for **every** ref whose stack carries a presentation, `nexo:`
and friends included — the appearance is a layer, not a replacement.

Cutting the link stays a deliberate act: the **Extract details** button on an
appearance explodes the captured stack into editable fields, which is the only
way an author gives up following the item.

### 3. Capture flows

**Structured item values (2026-09-11).** A model field of kind `item` also accepts
`{ material: DIAMOND_SWORD, count: 3, enchants: { sharpness: 5 } }` using the
appearance's existing item attributes. Simple string refs remain valid.
`item: "{item.icon}"` evaluates a whole item value before applying the menu
appearance: explicit count (including 1) and title win; lore and enchantments
are added. Missing count preserves the referenced stack's amount. The catalog
edits this value directly, independently of the purchase's actions.
The editor exposes a typed data-item selector and inherited preview, with expressions behind an advanced disclosure. Legacy material expressions remain supported.

- **Inventory mirror** (editor-initiated): a WS request/response relay (same
  pattern as `data_source_fetch`) returns a player's inventory as display
  descriptors + opaque stacks; the editor shows it as a Library panel; dragging
  an item captures it into `Project.capturedItems`.
- **`/boutique additem <id> <prix> [catégorie]`** (in-game): the plugin captures
  the held stack (name/lore derived from the stack's own components) and writes
  it to its **own project root** — live in game within seconds via the disk scan.

  > **Revised on 2026-08-13 by the `server-disk-only-storage` ADR.** This ADR
  > sent the mutation to the backend, which put it in its copy of the project,
  > committed and rebroadcast `bundle_available` — "the plugin never writes
  > project files directly". That rule protected against a danger that no longer
  > exists: there is no backend copy to contradict anymore, hence no divergence
  > to fear. The module owns its root (ADR `addon-owned-project-roots`) and
  > writes there itself (`CapturedItemWriter`, Boutique repo); a capture is a
  > disk edit like any other, hot-reloaded by the scan.

### 4. Minecraft field kit for module forms

`<SchemaForm>` already routes custom widgets by `format`. The host ships a
standard MC widget kit every module gets for free by declaring its schema:
`material` (Library-backed ref picker), `item` (captured-item picker + inventory
mirror), `minimessage` (RevealField facade), `minimessage_multiline`, `actions`
(the steps/conditions editor), later `sound`/`permission`/`head`. Boutique's form
migrates onto it.

### 5. `actions` replaces `buy_commands`

Three bricks: (a) the steps/conditions pseudocode editor is refactored into a
**controlled component** (`value: Step[]` + `onChange`) so it works on module
data, not just store paths; (b) new `@Stable` module API
`api.actions.execute(player, steps)` — modules validate their business rule
(payment) then run the chain through the core engine; (c) boutique schema gains
`actions` with a mechanical migration (each legacy command → one `run_command`
step; `clickpermission` → a permission condition). Step texts are inline
literals in module data (no LText) for v1.

## Considered options

- **Per-plugin icon mappings** (nexo→ref, head→basehead, …) in the shop model:
  rejected — unbounded case list, lossy, and every new item plugin needs code.
- **Per-item icon overrides on the Item template/set**: rejected — re-introduces
  the maintainability hole closed by the templates ADR; icon identity is data.
- **Server-side registry instead of project entity** (`/artisan additem` writing
  plugin-side): rejected for authored content — not versioned with the project,
  needs the server online, and plugin-side writes to edited projects break the
  single source of truth (editorJson at the time; the file tree since ADR
  `files-first-source-of-truth` — the boutique mutation now patches files).
- **Compiling actions to command strings**: rejected — conditions/messages have
  no faithful command encoding; expose the real engine to modules instead.
