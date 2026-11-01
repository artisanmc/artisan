# Structure of a project on disk

Files are the **source of truth** (ADR `files-first-source-of-truth`): the disk is
lossless, the editor has no privileged representation.

```
plugins/Artisan/modules/
  <project_id>/
    artisan-module.yml             ← module file (`schema: module/v1`), formerly manifest.yaml
    menus/<menu_id>.yml            ← one folder per Document kind (see below)
    commands/<command_id>.yml
    dialogs/<dialog_id>.yml
    <folder>/                      ← thematic folder (see below), same kind folders
      menus/<menu_id>.yml
      dialogs/<dialog_id>.yml
      <subfolder>/menus/…          ← up to 3 levels
    lang/<lang>.yml                ← YAML tree (see below)
    items/<captured_item_id>.yml   ← captured ItemStacks (material refs `item:<id>`), Bukkit YAML verbatim
    data/<source_id>.yml           ← Project sources (schema data/v1, refs `pack:<id>`)
    templates/<id>.yml             ← schema template/v1, resolved at plugin load
    models/<id>.yml                ← schema model/v1; `<id>` = the source it types (owned model), otherwise the model id, the identity remains the internal `id:`
    assets/{glyphs,textures,fonts}/ ← images and fonts (binaries, written by publication)
    .artisan/editor.yaml           ← editor board state (the only `.artisan*` the editor writes)
    .artisan/project-id            ← project UUID, written once by the plugin (keeps Versions and drafts across a rename)
    .artisan/drafts/<id>/          ← drafts from before the suite database, no longer read
    .artisan/transactions/         ← publication journal, receipts in `.receipts/`
    .artisan/history/              ← archives from before 2026-09-26, read only
```

Before 2026-10, the root was `plugins/Artisan/projects/`. On first startup, the plugin
moves it to `modules/` (`ModulesRootMigration`): each folder keeps its name (namespace, qualified
refs) and its `.artisan/project-id` (Versions, drafts), the old folder stays as
`projects.artisan-migrated/` and `modules/.artisan-migrations.yaml` prevents the migration from replaying.
A failure puts everything back and keeps `projects/`. Design: `design-projets-en-modules.md`
(project files), of which this is batch 1; the rest (editor per module, add-on roots) follows.

## YAML extensions and the module file

The plugin and the editor write `.yml` (the Bukkit/Paper norm) and also read `.yaml` (what
Artisan wrote before) everywhere: Documents, `lang/`, `data/`, `models/`, `templates/`, `assets/` descriptors
(`model/YamlFiles.kt`, `lib/yamlFiles.ts`). The same file under both extensions is an
error: a Document is refused (`duplicate_id`), any other file is read from its `.yml` copy
and the log names the other. The file that makes a folder a module is `artisan-module.yml`
(`schema: module/v1`, same fields as `manifest/v1`), read first, then `manifest.yml` and
`manifest.yaml` (`model/ModuleFile.kt`). `ProjectContentApi.read` finds a file under either
extension, and `read("manifest.yaml")` returns the module file whatever its name.
An editor save rewrites each file under the extension it has on disk
(`keepYamlExtensions`), and so does a config screen.

A file that already exists is rewritten under its name: the copy of a template or of a system
element (`TemplateCopies`, `SystemFiles`), the file of a module command
(`commands/<name>.yml`), a draft publication. Only a new file takes `.yml`
(`YamlFiles.onDisk`, editor-side `yamlPathFor`). A module template keeps the names
under which the module ships it (often `.yaml`): the editor compares its files with those of the folder
without the extension (`TemplateFileState.projectPath`), and `template_copy` accepts either
spelling.

**Migration at startup** (`YmlMigration`, called by `ProjectRoots` when the server starts,
once per folder and per startup): each folder of `plugins/Artisan/modules/` (a module's own
folder included) has its `.yaml` files renamed to `.yml` and its `manifest.yaml` to
`artisan-module.yml`, in one journaled commit (`ProjectPublisher`), along with the keys of
`.artisan/origins.yaml`. Only names change: the bytes stay, a renamed `manifest.yaml`
keeps `schema: manifest/v1` until the editor next writes it. The `.artisan*`
metadata keeps its name. A file whose `.yml` copy already exists stays
as is, named in the log. An add-on root outside `modules/` and a configuration root
are not touched: the add-on reads its files there as it wrote them.

A draft started before the migration still names `menus/shop.yaml`: the editor, when
resuming it (`followDisk`), renames its paths as the disk writes them, and the plugin does the
same at publication (`DraftPublication`). A change made under the old name is therefore
kept, without conflict.

A Project is identified by the name of its folder on its server; for the hub and the editor, it
is called `<server id>.<folder>`, whatever the server (see `entities.md`). `.artisan-sync.yaml` (old
cloud sync metadata) may linger on an old server: it stays excluded and ignored.

