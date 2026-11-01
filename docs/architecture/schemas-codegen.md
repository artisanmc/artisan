# Schemas & types — source of truth, hand-written types, ajv enforcement

## Source of truth

For each versioned schema, the truth is the file `docs/schema/<name>/v1/schema.json` (JSON Schema **2020-12**). Everything else (Kotlin types, TS types, examples, fixtures) must conform to this file.

The `description`s are in **English** and short: `get_kind_guide` (MCP, assistant) shows them to the model, line by line (`SchemaOutline`). A shape kept for reading only carries a description that starts with `Legacy` or `LEGACY` (or a `$defs` named `…Legacy`): the outline leaves it out.

## Hand-written types

The types are **not generated** — they are **written by hand** in both languages, faithfully modeling the schema's discriminated unions:

- **Plugin (Kotlin)**: `sealed class` with one `data class` subclass per variant (e.g. `Condition`/`Action` → one typed subclass per `type`), Jackson polymorphic deserialization (`@JsonTypeInfo(use = NAME, property = "type")` + `@JsonSubTypes`).
- **Editor (TS)**: discriminated unions (`type Condition = HasPermission | HasMoney | …`), one interface per variant, literal `type` discriminant.

**Quicktype was evaluated and rejected (NO-GO)**: it flattens `oneOf`s discriminated by `const` into a single god-object `data class`/`interface` (all fields nullable), with no subclasses or Jackson annotations, and crashes on a boolean `const`. Details and full verdict in `docs/schema/CODEGEN.md`. No code generation.

## Enforcement

`menu/v1` accepts optional appearance `image: { asset: <project asset id>, fit?: native | contain | stretch, offset_x?: integer, offset_y?: integer }`,
mutually exclusive with `material` and `item`; omitted fit means `contain`.
Offsets default to zero, are bounded to ±4096 pixels and move the centered image
inside its clipped footprint. New editor buttons explicitly use `native`.
This additive field uses the existing v1 appearance format and requires an updated
plugin for rendering. Editor, canonical TS and Kotlin types mirror it manually.
`menu/v1/imageButtons.ts` supplies shared semantic checks to the editor (pack builder included):
fixed, in-bounds rectangular positions without overlap (including other layers).
Comma-separated ranges and YAML position lists support vertical rectangles.
`menuImageButton.test.ts`, `imageButtons.test.ts` and `MenuRendererImageButtonTest`
cover serialization, resource-pack generation, conditional images and clicks.

`menu/v1` carries `$defs/Lore` (2026-10-24, additive): an appearance's `lore` accepts, in addition to the list of `LText`, a list of lines per language `{ <lang>: string[] }`. Types: `Lore` in `menu/v1/types.ts`, `LoreDeserializer` on the plugin side (same `List<LocalizedText>`, one block per language joined by `\n`). Tests: `FieldLocalTextTest`, `menuV1ToDomain.test.ts`, `projectToFilesInline.test.ts`.

`menu/v1` carries `lore_mode: replace` on appearances. Without this field, explicit lore is ADDED under the base's lore. `item` data values compose recursively `{ extends: <ref or item>, title?, lore?, count?, ... }`: missing fields inherited, lore added the same way. `{base.title}`, `{base.lore}`, `{base.count}` and `{base.material}` designate the immediately resolved base; writing `{base.lore}` positions the base lore instead of leaving it first (never both). An empty lore only clears the inherited lore under `lore_mode: replace`; resolution is bounded to 32 levels.

In an `item` model field, `title` and `lore` are i18n sites, including under `extends`. `itemTextFields.ts` defines the sites walked at import and rekey; export writes the default language's literals and the translations at their canonical addresses.

