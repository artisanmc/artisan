# Artisan — Pack schema v1

Format of an Artisan **pack**: organization unit in the admin's workspace, and shareable export/import format. A `.itfz` archive (zip) with a manifest at the root + menus + templates + commands + translations + referenced assets.

## Vocabulary not to be confused

| Term | Meaning |
|---|---|
| **Pack** | Organization unit in the workspace (e.g. "my Shop System", "Daily Quests purchased"). Also: shareable .itfz export format. |
| **Bundle** | Signed runtime artifact (config + resource pack) that the plugin downloads from the CDN. Opaque to the admin. |
| **Menu** | An entity openable via `/menu open`. Lives inside a pack. |
| **Command** | A custom command registered by Artisan. Lives inside a pack, at the same level as a menu. |
| **Template** | Named reusable component (Figma Symbol style). Can live in a pack or globally. |
| **Asset** | Uploaded custom image. Can live in a pack or globally. |
| **Translation** | i18n key + values per language. Scoped to the workspace but embeddable in a pack on export (subset of the referenced keys). |

## Files

| File | Role |
|---|---|
| `schema.json` | JSON Schema Draft 2020-12 of the manifest, machine-validatable |
| `types.ts` | TypeScript types for the editor and the future MCP |
| `example-manifest.json` | Example of a valid manifest |

## .itfz archive layout

```
manifest.json          ← required, at the root
menus/
  shop_main.json       ← one file per menu listed in manifest.menus
  shop_premium.json
templates/
  bouton_acheter.json  ← one file per template listed in manifest.templates
commands/
  shop_open.json       ← one file per command listed in manifest.commands
translations.json      ← optional, conforms to translations/v1, subset of the referenced keys
assets/
  shop_bg.png          ← one file per asset listed in manifest.assets
  rank_vip_button.png
preview.png            ← optional, if manifest.preview_image is present
README.md              ← optional, for humans who open the zip
```

The archive is a standard .zip with its extension renamed to .itfz for recognition (mime-type `application/x-artisan-pack`).

## Workspace: how packs live on the admin side

In the dashboard, the admin sees their packs as collapsible sections:

- **📦 Personal** (auto-created, `is_default: true`) — utility pack where everything not explicitly assigned lands.
- **📦 Shop System** (`source: user_created`) — created manually to group their main shop + sub-shops + purchase button templates + the `/shop`, `/buy` commands + the shop assets.
- **📦 Daily Quests** (`source: imported`, `source_pack_id: creator-x/daily-quests`, version 2.1.0) — purchased/downloaded.
- **📦 MCModels Medieval** (`source: imported`) — imported from an MCModels .zip via the V1.5 importer.

## Import model: overwrite

When re-importing a pack that already exists in the workspace (matched by `source_pack_id`), **its whole content is replaced in bulk**. No smart migration, no three-way merge. Local changes are lost.

The admin sees a warning dialog: *"This pack comes from [source]. Re-importing will replace its content (X menus, Y commands, Z templates, W translations, V assets). To customize durably, use 'Fork' before editing."*

## Fork model

On an `imported` pack, the "Fork" button duplicates the content into a new `forked` pack that is treated as `user_created` for all practical purposes: freely editable, never overwritten by a re-import again. A `source_pack_id` pointer is kept as metadata for traceability, but there is no upgrade link.

Standard pattern (Steam Workshop, Notion templates, Figma community). Understood by users without documentation.

## Import conflicts

On import, we detect five classes of conflicts:

**1. Pack id conflict.** A pack with this `manifest.id` already exists:
- If same `source_pack_id` (re-import) → overwrite after confirmation.
- If different (or null = locally user-created pack) → the admin chooses: rename the imported pack, or skip.

**2. Menu id conflict.** A menu with an id from the imported pack already exists elsewhere (reminder: menus have a global namespace within a server, to allow `/menu open shop_main`):
- Dialog: "The pack contains a menu `shop_main` that already exists in your pack X. Rename to `shop_main_2`? Skip this menu?"

**3. Command name conflict.** An imported command has a `name` or an `alias` that already exists on the target server (another Artisan command, vanilla, or third-party plugin):
- Visible but non-blocking warning at import. At publish, the admin must rename or disable the conflicting command.