## Document folders — the kind registry

The `menus/`, `commands/` and `dialogs/` folders are named nowhere in hard-coded form (ADR
`extensible-document-kinds`, decision 10). Each Document **kind** is an entry of a registry
— `editor/src/domain/documentKinds.ts` (`kind`, `dir`, `idPrefix`, `schemaVersion`, `rank`) and
`plugin/core/.../model/DocumentKinds.kt`, Kotlin facade of the API's `DocumentKindRegistry`
(`kind`, `dir`, `schemaVersions`, `idPrefix`; core kinds are registered there by
`coreRegistry()`, a module adds its own through `api.getDocumentKinds()`) — and everything that walks
a project loops over this registry: the editor's import (`projectFromFiles`) and write (`projectToFiles`)
through the per-kind codecs (`schema/documentCodecs.ts`, a `<kind>V1ToDomain` reader and a
`<kind>V1FromDomain` writer per kind), the plugin's `ProjectReader` through
a reader per kind, the resource inventory and the provider's reference tables.

In memory, a Project is a **single container**: `Project.documents[kind]` (editor) and
`RuntimeProject.documents[kind]` (plugin). `menusOf(project)`, `runtime.menus` and the like
are typed **read** accessors on this container, never a second store. A folder
whose kind is not registered stays opaque: the editor round-trips it in
`moduleData.<dir>.__files`, the plugin does not read it. A kind registered by a module without a core
reader is read as a **raw document** (`RuntimeRawDocument`: the YAML mapping, `schema:` checked against the
declared labels, the file name as id) and handed back to the module by
`ProjectContentApi.documents(projectId, kind)` (W6).

## Thematic folders

A module stores its Documents in free folders that mix kinds:
`boutique/menus/shop.yaml`, `boutique/commands/shop.yaml`, `boutique/armes/menus/swords.yaml`.
The rule is a pure function of paths, written twice and locked by
`testdata/document-layout-conformance.json`: `model/DocumentLayout.kt` (plugin, read by
`ProjectReader` and `ResourceInventory`) and `domain/documentLayout.ts` (editor, read by
`projectFromFiles`, `adoptLateDocuments` and `projectToFiles`).

- A Document is `<folders…>/<kind dir>/<id>.yaml` (or `.yml`), with 0 to 3 thematic folders
  (slug `^[a-z0-9][a-z0-9_-]*$`).
- **The id remains the file name.** The folder enters neither the id, nor the references,
  nor the `lang/` or board keys: moving a Document only changes its path.
  The editor carries it in `Document.folder` and a rename records the move under
  the Document's folder (`renamedDocumentFiles`).
- **An id is unique per kind in the module.** Two files of the same kind and the same id,
  in two folders: both are refused (`duplicate_id`). Two kinds can share
  an id (a menu and a `shop` command): `.artisan/editor.yaml` then stores the board
  (`layout`, `edges`) by `<kind>/<id>`, and the editor flags this sharing on opening.
- A kind folder only contains files (`kind_dir_subfolder` otherwise). A thematic
  folder cannot bear the name of a resource (`lang`, `items`, `data`, `models`,
  `templates`, `assets`, `overrides`, `config`: `reserved_folder`) nor exceed 3 levels
  (`too_deep`). Resources stay at the module root.
- A refused file is reported (`onSkip`, plugin side) and never lost: the editor keeps it
  in `Project.unreadFiles` and rewrites it as is. What does not have the shape of a Document
  (a file placed directly in a thematic folder, an unregistered kind folder)
  stays in `moduleData.<first folder>.__files`, and `adoptLateDocuments` reads it when
  the kind arrives.
- In the editor, the sidebar tree creates, renames, deletes folders and moves
  Documents into them; on the board, each top-level folder is a frame.
  `.artisan/editor.yaml` keeps under `folders:` the color and position of these frames, and
  the still-empty folders (nothing else on disk would remember them):
  `folders: { boutique: { color: "#a855f7", position: { x: 120, y: 240 } }, vide: {} }`.

## Variants (`variants.yml`, `variants/`)

Design `variantes-modules` (project files). A module that has `variants.yml` (or `.yaml`) at its
root keeps its variants under `variants/<name>/`, each laid out like the module (kind folders,
thematic folders, resources): `variants/textured/menus/ranks.yml` is the `textured` version of
`menus/ranks.yml`. Without `variants.yml`, `variants/` is an ordinary thematic folder (nothing
changes for an existing module).

```yaml
# variants.yml
schema: variants/v1
rules:                       # in order; implicit last: the module's own files
  - id: dev                  # optional, default: the variant name
    variant: dev
    enabled: false           # optional, default true
    when: { permission: op }
  - variant: bedrock
    when: { client: bedrock }          # bedrock | java
  - variant: textured
    when: { has_pack: true }           # Java pack, or Bedrock pack for a Bedrock player
# `when` also takes `condition:`, any engine condition ({type: has_permission, perm: …});
# all keys are required together.
```