`menu/v1` carries `$defs/Template` and `$defs/Location` (2026-11-01, additive, ADR `triggers-and-variables` §4, §6): every `number`, `integer` and `boolean` action argument is `anyOf [type, Template]` (a string holding `{` or `%`, resolved when the action runs), a location is `world x y z [yaw pitch]` or an object whose coordinates may be templates. `CoreActionSchemaConformanceTest` reads such an `anyOf` as the argument's kind. The `variable/v1` schema (`docs/schema/variable/v1/`) references `$defs/Location` for a default; its examples are validated by `modules/variables/variables.test.tsx`.

`menu/v1` also carries `Appearance.item` (binding to a full item), exclusive with `material`. Schema and types: `docs/schema/menu/v1/`. Tests: `menuItemBinding.test.ts` and `MenuRendererItemValueTest`.

### `menu/v2` and `menu/v3` folded into `menu/v1` (2026-09-17)

The two versions lived six days, long enough to add `Appearance.item` then `lore_mode`. Their
migrations (`MenuV1ToV2`, `MenuV2ToV3`) were a `data.copy(schema = to)`: **zero transformation**,
so three names for a single format, a version-choice ternary at export and three JSON schemas
compiled on the validator side. Both fields were folded into `menu/v1` and the `v2`/`v3` folders
deleted.

