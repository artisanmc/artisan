# Artisan — Menu schema v1

Intermediate format of an Artisan menu. It is the **contract** between the web editor (`editor.artisanmc.net`) and the Minecraft plugin: as long as both sides respect this schema, they are decoupled.

## Files

| File | Role |
|---|---|
| `schema.json` | JSON Schema (Draft 2020-12), machine-validatable source of truth |
| `types.ts` | TypeScript types for the editor and the future MCP server |
| `examples/minimal.json` | Smallest valid menu (1 layer, 1 element). |
| `examples/shop-with-states.json` | Shop with conditional appearances (3 variants for the VIP button). |
| `examples/paginated-quests.json` | Paginated list with auto-bound prev/next buttons. |
| `examples/multi-paginated.json` | Two paginated lists in the same menu, explicit binding via `element_id`. |
| `examples/deco-with-conditional-button.json` | Flagship pattern: decoration layer + items layer, fall-through when a button is conditional. |
| `examples/data-driven-shop.json` | Iterative Element over a `contextInput` of type `list` populated by the `chestshop:items` data source — one slot per shop item, with conditional appearances on `{shop.rarity}`. |

## Vocabulary

To avoid confusion:

- **Position** (Minecraft): a location in the inventory, indexed from 0 to 53. What the game calls a "slot".
- **Element** (Artisan): the object manipulated by the admin (button, decoration, paginated list...). An Element occupies one or more positions and has one or more appearances.
- **Layer**: container that groups thematically related Elements (decoration, items, navigation...). Layers are ordered bottom→top and allow controlled overlap between layers.
- **Appearance**: visual variant of an Element. Evaluated in order, the first whose condition matches wins.
- **Bundle** (separate from the Project): signed runtime artifact that the plugin downloads from the CDN. A concept distinct from the project.

## Conceptual model

```
Menu
 ├── meta (schema, id, title, size, permission)
 ├── lifecycle (open_requirements, open_actions, close_actions)
 ├── background : Appearance     ← ultimate fallback when no layer renders
 └── layers : Layer[]            ← order bottom → top
       └── Layer
            ├── id (slug, e.g. "decoration")
            ├── name (shown in the editor)
            └── elements : Element[]
                  └── Element
                       ├── id           (stable, unique cross-layer)
                       ├── positions    ("15" or "10-43")
                       ├── <display fields>             ← flat on the Element
                       ├── states ?     : Appearance[]   ← tried BEFORE the display
                       ├── template_ref ?
                       └── tags ?
```

## Rendering semantics

For each position 0 to `size-1`, the engine does:

1. Walks the layers from **top to bottom** (`menu.layers` read in reverse order — last in the list = top)
2. For each layer, identifies the Element that claims this position (last-placed-wins on intra-layer overlap)
3. Evaluates the Element's `states` in order. **The first whose `if` passes wins** → render at this position, done for this slot
4. If no state passes, the **display** (the appearance fields carried flat by the Element) is rendered — it is the fallback, it always applies
5. No layer provides a rendered Element → render `menu.background` if defined, otherwise empty position (AIR)

## Design decisions

### First-class Layers

Layers are entities in their own right (`Layer` with id, name, elements), not just tags. Why:

- **Cross-menu copy-paste**: copy an entire layer from one menu to another, in one atomic operation
- **Layer Symbols / Templates** (V2): a "modern navigation" layer becomes an instantiable Symbol
- **Marketplace** (V3): a creator can sell a project "Medieval decoration layer"
- **Mental model**: Photoshop / Figma treat layers as containers with children

### Flat display + states, without partial override

The nominal case — one Element, one appearance — is written **without wrapping**: `material`, `title`,
`lore`, `click` are keys of the Element, as in other menu plugins. This is what
100% of real Elements use. The conditional alternatives live under `states`.

A state **replaces** the display, it does not complete it: what it does not write is **absent**,
never inherited. The merge ("the state only says what changes") was examined and rejected — it
requires inventing rules (clearing an inherited lore, merging the `click`s, partially redefining an
`nbt`) with no usage data to inform them. Benefits of replacement:

- Each appearance is self-contained (no "what do I inherit again?")
- More AI-friendly (reading one state is enough to know what is displayed)
- The engine takes the first state that matches, otherwise the display, period

Price to pay, accepted: a multi-state Element repeats the common fields. The editor does NOT hide
this price — "+ Add state" creates an **empty** state, and the stone block it immediately shows
teaches the semantics; "Duplicate" is the explicit gesture next to it.

