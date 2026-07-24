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

### 3. Capture flows

- **Inventory mirror** (editor-initiated): a WS request/response relay (same
  pattern as `data_source_fetch`) returns a player's inventory as display
  descriptors + opaque stacks; the editor shows it as a Library panel; dragging
  an item captures it into `Project.capturedItems`.
- **`/boutique additem <id> <prix> [catégorie]`** (in-game): the plugin captures
  the held stack (name/lore derived from the stack's own components) and sends a
  WS mutation; the **backend boutique module applies it to
  `moduleData.boutique`** (single source of truth respected), commits and
  broadcasts `bundle_available` — live in game within seconds. The plugin never
  writes project files directly (the FTP/local_push hazard on edited projects);
  a concurrently-editing editor surfaces the existing version-conflict banner.

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