**4. i18n key conflict.** A key of the pack already exists in the target workspace but with a different value:
- Dialog with 3 options: *Keep local* (skip the imported key, may be surprising if semantically different), *Overwrite with the import* (the local value is replaced for all usages), *Rename the imported key* (auto-prefix with `pack.id`, the pack's menus/commands are rewritten on import). Default = rename.

**5. Missing required plugins.** The admin does not have LuckPerms installed but the pack requires it:
- Visible but non-blocking warning; the affected menus and commands are imported as drafts but greyed out (graceful degradation, like sec. 12.6 of the main spec).

## Cross-pack references — soft boundary

A menu in pack A can reference a template defined in pack B without error. The editor shows a warning *on export* of pack A: "This pack references the template `bouton_acheter` which lives in pack B. Include pack B in the archive?". If yes, B is embedded; otherwise, the export notes the external dependency and the import alerts if B is absent from the target workspace.

Same for a command in pack A that opens a menu living in pack B: warning on export, with the option to embed B or declare it as an external dependency.

For **i18n keys**, it is simpler: on pack export, we recursively compute the union of the referenced keys (`extractI18nRefsDeep`) over the pack's menus + commands and embed that subset, regardless of their conceptual "ownership" (keys live at the workspace level, not per pack).

This is more permissive than strict modules, and it is what admins want in practice.

## Manifest fields

The manifest follows the `pack/v1` schema (see `schema.json`). Notable fields:

- **`id`**: stable slug. For V1 (no marketplace yet), unique per author. For the V3 marketplace, the full id will be namespaced `author/pack-id`.
- **`version`**: semver (`X.Y.Z`). Bumped on each export to allow update detection.
- **`requires_plugins`**: computed automatically on export from the union of `menu.metadata.uses_plugins` and `command.metadata.uses_plugins`.
- **`menus`/`templates`/`commands`/`assets`**: lists of the ids/paths included. The import checks that each referenced file is present in the archive.
- **`translations`**: meta object describing the embedded translations (`file`, `key_count`, `languages`). Computed on export.
- **`preview_image`**: for the V3 marketplace; optional.
- **`license`**: SPDX identifier recommended. Important for the marketplace to clarify derivative uses (resale, modification, etc.).

## Import validation

The backend must check, in this order:

1. The manifest parses and matches `pack/v1`.
2. All listed files (`menus`, `templates`, `commands`, `assets`, `translations.file`) exist in the archive.
3. Each menu parses against `menu/v1` and passes `validateMenuLayout` (see menu/v1/types.ts).
4. Each template parses against `template/v1` (to be formalized).
5. Each command parses against `command/v1` and passes `validateCommand` (see command/v1/types.ts). The `name`/`aliases` are checked for conflicts with the target server's registered commands (warning, not blocking at import — the admin resolves at publish).
6. The translations file parses against `translations/v1` and passes `validateTranslations`. Key conflicts are surfaced in the import dialog (see above).
7. Assets are valid PNGs (magic bytes), reasonable size, consistent dimensions.
8. No path traversal (`../`) in asset paths.
9. Required plugins are installed on the target server (warning otherwise).

## Known limitations

**No signature in V1.** Packs are not cryptographically signed. An imported pack could theoretically have been modified in transit. Acceptable for the MVP. ECDSA signing (consistent with runtime bundles) arrives in the V3 marketplace.

**No global cross-pack assets.** In V1, each asset lives in a single pack. To share it, we copy. Later (V1.5+) we may have "user-global" assets outside any pack.

**No migrations between schema versions.** If a pack is in `pack/v1` and we move to `pack/v2`, V1 is no longer directly importable — an explicit migration will have to be written (or re-export from the editor of a user with a recent version).

**Env-specific variables (permissions, currencies, world names).** Not resolved at the schema level — the admin imports and adapts by hand, or uses the V1.5 "find & replace" wizard.

## Roadmap

| Version | Capability |
|---|---|
| V1 MVP | Workspace organized into packs (Personal + user-created). Menus + commands + translations as first-class. Export/Import of a single menu (.menu.json) or a single command (.cmd.json) — no pack export yet. |
| V1.5 | Export/Import of a complete pack (.itfz) with menus + commands + templates + translations + assets. Find-&-replace wizard for env-specific values. MCModels importer. |
| V3 | Native marketplace: signing, pricing, reviews, discovery. |