- `DocumentLayout` puts a variant's Documents in `Result.variants` (with their `variant`), ids
  unique per kind **inside** a variant; a variant name is a slug (`invalid_variant`). Locked by
  `testdata/document-layout-conformance.json`.
- `ProjectReader` reads the variants' **menus and dialogs** into `RuntimeProject.variants`, the
  rules into `RuntimeProject.variantRules` (`engine/VariantRules.kt`). Reported through `onSkip`, not
  read: a variant menu whose `inputs` (name, type) differ from the module's menu of the same id
  (`variant_inputs_mismatch`), a variant file of another kind (`variant_kind_unsupported`), a
  rule naming a variant absent from `variants/`, with an unknown `when` key or a reused id.
- `SyncedMenuProvider.openMenu` / `openDialog`: the id resolves as before, then the first
  enabled rule that holds and whose variant has that file gives the copy shown
  (`VariantRules.select`, conditions evaluated only for a variant that has the file). At each
  opening, going back included; never while a menu stays open.
- Editor (`domain/variants.ts`): `projectFromFiles` reads the rules into `Project.variants.rules`
  and the variants' menus, dialogs and commands into `Project.variants.documents` (variant →
  kind → docs). A command's version is read on the module's file (`schema/commandVariant.ts`,
  twin of `CommandVariant`) into a whole `Command`, and written back as the steps that differ
  from the module's; shown, it takes the module's registration as it is now
  (`onModuleCommand`), and `CommandEditor` locks those fields. A command without its module's,
  one the plugin would refuse, or any other kind stays verbatim in `Project.unreadFiles`. "View as"
  (`showVariant`) swaps the viewed variant's versions into `Project.documents`, the module's they
  cover parked in `variants.view.hidden`, so every editor and the canvas work unchanged.
  `projectToFiles` and `projectTree` restore the module's view first (`withModuleView`), before
  `rekeyProject`. Texts: a version gets keys of its own on creation (`createVersion` copies the
  values), and the Documents out of view never hold a canonical key, so an edit minting one
  cannot overwrite the twin's text. UI: `VariantSwitcher` (canvas toolbar), `VariantRulesDialog`,
  `VariantTag` (board), `VariantVersionBar` (properties panel).
- `documents_check` checks a variant's menu or dialog against its schema like the module's; a
  variant's command goes through the engine load only (`CommandVariant`). A disabled rule naming
  a variant without files is not reported (a variant just created in the editor).
- MCP: `list_documents` lists `variants` (rules file, names, documents with their `variant`);
  `artisan_overview`'s workflow explains the files (`McpTools.VARIANTS_HOWTO`). Writing goes through
  `write_document` like any file.
- Packs: the menus the Java and Bedrock packs read are those `DocumentLayout` classifies
  (`menuPaths.ts`, `DocumentLayout.menuPaths` in `plugin/pack`), themed folders and variants
  included, twin ids left out. A variant uses the module's `assets/`. A variant's menu has its own
  Bedrock key, hashed from `project:menu@variant` (`BedrockTitle.key` in paper, `bedrockMenuKey`),
  so its background texture is its own; `RuntimeMenu.variant` carries it to the title. Vector:
  `resource-pack-conformance.json`, case "variants: …".