See ADR `element-display-and-states`.

### No strict overlap validation

Within a single layer, two Elements can claim the same position: **last-placed-wins**, the editor shows a warning but does not block. This is more permissive than erroring, and lets the admin superimpose quickly without friction.

Between different layers, overlap is **intentional** (it is the fall-through pattern for conditional buttons + decoration underneath).

### Reference paths

- `pagination_next.element_id` / `pagination_prev.element_id` / `pagination_at_first.element_id` / `pagination_at_last.element_id` reference an Element by its `id` (cross-layer, unique in the menu).
- `template_ref.id` references a separately stored template.

### Retained choices

**`size` enum.** Limited to `{9, 18, 27, 36, 45, 54}` via `enum`.

**`custom_model_data` is a string.** 1.21.4+ only.

**`asset` vs `material`.** Both optional. Asset takes precedence if present (rendered via CMD string). Material alone = vanilla item. Neither = visibly AIR position (useful for purely structural Elements).

**Click `null` in an Appearance.** Means "explicitly non-clickable". If `click` is simply absent (undefined), the Appearance is not clickable either — `null` just makes the intent explicit for readability.

**Third-party components.** `ClickHandler = StandardClick | ComponentClick`, discriminated by `use_component_default`.

## Text field format

All text fields of the schema (`title`, `lore[]`, `send_message.text`, `broadcast.text`, `cooldown.message`, `give_item.name`, `give_item.lore[]`, etc.) follow a unified content convention:

- **MiniMessage format** (Adventure / Paper) — tags `<color>`, `<bold>`, `<gradient>`, `<click>`, `<hover>`, etc. See https://docs.advntr.dev/minimessage/format.html
- **Inline i18n reference**: `{i18n:menu.shop.title}` is resolved at runtime from the project's translations file (see `translations/v1`).
- **PAPI placeholders**: `%player_name%`, `%vault_eco_balance%`, `%args_target%` (if opened from a command), etc.
- **Legacy `§a` codes** accepted as input but converted to MiniMessage on save (backend canonicalization, project opt-out).

Resolution order on the plugin side: (1) `{i18n:...}` → value stored for the active language, (2) `%placeholder%` → resolved via PAPI, (3) final MiniMessage parse → Adventure Component sent to the player.

Schema: no change — the fields remain `string`. It is a content convention, validated and rendered by the editor and plugin engine.

**Translated lore.** `lore` is a list of lines, or a list of lines **per language** (`$defs/Lore`):

```yaml
lore:
  en: ["<gray>Members: <white>{r.members}", "", "<aqua>[Left click] <white>manage the permissions"]
  fr: ["<gray>Membres : <white>{r.members}", "", "<aqua>[Clic gauche] <white>gérer les permissions"]
```

Each language has its own number of lines; a missing language falls back as a whole to `defaultLang`. The legacy form (a `{ lang: text }` map per line) remains valid when reading, the editor no longer writes it.

## Menu context and data sources

Every data flow entering a menu — whether from the caller or from a third-party data source — goes through `Menu.contextInputs`. Each entry is a **named, typed slot** that the menu declares; its value can come from three sources:

- **Caller**: the command or parent menu passes the value at open time (auto-binding by name, see main-spec §15.4).
- **Data source**: the slot carries a `source: ConnectorBinding`; the engine calls the referenced data source and stores the result.
- **Default**: literal fallback value.