This is an **explicit exception to the forward-only rule** below ("a schema is never modified
after shipping"). It holds because no data was transformed and the two versions
had not outlived the week of their release. The price paid is a **permanent read
tolerance**: `menu/v2` and `menu/v3` remain accepted by the plugin reader (`ProjectReader.menuSchemaVersions`)
and by both validators (`LEGACY_VERSIONS`), because projects carrying these labels are
on server disks. Writing only emits `menu/v1` now. Do not replay this fold: the
next schema version that transforms anything is definitively acquired.

Types ↔ schema consistency is **not** guaranteed by codegen but by validation:

- **ajv** validator (draft 2020-12): `editor/src/schema/validateMenuV1.ts` + `editor/src/schema/validateMenuV1.test.ts`.
- Canonical examples: `docs/schema/menu/v1/examples/*.json` (at least one per union variant + complete menus).
- **Action DSL phase 2 (2026-07-21)**: click action chains (`ClickHandler.steps`, `open_actions`/`close_actions`, `command.steps`, dialog button actions) are now an **Action DSL string** (see ADR `action-dsl`), no longer a structured `{kind,action|cases}` array. The plugin reads the string through the `actiondsl` codec → `DslToEngine`; `StepParser`/`ActionParser`/`ConditionParser` (Map→object) remain only for non-migrated paths (appearance `if`, `requirements`, `fallback`, module API). **In-place `menu/v1`** change (not in prod yet).
- **Format ergonomics, slice ① (2026-07-23)**: `command/v1` — canonical field **`actions`** (DSL string; `steps` = legacy alias accepted on read), optional `name` (defaults to `id`, export only writes it if it differs). `menu/v1` — **collapsed** click handler: `click.left: "<dsl>"` directly (legacy `{steps}` form accepted). Writers (editor `schema/*V1FromDomain.ts`, then `transform.ts`) emit the canonical forms; readers tolerant on all 3 layers (editor `*ToDomain`, backend `projectImport`, plugin Jackson delegating `@JsonCreator` + `CommandYaml.actions: Any?` disambiguated by type). See spec `2026-07-23-menu-format-ergonomics.md`.
- **Format ergonomics, slices ②–③ (2026-07-23)**: `menu/v1` — **flattened layers**: canonical form = flat top-level `elements` list (document order = stacking, last wins per slot; legacy `layers` envelope accepted on read, editor domain keeps `Layer`, flat import → one default layer). **Title**: string sugar (`title: "Shop"` = one plain layer) emitted when the title is a single plain layer with no color; **a single LText string form** (`"{i18n:key}"` or literal) for layers' `value` — the `{key}` object form becomes import-only; bare string entries in a layers array = plain layers. Readers tolerant of both forms (`titleLayer` in `menuV1ToDomain.ts` on the editor side, `MenuTitleParser.parseLText` on the plugin side).
- **Format ergonomics, slices ④–⑤ (2026-07-23)**: `positions` accepts bare int / bare range / mixed YAML list (normalized to a spec string by `positionsSpec` on all 3 layers; export emits a bare int for a single slot). `context_inputs` → **`inputs`** (canonical, optional; legacy accepted everywhere — plugin `@JsonAlias`). **Direct ref sugar**: `iterates.source` / `places.source` accept a source ref (`ns:id` / `pack:id`) without an input declaration — resolved once per `MenuRenderer.open` (exposed under its own args key), dangling ref = silently empty list (non-hermetic). `inputs` remains for: parameter signature (Command primitives), shared shaping, editor typing/autocomplete.
- **`appearances` removed in favor of display + `states` (2026-08-17)**: an Element carries its **flat display** (`material`, `title`, `lore`, `click`… at the top level, like other menu plugins) and its guarded alternatives under **`states`** — tried in order BEFORE the display, which is the fallback. A state **replaces**, it inherits nothing (merge examined and rejected). `menu/v1` mutated in place, **with no read shim**: `appearances` is no longer read anywhere, deployed menus were rewritten (the plugin only ran on the test server). Schema: `Element` = `allOf AppearanceFields` + structural keys + `unevaluatedProperties: false`; `states[]` = `$defs/State` (Appearance + required `if`, otherwise the state would mask the display forever). Shared namespace locked by `testdata/element-structural-keys.json` (editor + plugin suites). Compilation in RESOLUTION order (states then display) with i18n ADDRESSES unchanged (`default` = display, `stateN` = `states[N-1]`): no `lang/` key moves. See ADR `element-display-and-states`.
- **Item templates REMOVED (2026-07-31)**: `template/v1` and the `docs/schema/template/` folder no longer exist, `menu/v1` loses `iterates.template` / `places.template` / `template_ref` (accepted mutation, no v2 — see ADR `item-templates-and-data-library` revision 2026-07-31). An appearance belongs to the menu that renders it: the element always carries its `appearances`. A legacy `templates/` on disk is **inlined at editor import** (`projectFromFiles`, `item_templates.*` keys re-addressed to `menus.<m>.elements.<el>.*`, locked by `templateMigration.test.ts`) and never rewritten; `ProjectReader.resolveTemplates` keeps reading on the plugin side for compat until deployed servers are re-saved. The P2a entry below is therefore **historical**.
- **P2a file templates (2026-07-23)**: new **`template/v1`** (`docs/schema/template/v1/`) — `templates/<id>.yaml` carries source/alias/key_field/group_by/appearances; linked elements emit a **ref** `iterates.template` / `places.template` (no more inline, `appearances` optional on Element). Resolution **at plugin load** (`ProjectReader.resolveTemplates` → effective elements, template-unaware compiler/renderer); hand-editing a template + reload = all consuming menus follow. Backend imports `templates/` → `itemTemplates` + refs → `templateId` (fix along the way: `places` was lost at backend import). `manifest.files.templates` additive; menu/v1: `Places` def added, `Iterates.source` without pattern (direct refs). **P2b file models**: new **`model/v1`** (`docs/schema/model/v1/`) — `models/<id>.yaml` carries the fields **verbatim** (cross-model refs preserved) = the editor's lossless store; `data/<id>.yaml` remains denormalized/self-contained for the runtime, the plugin ignores `models/`. Backend imports `models/` → `dataModels`. **P3a files-first (2026-07-24)**: the full-project importer now lives **on the editor side** (`editor/src/schema/projectFromFiles.ts`, exact inverse of `transform()`, locked by the fixed-point `projectFromFiles.test.ts`); the backend mirror `projectImport.ts` is deleted (`lib/projectFiles.ts` remains for `readOwnerModuleFromFiles`). The `data/` gap is closed: `data/v1` gains `name` (display name) and `model` (lossless back-ref table → `models/<id>.yaml`, **ignored by the plugin**); import retypes rows via the model (ltext → LText). Captured items' metadata (`name` + `display`) lives in `.artisan/editor.yaml` (`items:` section, hash-excluded); a data file without `model:` → synthesized model `mdl_<sourceId>` from the flattened fields (canonicalized at the next export). **Composable-data-models slice 1 (2026-07-25, same-named ADR)**: `model/v1` + `data/v1` gain the kinds **`map`** (`of`), **`enum`** (`values`), **`union`** (`tag` + `variants[{name, fields}]`) — denormalized **inline** in data/v1 (the plugin walks value+schema, ltext localized at any depth, variant chosen by the tag, model-blind unchanged). **Per-row granularity**: `data/<id>/` = `_source.yaml` (meta + fields + `order:`) + one file per row named by the slugified Row key; a file added by hand outside `order` = appended (byte sort); 3-layer readers (transform/projectFromFiles/ProjectReader). Fix along the way: Table UI rows/list items are keyed by identity (Row key), no longer by index — the "items mixed between categories" bug. **Slice 2 (same day)**: declaration channel — `api.models.declare(model/v1)` plugin-side (opaque passthrough) → `hello.declared_models` → `server_declared_models` table (migration 0026, upsert+prune mirroring data_sources) → `GET …/servers/:sid/models` → injection at editor load (`injectDeclaredModels`: `module` provenance, read-only shape, replaces stale copies, NEVER emitted into `models/`); `model/v1` gains `version` + `migrations` (not declarative: rename_field/set_default/rename_enum_value/rename_variant — closed vocabulary, unknown op ignored); `data/v1` gains `model_version` (version under which the rows were written); `domain/modelMigrations.ts` engine applied at load when `model_version` lags, materialized at the next save. **Slice 3 (same day)**: `model/v1` fields carry the hints (`label`/`help`/`section`) + validation (`required`/`default`/`min`/`max`/`pattern`/`locked`) — asymmetric enforcement (blocking in the form: min/max clamp, enum select, locked read-only; hand-edit = flagged `aria-invalid` never rewritten); `master_detail` (model-level) switches the Table to list+form; new kind **`conditions`** (core vocabulary §6 — values = wire Condition[] via the single codec, edited with the appearances' ConditionListEditor, opaque to the runtime).
- **Declared actions (2026-10-26)**: `$defs.Action` gains one last branch for the actions the server declares at runtime: a single-key object, named either with a namespace (`^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$`, `guilds:rank_delete`: add-ons prefix all of theirs), or `module_command` or `cancel_event` (the two Artisan declares without a prefix). Its arguments are not checked by the schema. A misspelled core name (`send_mesage`) is still refused; a misspelled prefixed name (`guilds:rank_delet`) passes, only execution flags it. No branch for conditions: a module declares none. Additive. `CoreActionSchemaConformanceTest` ignores this branch (no `required`). Needed since Deploy goes through `DocumentCheck` (ADR `mcp-server`, decision 8): without it, the MSGuilds and artisan-attribution menus were refused.
- CI: `.github/workflows/schema.yml` validates the examples against `schema.json` on every PR (no codegen-drift step — truth = schema + ajv).

> **Editor side (P1.1 ✅)**: export emits the canonical `menu/v1` form and a "golden pack → export → ajv" oracle (`editor/src/schema/projectToFilesCanonical.test.ts`) proves conformance; `docs/schema/menu/v1/types.ts` is aligned with the schema.
> **Plugin side (P1.2 ✅)**: parsing conforms to the canonical form. The only gap introduced by P1.1 was fixed: `ConditionParser` now reads `of` (not `all`/`any`) for composite `and`/`or` conditions. A cross-stack oracle (`plugin/core/src/test/kotlin/net/artisanmc/plugin/engine/CanonicalConformanceTest.kt`) parses the editor's canonical examples (`docs/schema/menu/v1/examples/canonical-button.json`, `canonical-conditional.json`) through `MenuCompiler` without error. Parsing stays tolerant on read (title string-or-array, `if` map-or-array).

## `data/v1` schema (Project sources, since 2026-07-20)

`docs/schema/data/v1/schema.json` describes a Project's `data/<source_id>.yaml` files (Project sources, ADR `project-sources-and-data-models`): `{ schema, id, shape: table|config, key_field?, fields, rows?|value? }`, concrete kinds only (the editor's Data models are inlined at export — no `model` kind in the wire). Enforcement: export oracle `editor/src/schema/dataV1FromDomain.test.ts` (domain → `projectToFiles` → expected shape) + plugin parse oracle `plugin/core/src/test/kotlin/net/artisanmc/plugin/ProjectDataSourceTest.kt` (YAML fixtures → `ProjectReader`/`RuntimeDataSource`, ltext localization). Examples: `docs/schema/data/v1/examples/*.yaml`.

## Modification rule

Modifying a `docs/schema/*/v1/schema.json` ⇒ in the same move:

1. Align the hand-written types (editor **and** plugin).
2. Keep the examples / fixtures green (`editor/src/schema/validateMenuV1`).
3. Never edit an already-shipped `v1` schema in a breaking way — create a `v2` (see `docs/architecture/versioning.md`).

## Documented runtime gaps

**Closed (2026-06-11)**:

- ✅ `if` branches of a click step-tree — `StepParser` + `ActionExecutor.executeSteps`
  (cases/joins/else, joins left→right without precedence), menus **and** commands;
- ✅ `set_arg` / `set_arg_cycle_next` / `set_arg_cycle_prev` actions — mutation of the
  context args + re-render of the current menu; the context is folded from action to action within a
  single click;
- ✅ `context_inputs` + `iterates` (Phase A, plan `2026-06-11-data-driven-runtime-A-iteration.md`) —
  `ContextBinder` (§15.4: the caller wins, defaults coerced), windowed rendering per page
  (pageSize = the element's slots), `{alias.field}` via `ArgResolver` (material included),
  per-slot item scope at click (`MenuSession.slotArgs`);
- ✅ pagination — `pagination_next/prev` advance/go back with clamp + re-render;
  real `pagination_at_first/last` (state in `ExecutionContext.pagination`/`pageInfo`,
  no `MenuProvider` interface change).
- ✅ back navigation — `open_previous_menu` (LIFO stack per player, menus + dialogs) and
  `has_previous_menu` / `previous_menu.*` placeholders; `menu/v1` vocabulary extended, no
  breaking change (see `action-steps.md` §open_previous_menu).

**Remaining** (the plugin does not execute them yet — separate projects):

- top-level `open_requirements` / `open_actions` / `close_actions` / `background`
  (implemented nowhere: neither editor domain nor runtime — rejected by the assistant gate).

The schema describes them (the editor can produce/validate some), but the plugin runtime
ignores them until the dedicated projects ship.

## Additive `menu/v1` fields — manual alignment

Fields added after the P1.0 schema freeze, aligned by hand on the three layers:

| Field | Schema type | `docs/schema/menu/v1/types.ts` | `editor/src/domain/types.ts` | Plugin (`AppearanceYaml`) |
|---|---|---|---|---|
| `Appearance.head` | `string` (optional) | `head?: string` | `head?: string` | `val head: String?` |

The three prefixes recognized by `HeadRef` (plugin): `hdb:<id>`, `basehead:<base64>`, `playerhead:<name>` (placeholder-aware, e.g. `%player%`). A raw `eyJ…` value without a prefix is tolerated as `basehead`. The field is only honored when `material` is `PLAYER_HEAD`.

### Advanced item details (2026-07-29)

Seven **optional additive fields** on `Appearance`, all applied by `net.artisanmc.plugin.render.ItemDetails`:

| Wire field | Editor domain | Plugin (`AppearanceYaml`) |
|---|---|---|
| `enchants` (map `{id: level}`, list `[{id, level}]` on read) | `enchants?: ItemEnchant[]` | `val enchants: Any?` |
| `enchanted` (bool) | `enchanted?: boolean` | `val enchanted: Boolean` |
| `custom_model_data` (string) | `customModelData?: string` | `val customModelData: String?` |
| `unbreakable` (bool) | `unbreakable?: boolean` | `val unbreakable: Boolean` |
| `hide` (enum[]) | `hide?: ItemHideFlag[]` | `val hide: List<String>` |
| `color` (`#rrggbb`) | `color?: string` | `val color: String?` |
| `nbt` (SNBT) | `nbt?: string` | `val nbt: String?` |

`enchanted` and `custom_model_data` had been declared in the schema since P1.0 but were **dead** (neither carried by `AppearanceYaml` nor applied by `MenuRenderer.buildItem`) — this slice finally implements them rather than introducing competing names.

Conventions shared between the editor (`editor/src/domain/itemAdvanced.ts`) and the plugin (`ItemDetails.kt`), which **mirror** each other — changing one requires changing the other:

- **Enchantment ids tolerant on read**: `sharpness`, `minecraft:sharpness`, `SHARPNESS`, legacy Bukkit `DAMAGE_ALL`. The canonical form written is always the short id in a map. An id unknown to the server is **ignored with a WARN** (never a menu error).
- **Levels beyond the vanilla max allowed** (`ignoreLevelRestriction`) — servers use them; the UI only warns.
- **`enchanted` is omitted on write when `enchants` is non-empty**: real enchantments already glow, the flag only has meaning alone.
- **`hide`**: short spelling (`attributes`) canonical, Bukkit spelling (`HIDE_ATTRIBUTES`) and the old `HIDE_POTION_EFFECTS` → `additional` accepted on read.
- **`nbt`**: applied **last**, after everything else, via `Bukkit.getUnsafe().modifyItemStack` (deprecated API — only way on 1.21.4). Best-effort: a refused SNBT is logged as WARN and the item is rendered without it, never blanked.
- **`color`**: only has an effect on `LeatherArmorMeta` / `PotionMeta`; on any other material it is silently moot (not an error). The editor only shows the field for dyeable materials (`isColorable`).

Kept in **`menu/v1`**: purely additive and optional, therefore non-breaking (see `versioning.md`).

**Captured item extraction** — `editor/src/domain/capturedStack.ts` reads these same details from the `stackYaml` of a captured item (the Bukkit ItemStack serialized verbatim). It handles the **two forms** of serialization in circulation: legacy Bukkit (`type`/`amount`/`meta{enchants, ItemFlags, custom-model-data, color}`) and modern Paper (`id`/`count`/`components{minecraft:enchantments, …}`, with or without the `levels` envelope removed in 1.21.5). A third form adds to the previous two: **string-encoded components** (`minecraft:enchantments: '{"minecraft:sharpness":5}'`) — this is what Paper actually produces. `decodeComponent` decodes them (strict JSON, then an SNBT tolerance pass for bare keys and type suffixes like `5s`/`1b`); `custom_name` and `item_name` are **text** components and stay out of decoding. No plugin round trip is needed: everything is already in the YAML. Parsing is memoized (`capturedStackDetails`) because `resolveDisplayRef` calls it per rendered slot.

`readCapturedItems` (import, `projectFromFiles.ts`) has derived its display descriptor through this same parser since 2026-07-29 — previously it was regexes on the raw YAML (`"nexo:id":"…"`, `text: "…"`) that did not match the encoded form. **Precedence is unchanged**: `.artisan/editor.yaml` `items:` remains authoritative when present, because it records what the capture panel displayed — including a material enriched by the plugin's custom-item reverse lookup, which the stack alone does not always express. Derivation only serves files added by hand or written by a module.

### `inventory_type` (Chest / Hopper / Dropper)

**Optional additive** field at the menu level (`menu/v1`): `inventory_type ∈ {chest, hopper, dropper}`, **default `chest`**. **Missing ⇒ chest** → full back-compat: all existing menus remain chests with no data migration.

Schema changes (additive, non-breaking):

- `inventory_type`: optional enum (`default: "chest"`).
- `size`: enum relaxed to `[5, 9, 18, 27, 36, 45, 54]` (adding `5` for the hopper).
- `allOf` cross-validation: `chest` ⇒ `size` a multiple of 9; `hopper` ⇒ `size = 5`; `dropper` ⇒ `size = 9`.

Kept in **`menu/v1`** (no `v2` folder): the addition is additive and non-breaking, so the "new schema version = new folder" rule (which targets *breaking* changes) does not apply — see `docs/architecture/versioning.md`.

Types aligned by hand on the three layers:

| Layer | Source |
|---|---|
| Editor type | `InventoryType` in `editor/src/domain/types.ts` |
| Geometry (single source of truth) | `INVENTORY_TYPES` table in `editor/src/features/canvas/inventoryTypes.ts` (fixed cols, rows, slot-0 origin in MC px, box height, texture key, Bukkit type) |
| Plugin | `MenuYaml.inventoryType` (default `chest`) |

Export (`menuV1FromDomain`): emits `inventory_type` **only if ≠ chest**, and `size = slotCount(type, rows)`. Import (`menuV1ToDomain`): reads it (default `chest`) and computes rows per type. Plugin: `MenuRenderer` creates the inventory via `InventoryType.HOPPER`/`DROPPER` for non-chest types (branches on the **type**, not the size — dropper = 9 slots like a 1-row chest).

### `player_inventory` (bottom of the window, 2026-09-25)

**Optional additive** field at the menu level: `player_inventory ∈ {visible, hidden}`, **default
`visible`** — existing menus do not change. `hidden`: positions `size..size+35` designate
the player slots (protocol rawSlot, 27 main then 9 hotbar) and the bottom only shows the menu's
buttons. The schema does not bound the positions (JSON Schema does not compare to `size`): the bound
lives in `validateMenuLayout` (`types.ts`) and in the editor (`positionCount`).

| Layer | Source |
|---|---|
| Editor type | `PlayerInventoryMode`, `Menu.playerInventory` (stored only if `hidden`) |
| Geometry | `positionCount`, `slotMcXY(i, type, rows)`, `positionToCell`/`cellToPosition` in `inventoryTypes.ts` (`playerInvY` per type) |
| Plugin | `MenuYaml.playerInventory` → `PlayerInventoryMode` → `MenuSlots.slotLimit` |

Export: emitted **only if `hidden`**. Kept in `menu/v1` (additive). Runtime: see
`invariants.md` "Menu content only exists client-side".

### `vanilla_texture` (transparent container background, 2026-09-25)

**Optional additive** boolean, **default `true`**. `false`: transparent window
in game (chest, hopper or dropper), the menu brings its texture through title glyphs. Editor domain
`Menu.vanillaTexture?: false` (stored only at `false`), export emitted only at `false`, plugin
`MenuYaml.vanillaTexture`. Effects outside the menu (pack + re-injection on other chests):
`invariants.md` "Transparent containers: global on the pack side, reinjected via the title".

## Status / phasing

| Phase | Scope | Status |
|---|---|---|
| **P1.0** | `menu/v1`: canonical schema + ajv validator + CI | ✅ done |
| **P1.1** | Editor conformance (canonical `menu/v1` export + `types.ts` aligned with the schema + ajv oracle `editor/src/schema/projectToFilesCanonical.test.ts`) | ✅ done |
| **P1.2** | Plugin conformance (`ConditionParser` reads `of` for `and`/`or` + cross-stack oracle "editor examples compile in the plugin") | ✅ done |
| **P2** | `command` / `dialog` / `translations` / `manifest` / `template` (same treatment) | to do |