- Commands (design §17): `variants/<v>/commands/<id>.yml` holds only what runs, `actions`,
  `requirements` and `fallback`, on the root and on `subcommands` nodes found by `name`
  (`command/CommandVariant.kt`). Anything else (`name`, `aliases`, `permission`, `arguments`,
  `description`, `cooldown`, a node the module's command lacks) is reported
  (`variant_command_key: <path>.<key>`, `variant_command_node: <path>`) and the file not read; a
  command the module does not have is `variant_command_unknown`. The merged `CommandYaml` sits in
  `RuntimeProject.variants`. `CommandRegistrar` compiles one tree per variant and `PackCommand`
  runs, for a player, the handler of the node at the same names in the tree their rules pick
  (`CommandVariants`); permissions, usage, completion and the console use the module's tree.
- Not yet: a variant-only id (a menu only a variant has), `based_on`, side-by-side preview, simulation of a player.

The `data/` files carry the Data models **inlined**; `ltext` values are i18n keys
resolved at bind, item values are material refs.

Paths whose **first segment** starts with `.artisan` are outside the hash and
invisible to the disk scan — see `invariants.md` § Universal `.artisan*` exclusion. Same for
`.artisan-trash/`, at the top of `projectsDir`.

## Module file — `lore_max_width`

Maximum width of a lore line, in **MC pixels** (vanilla font advances, +1 px per bold
character; ~6 px per common character). Absent or `0` = no wrapping; projects created
from the editor are born with `240`. The plugin splits each line **after** placeholder
resolution (`render/LoreWrap.kt`), the editor preview applies the same algorithm
(`lib/loreWrap.ts`) — contract frozen by `testdata/lore-wrap-conformance.json`. It breaks on
spaces, a word that is too long overflows alone, and a continuation line reopens the MiniMessage
tags still open (each lore line is parsed alone). The lore of the base item
is not re-split, unless placed by `{base.lore}`. Adjustable in the project settings
(YAML button = the module file verbatim).

## Module file — `escape_goes_back`

Boolean, absent = `false`. True: Escape in a project menu reopens the previous screen of the navigation
stack (like `open_previous_menu`) instead of clearing it; empty stack = normal close.
Only the `PLAYER` close reason triggers the back — `close_menu` (`PLUGIN`) closes everything.
Wired in `listener/MenuListener.kt` (next tick, like the history clearing). Dialogs are not
affected.
Spigot does not give the close reason (`MenuCloseReason.UNKNOWN`): the back does not apply there.

## `lang/` — a tree, not a flat file

Each `.` of the key is a level (`menus:` → `<menu_id>:` → `elements:` → …). The runtime addresses
by dotted key.

- **Write codec** (only writer): `editor/src/lib/langTree.ts` — `nestLangTree`.
- **Read mirror**: `plugin/…/yaml/LangFlattener.kt`.
- **Locked by** the shared vector `testdata/lang-tree-conformance.json`.

The three readers (plugin, editor import, module mutation) accept **tree / legacy flat /
mixed** — nothing to migrate. A key blocked by a leaf (`a.b` and `a.b.c` coexist) stays
dotted at the root rather than being lost.

A `lang/` key that no Document and no data source of the module reads at import is
**kept as is**: an add-on's messages (ArtisanAuctions, a bundle declared
`inFolder`), a key added by the admin. The editor notes it in `Project.keptLangKeys`
(`projectFromFiles`) and rewrites it from `i18nKeys` on every export (`keptLangEntries`): a
change in Translations applies, a deletion removes it, a key that a site owns
in the meantime goes back to it. Keys under `menus.`, `commands.`, `dialogs.`, `sources.` and
`artisan.` belong to the editor. Before, an export only kept the keys without a site and the data
sources: a Deploy wiped out the rest.

An add-on stores its **system messages** in the `lang/` of its folder with
`MessageBundleDeclaration.files(...).inFolder(folder)` (API 2.17.0): Artisan reads the
server's files there instead of `plugins/<Plugin>/lang/`, moves them there once
(`LangFolderMove`, a file whose language already exists in the folder stays and the log
names it), and rereads the bundle at every project reload (`Translations.reloadFolderBundles`).
The jar still answers for missing keys.

## Structural texts — field-local (ADR `field-local-translations`)

Since 2026-09-30, **structural** texts (menu title, appearance `title`/`lore`, dialog `title`/
`body`/labels) live **in the document**, not in `lang/`. A text slot is either a
**string** (literal, or `{i18n:key}` ref, identical for all languages), or a **field-local
map `{ <lang>: text }`** (resolved requested language → `defaultLang` → any entry).
The string form is sugar for `{<defaultLang>: text}`. A structural field is never
both string and map.

`lang/` therefore only carries: **action texts** (serialized as `@key` refs inside the
Action DSL — a DSL string cannot contain a map), presentation **keys without a site**
(`artisan.duration.*`) and **data source addresses** (ADR `bare-data-files` ④). As a
consequence, the **positional addresses** subsystem (`I18nAddresses.kt` plugin-side,
`i18nKeys.ts`/`i18nSites.ts` editor-side) is no longer a rendering contract for documents —
the runtime reads the slot's map. Vector removed: `testdata/i18n-address-conformance.json`.

`title: "Retour"` and `title: { fr: Retour, en: Back }` coexist; a string field is read as the
`defaultLang` value (hence detected as untranslated for the other languages). Lazy
migration: a single-language inline project reads identically, the string → map promotion only happens
when a second language is entered. Reading stays tolerant of the old addressed form.

A translated **lore** is a list of lines **per language** (`lore: { en: [...], fr: [...] }`):
each language has its own line count and the fallback (requested language → `defaultLang` →
any) applies to the whole block. Without translation, it is a plain list of lines.
The "one `{lang: text}` map per line" form is still read (plugin `LoreDeserializer`, editor
`menuV1ToDomain.loreText`, which regroups it into one block per language) but is no longer written
(`schema/fieldText.ts` `loreWire`).

## `title` field of a menu

A `MenuTitleLayer[]` — `background` / `glyph` / `text` / `textarea` / `external_glyph`. YAML format
and pixel-perfect rendering pipeline (pixel offsets, custom fonts): `editor-internals.md`.