An Element becomes iterative by pointing `iterates: { source, alias }` to a slot of type `"list"` (whether the list comes from the caller or from a data source doesn't matter — it is opaque to the Element). Fields access the current item via `{alias.field}`. Concept detailed in `main-spec.md` section 14.

```json
{
  "contextInputs": [
    { "name": "category", "type": "string" },
    {
      "name": "shops",
      "type": "list",
      "source": {
        "ref": "chestshop:items",
        "filter": { "category": "{category}" },
        "sort": { "by": "price", "direction": "asc" },
        "limit": 28
      }
    }
  ],
  "layers": [{
    "id": "items",
    "elements": [{
      "id": "shop_grid",
      "positions": "10-43",
      "iterates": { "source": "shops", "alias": "shop" },
      "material": "{shop.material}",
      "title": "<gold>{shop.name}</gold>",
      "lore": ["<yellow>Prix : {shop.price} pièces</yellow>"],
      "click": { "left": { "actions": [{ "type": "run_command", "command": "cs buy {shop.id}" }] } },
      "states": [
        {
          "if": [{ "type": "placeholder_equals", "placeholder": "{shop.rarity}", "value": "legendary" }],
          "material": "{shop.material}",
          "title": "<gold>{shop.name}</gold>",
          "lore": ["<yellow>Prix : {shop.price} pièces</yellow>"],
          "enchanted": true,
          "click": { "left": { "actions": [{ "type": "run_command", "command": "cs buy {shop.id}" }] } }
        }
      ]
    }]
  }]
}
```

Rules:

- `iterates` and `appearance.component_ref` are **mutually exclusive** on a single Element. `validateMenuLayout` flags the errors.
- `iterates.source` must point to a declared `contextInput` of type `"list"`. `validateMenuLayout` flags the errors.
- `ConnectorBinding.source` is valid only on `type: "list"` and `type: "object"`.
- The `params` / `filter` values of the `ConnectorBinding` interpolate the menu's other `contextInputs` via `{name}`.
- No cycle in the dependencies between `contextInputs`: if `filter` references `{X}`, slot `X` must be resolvable upstream (caller or data source without circular dependency).
- Conditions on the fields of the iteration item: use `placeholder_equals` / `placeholder_match` with `{alias.field}` as the placeholder. The old `data_field_*` conditions have been removed.
- The `ref` namespace (`chestshop`, `essentials`, `jobs`, ...) is automatically added to `metadata.uses_plugins`.

## Back navigation (return)

The argument-less action **`open_previous_menu`** reopens the previous screen from the
player's history (menu **or** dialog). The history is a **LIFO stack**:
`open_menu` / `open_dialog` push the screen being left, `open_previous_menu` pops it
without pushing the current screen. Intended consequence: `menu → wiki → item`
returns to the menu in **two** backs, with no `item ↔ wiki` back-and-forth. Empty stack =
no-op. An `open_menu` to the screen just before (same id, args ignored) counts
as a back, so that a back button wired as `open_menu` does not loop.

```yaml
elements:
  - id: back
    positions: 0
    click:
      left:
        - open_previous_menu
    states:
      # The button only appears if there is a history: with no matching state,
      # the empty display leaves the position as AIR.
      - if:
          - expression: has_previous_menu
        material: ARROW
        title: { en: "Back", fr: "Retour" }
```

Placeholders available when rendering any screen: `{has_previous_menu}`
(boolean) and `{previous_menu.id}` / `{previous_menu.title}` (the previous screen).

## Refreshing after a module command

`set_arg` re-renders the current menu **without** the data it had fetched: its sources
are queried again. After a module command that changes this data (granting a
permission, promoting a member), chain:

```yaml
click:
  left:
    - run_command: "msguilds:rank_permission {rank_id} {p.key}"
    - set_arg: { arg: refresh, value: "1" }
```

`open_menu` to the same menu also queries the sources again, but pushes onto the history: the
back button would return to the same screen.

## Known limitations (cross-field, not expressible in JSON Schema)

To be validated at load by `validateMenuLayout` (see `types.ts`):

- Unique IDs cross-layer for Elements
- Unique IDs for Layers
- Positions in `[0, size)` for each Element
- Intra-layer overlap = warning (not an error)
- `pagination_*.element_id` must point to an existing Element — checked at publish by the editor
- range `"10-43"` consistent with a paginable `component_ref` — checked via the third-party plugin registry

## How to use it

### Editor side (TypeScript)
```ts
import type { Menu, Element, Layer, Appearance, Action } from "./schema/menu/v1/types";
import { validateMenuLayout } from "./schema/menu/v1/types";
import schema from "./schema/menu/v1/schema.json";
```

### Plugin side (Java)
Codegen from `schema.json` with `jsonschema2pojo`. When loading a menu, validate against the schema then apply `validateMenuLayout` (Java port).

### Local validation
```bash
npm install ajv ajv-formats
node validate.mjs
```

## Next steps on the schema side

1. **CI hook**: ajv on the examples on each PR.
2. **`template/v1` schema**: move the Template shape out of `types.ts` into its own JSON Schema.
3. **`pack/v1` schema**: already done, see `docs/schema/pack/v1/`.
4. **`command/v1` schema**: already done, see `docs/schema/command/v1/`.
5. **`translations/v1` schema**: already done, see `docs/schema/translations/v1/`.
6. **Java codegen** from `schema.json` for the plugin.
