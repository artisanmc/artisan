# Artisan — Translations schema v1

Format of the translations of an Artisan project. A **key** = a translatable text scoped to the project, referenced from menus and commands via the inline syntax `{i18n:<key>}`.

## Vocabulary

| Term | Meaning |
|---|---|
| **i18n key** | Hierarchical slug identifier (`menu.shop_main.btn_buy.title`). Stable, unique within the project. |
| **Translation** | Value of a key for a given language. **MiniMessage** format (see below). |
| **default_lang** | Reference language of the project. Every key must have it. Ultimate fallback if another language is missing. |
| **Project scope** | Keys live at the admin's project level, not per menu. No sharing between admins. |

## Files

| File | Role |
|---|---|
| `schema.json` | JSON Schema Draft 2020-12, machine-validatable source of truth |
| `types.ts` | TypeScript types + helpers (validateTranslations, extractI18nRefs, generateAutoKey, ...) |
| `examples/minimal.json` | 2-language project (fr, en) with 5 keys. |
| `examples/full-project.json` | 4-language project with a translated shop menu + commands. |

## Content format: MiniMessage

All translation values are in **MiniMessage** (Adventure / Paper text format):

```
<gold><bold>Boutique</bold></gold>
<gray>Achète ce <green>diamant</green> pour <yellow>%vault_eco_balance%</yellow> pièces</gray>
```

Resources:
- Official documentation: https://docs.advntr.dev/minimessage/format.html
- Try it: https://webui.advntr.dev/

**Legacy codes** (`§a`, `&a`) are **accepted as input** for the admin who pastes a text from another plugin, but are **converted to MiniMessage on save** (backend canonicalization, opt-out possible in the project settings).

## Referencing from menus / commands

Any text field of a menu (`title`, `lore[]`, `send_message.text`, `broadcast.text`, `cooldown.message`, etc.) or of a command (`description`, `cooldown.message`, etc.) can contain `{i18n:key}` references freely mixed with static text, MiniMessage codes, and PAPI placeholders.

```json
{
  "title": "{i18n:menu.shop_main.title}",
  "lore": [
    "{i18n:menu.shop_main.btn_buy.lore.0}",
    "<gray>Prix : <yellow>%vault_eco_balance%</yellow> pièces</gray>"
  ]
}
```

### `inline` mode: the literal IS the reference (since 2026-08-03)

A project can also be written without any reference: the field carries the **literal text of the default language**, and the other languages live in `lang/<code>.yaml` at the field's **canonical address** — the address the plugin re-derives from the file structure (`menus.shop.elements.buy.default.title`, `commands.give.message`, `dialogs.confirm.buttons.ok.label`…). There is then no file for the default language: the document already carries it.

```yaml
# menus/shop.yaml (inline mode)          # lang/fr.yaml
title: Shop                              menus:
elements:                                  shop:
  - id: buy                                  title: Boutique
    title: Sword                             elements:
    click: { left: send_message "Bought!" }    buy:
                                                 default:
                                                   title: Épée
                                                   click: { left: { message: Acheté ! } }
```

Both forms are read interchangeably, including mixed within a single file. The choice is a project mode (`.artisan/editor.yaml` → `i18n_mode`), not a field property. The addressing scheme is locked cross-language by `testdata/i18n-address-conformance.json`. See ADR `files-first-source-of-truth` §4.

## Resolution order at runtime

On the Minecraft plugin side, when a menu opens or a command runs, each text field is resolved in this order:

1. **i18n**: `{i18n:key}` → value stored for the player's active language. Without an explicit reference, the **literal is looked up at the canonical address** of its field (`inline` mode); if there is nothing, it is taken as written. Fallback to `default_lang` if missing. Fallback to empty text + warning log if also missing in default.
2. **PlaceholderAPI**: `%player_name%`, `%vault_eco_balance%`, `%args_target%`, etc. → resolved via PAPI with the current player context.
3. **MiniMessage parse**: tags `<color>`, `<bold>`, `<gradient>`, etc. → final Adventure Component sent to the client.

Consequence: a **translation can itself contain** placeholders and MiniMessage tags. Very flexible.

```
Key "menu.shop.welcome" in FR: "<green>Bienvenue, %player_name% !</green>"
                       in EN: "<green>Welcome, %player_name%!</green>"
```

## Determining the player's active language

Three modes configurable on the plugin side (`config.yml`):

| Mode | Behavior |
|---|---|
| `server_default` | The whole server speaks a single language (the project's default_lang, or config override). |
| `per_player_locale` *(recommended)* | Language derived from `Player#locale()` (Minecraft client locale). Mapped to the closest project language, fallback default. |
| `per_player_placeholder` | Language derived from a custom PAPI placeholder (e.g. `%player_lang%` if the admin already has a `/lang` command via another plugin). |

The plugin loads all translations into memory at sync (the `i18n/<lang>.json` files of the runtime bundle).

## Generated file format (bundle side)

On each sync, the runtime bundle downloaded by the plugin contains an `i18n/` subfolder:

```
bundle.zip
├── menus/
├── commands/
├── assets/
└── i18n/
    ├── fr.json         ← language by language, flat format
    ├── en.json
    └── de.json
```

Format of each file (O(1) lookup on the plugin side):

```json
{
  "menu.shop_main.title": "<gold><bold>Boutique</bold></gold>",
  "menu.shop_main.btn_buy.title": "<green>Acheter</green>",
  "menu.shop_main.btn_buy.lore.0": "<gray>Achète cet item</gray>"
}
```

Notes:
- We do **not** use vanilla Minecraft's `translatable_key` system (which would go through the resource pack's `lang/<locale>.json` on the client side). Our server-side approach is more flexible: we choose the language, compose with PAPI, log missing keys.
- The bundle includes **all** the project's keys, even those not referenced by the menus active on this server. Negligible storage cost, simple generation.

## Editor UX

On any text field of the dashboard (menu title, Element lore, send_message text, command description, etc.):

1. **Type freely**: no need to use i18n if you don't want to. Direct text works (rendered literally for all players).
2. **Insert a key**: the `{` key triggers a fuzzy autocomplete on the project's keys. Selecting inserts `{i18n:key}` at the cursor. The `</>` button on the right opens a popover with search + a "+ New key" button.
3. **Create a new key inline**: "+ New key" automatically extracts the text currently in the field as the default value (reference language), pre-fills the key with an auto-generated slug based on context (`menu.<menu_id>.<element_id>.title`), and lets you edit the key (with live uniqueness validation).
4. **Edit an existing translation**: click on the highlighted key in the field → mini-modal with the values per language and a live MiniMessage preview alongside.
5. **Detach a key**: replaces `{i18n:key}` with the current value in plain text. The key stays in the project for other usages.

## Auto-extract of existing text

Most natural workflow: you type "Boutique" in the title field, you click "+ New key", the editor:

1. Creates the key `menu.shop_main.title` with FR value = `"Boutique"`.
2. Replaces the field content with `{i18n:menu.shop_main.title}`.
3. Opens the mini-modal to add other languages (optional).

No manual manipulation of the translations file.

## Conflicts on `.itfz` pack import

When an imported pack contains a `translations.json` file, the import merges into the target project:

- **Key absent** locally → added.
- **Key present, identical values** in all languages → ignored (no-op).
- **Key present, different value in at least one language** → conflict. The admin chooses in a dialog:
  1. *Keep local*: the import skips this key. Imported menus reference the local value (may be surprising if it is semantically different).
  2. *Overwrite with the import*: the local value is replaced. All existing references outside the imported pack see the new text.
  3. *Rename the imported key*: auto-prefix with the `pack.id` (`questx.menu.shop_main.title`). The pack's menus are rewritten on import to point to the new key.

The default option is **rename** — the least destructive.

## Validation

On save in the project, the backend checks via `validateTranslations`:

- `default_lang` is in `languages[]`.
- Each key has at least the `default_lang`.
- Language codes follow BCP-47-light (`fr`, `en_US`, etc.).
- Keys follow the hierarchical slug (`^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$`).
- No value is empty (warning, not error).

Known limitations (not expressible in JSON Schema but to be checked at load/build):

- Keys referenced by the project's menus/commands must all exist in `keys`. Otherwise editor warning ("Key `menu.foo.title` referenced by btn_buy but not defined").
- Circular references (key A points to key B which points to key A) must be detected. Resolution depth limit = 10 for safety.

## How to use it

### Editor side (TypeScript)

```ts
import type { Translations, TranslationKey } from "./schema/translations/v1/types";
import {
  validateTranslations,
  extractI18nRefs,
  extractI18nRefsDeep,
  generateAutoKey,
  generateUniqueKey,
  completionPercent,
} from "./schema/translations/v1/types";
import schema from "./schema/translations/v1/schema.json";
```

### Plugin side (Java)

Codegen of the types from `schema.json` (jsonschema2pojo) or light manual parsing (the format is flat). At sync, the plugin parses each `i18n/<lang>.json` and stores it in a `Map<String, Map<String, String>>` (key → lang → minimessage). When rendering a menu, it resolves `{i18n:...}` then PAPI then MiniMessage in a chain.

### Local validation

```bash
node validate-translations.mjs
```

## Roadmap

| Version | Capability |
|---|---|
| V1 MVP | Flat format, fr + en, 3 language-detection modes on the plugin side, inline UX in the editor, import conflicts handled. |
| V1.5 | Per-language completion statistics in the dashboard. "Export as .po/.csv for external translator" button. Automatic detection of unused keys. |
| V2 | Pluralization (`<plural:count:zero=...:one=...:other=...>`). Typed variables in keys (declared per key, for more safety). Project glossary (force a consistent term: "Boutique" always used for "Shop" in FR). |
| V3 | Marketplace of i18n packs (a creator can sell a set of translations for popular packs). |
