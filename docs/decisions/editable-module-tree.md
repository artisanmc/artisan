# A module's folder holds its whole tree; what it ships is indexed beside it

**Status:** proposed (2026-11-28), not built. Replaces the design `originaux-modules`
(`originals/` in a module's folder, project files: `archive/architecture/design-originaux-modules.md`)
for module folders, and the parts of `docs/architecture/project-files.md` § Originals that follow
from it. Amends `module-templates` (consequences) and `module-config-screens` (shipped data).
Keeps the three-way merge and `.artisan/bases/` of `SystemFiles`. **Does not change the base
theme `artisan`**, which keeps `themes/artisan/originals/` (decision 9).

## Context

Since the design `originaux-modules` (2026-11-01), what a module ships into its own folder lives
under `originals/`, written by the server only, and the owner's folder holds only what they
changed or added. The loaded tree is computed: `originals/` under the owner's files, id for id,
minus `originals.exclude`; messages key by key; per-row data folder by folder. Four weeks of use
show the cost:

- **An owner editing by hand does not find the files.** `menus/` is empty or holds three files;
  the other menus are under `originals/`, which they must not edit. To change one value they must
  know to copy the file to the right path first. Every Minecraft plugin does the opposite: it
  copies its config once and never touches what the owner changed. That is the model owners
  already know.
- **Every reader has to rebuild the effective tree, and each forgotten reader is a bug.** The
  editor's YAML tab (`DocumentYamlView`) reads the owner's path only: for a menu the owner never
  changed it shows an empty file, and saving there writes a file holding only what was typed
  (reported 2026-11-28 on `daily-rewards`, `variants/textured/menus/calendar.yml`). The same
  resolution is written in Kotlin core (`DocumentLayout.classify`, `ProjectReader.Resources`),
  `plugin/pack` (`ShippedView`), the editor (`domain/documentLayout.ts`, `shippedView.ts`,
  `shippedData.ts`, `keptLangEntries`) and an add-on (`CalendarFiles.find` in daily-rewards):
  65 source files and 41 test files name `originals`.
- **What the design wanted from two layers is available without them.** "What did the owner
  change" is a compare against the shipped hash. "Read the shipped version" is in the jar
  (`template_fetch`, protocol 1.3). "Follow the module's updates" is `SystemFiles.sync`'s
  three-way merge, already written and tested.

## Decision

1. **The module's folder holds the whole tree, and all of it is the owner's.** At sync the
   server writes every shipped file at its own path (`menus/main.yml`,
   `variants/textured/menus/main.yml`, `lang/fr.yml`, `data/settings.yml`, `assets/...`). There
   is no `originals/` folder in a module's folder. Loading is a plain read: no layer, no
   exclusion applied at read time. `originals` stays a reserved first segment for good (an older
   Artisan writes it back, decision 8).

2. **What the module shipped is indexed in the content: `artisan-shipped.yml`**, at the folder's
   root, written by the server only (refused to `project_write`, drafts, MCP, like `originals/`
   today), read by everyone. Per path: module, template, version, shipped hash, `required`. It
   replaces `.artisan/origins.yaml` and `originals/originals.yml` for module folders. Being in the
   content, it is in the hash, in the Versions and in the database: the hub, the editor and MCP
   read file states with the server offline, and **a restored Version brings back the index that
   matches its files**, so files restored from before a module update read as untouched at the
   older version and follow the next sync, instead of reading as modified against the wrong base.
   `.artisan/bases/<hash>` stays private and keeps the shipped content of every hash the index
   names, for YAML files: the base of the next merge.

3. **A file's state comes from the index**, the same rule on the server, the editor and MCP:
   - **untouched**: its content is the shipped one. Same bytes, or, for YAML, the same tree once
     parsed (`YamlEquivalence.sameValue`, already used by `DraftPublication`) **and** no comment
     the shipped file lacks. A save from the visual editor that changes no value leaves a file
     untouched; an owner who only added comments has a modified file, never overwritten.
   - **modified**: another content.
   - **deleted**: indexed, absent, and no Document of the same identity (variant, kind folder,
     id: `DocumentLayout`'s, not `movedElsewhere`'s name match, which takes
     `variants/textured/menus/shop.yml` for a move of `menus/shop.yml`) elsewhere in the folder.
   - **added**: not indexed.
   - **update available**: modified, and the module now ships another hash than the indexed one.
   A rename or a move into a folder (`renames` of `DraftPublication`) carries the index entry to
   the new path in the same commit, so filing a menu does not detach it from updates.

4. **A module update (sync) follows the state:**
   - untouched → rewritten with the new shipped content, index moved forward;
   - modified → three-way merge (base = indexed version, ours = the file, theirs = new
     shipped), as today. Written only when the merge changes a value (a merge rewrites with
     `EditorYaml` and drops comments, so a file whose values already match is left as is).
     Conflicts: the owner's values stay, the index stays on the old version, the editor shows
     "update available" with the diff. Not YAML, or no base: left alone, same signal;
   - deleted, optional → not written again; also listed in `originals.exclude` of the module
     file (name kept, both ways compatible) at the moment it is deleted, by the editor or MCP in
     the same commit, and by the sync for a deletion by hand;
   - deleted, required (a `.system()` template file, the menus code opens by id) → written
     again, with a warning on the module file (`required_restored: <path>`);
   - no longer shipped → removed when untouched, kept unindexed (the owner's) when modified;
   - a new shipped file → written, unless a file of the same identity is there: then it is the
     owner's, indexed against the new version so the next update compares it.

5. **Messages are one file, merged key by key.** `lang/<code>.yml` is a full file the owner
   edits like any other; the sync merges it with the same three-way merge (a new key is added, a
   key the owner did not change follows the module, a changed key stays). Shipped messages
   (`ShippedLang`, written today to `originals/lang/` without an origin) go through the sync and
   the index like any shipped file.

6. **Per-row data** (`data/<id>/`) keeps its rule: a folder is the owner's as a whole once they
   have one, and the module's while they have none (the sync writes it while untouched).

7. **The shipped version is readable from the jar.** Presence already announces each template's
   paths and SHA-256 (`installed_modules[].templates`). The hub fetches the contents it lacks as
   soon as Presence announces them (`template_fetch`), keeps them by verified SHA-256, and drops
   a hash no index of any Version names. The editor compares, shows "as shipped" and restores
   from it; "Restore" writes the shipped bytes and leaves the index as is: the file is untouched
   again. The version a modified file was made against is in the same cache when it was ever
   announced; otherwise the editor says the old version is not available and offers the diff to
   the current one only.

8. **An older Artisan can be started again without a script for everything a template ships.**
   Its sync writes `originals/` back (`SystemFiles.sync`) and removes every owner file equal to
   the shipped content or to its origin, which brings the folder back to its originals layout;
   edited files stay the owner's; `originals.exclude` is still there. Not covered:
   messages written as a full `lang/<code>.yml` (they belong to no template of the older version,
   so each key reads as an override and stops following the module until the file is saved from
   the editor), and a YAML untouched only in tree (reformatted), which stays a full copy until
   the next module update. Both are said in the changelog. Step 1 tests this path: migrate, then
   run the older `SystemFiles.sync`, compare the loaded projects.

9. **Scope: module folders only.** The base theme `artisan` keeps `themes/artisan/originals/`:
   the pack decides margins and recoloured variants from "shipped or redrawn"
   (`ResourcePackBuilder`, `Kit`), its template is not announced in Presence nor served by
   `template_fetch`, and themes are layers on purpose (`resources-one-screen`). A copy into
   another Project (`template_copy`) is unchanged. A theme sold apart or a marketplace package
   (§8 of the former design) is out of scope here and gets its own decision when it exists.

## Migration

At the first start of the version that builds this, for each module folder that holds
`originals/`. One pure function, `flatten(tree) → tree`, does the work; it is **kept for good**,
because it also serves old Versions and drafts (below):

1. Documents (menus, dialogs, commands, `variants.yml`, assets): the owner's file of the same
   identity is kept; otherwise `originals/<p>` is copied to `<p>`. An excluded optional file is
   not copied. **An excluded required file is copied** (today the exclusion is ignored and the
   original loads, `Originals.exclusions`).
2. Messages: `lang/<code>.yml` = `originals/lang/<code>.yml` with the owner's keys over it (the
   loaded result, key for key), indexed against the shipped hash, its base kept.
3. Per-row data: the owner's `data/<id>/` alone when they have one; the shipped one otherwise.
4. A shipped PNG masked by an owner's descriptor of the same name (a composed image,
   `Assets.kt`) is not copied.
5. Files of `originals/` without an origin (`ShippedLang`) are handled by the same rules, not
   skipped.
6. `artisan-shipped.yml` is written from `.artisan/origins.yaml` and `originals/originals.yml`;
   `originals/` is removed.

**Check before committing.** The migration is applied to a temporary copy; both folders are
loaded with `ProjectReader` and the whole `RuntimeProject` is compared (menus, dialogs,
commands, messages, data, models, variants), plus the asset list the pack reads
(`DiskAssets.fromTree`). Equal → one journaled commit (`ProjectPublisher`), which creates a
Version. Different → nothing is written, the server logs which item differs, and the folder
stays in the former layout, **still loaded**: the `originals/` reader is kept as long as one
folder of the server fails, and the migration is retried at each start.

**Old Versions and drafts.** A Version restored from before the migration, or a draft autosaved
before it, holds `originals/` and its owner's diffs only: restored as is, it would delete every
copied file. The hub and the editor run `flatten` on any restored Version or loaded draft that
holds `originals/`, then compute the changes. Publication (`DraftPublication`) treats "the disk
already holds this value" (`YamlEquivalence.sameValue`) as no change, including when the draft
expected the file absent, so a draft that created `menus/x.yml` over an original does not
conflict with the copy the migration wrote.

**Mixed versions on a network.** The editor writes a module folder only when its server speaks
the protocol minor that brings this layout (like `speaksTemplates`); an older hub or leaf shows
the folder read-only with a message to update. The new editor copies `originals.exclude` as is.
One writing mode, never two.

**Add-ons**: `CalendarFiles.find` (daily-rewards) reads the owner's file first, then
`originals/`. After migration the owner's file is always there: no change needed; the fallback
is removed later. No other add-on names `originals/` (checked 2026-11-28).

## Consequences

- An owner editing by hand finds every file where it is loaded from, and edits it in place.
  The editor's YAML tab shows the file the canvas shows, by construction.
- One resolution less for module folders in three languages: `DocumentLayout` loses
  `original`/`excluded` for them, `ShippedView`/`shippedView.ts`/`shippedData.ts`/
  `keptLangEntries` go. The base theme keeps its layer (decision 9). Conformance vectors with
  module `originals/` cases are regenerated.
- The folder is larger (every variant's files on disk) and a module update writes files in the
  owner's tree. Both are what owners expect from a Minecraft plugin.
- A modified file no longer follows updates silently: it merges when it can and says so when it
  cannot, as today, now on the file itself.
- A merge that changes values rewrites the file without its comments, as today, but now on a
  full file rather than a file of differences. Said in the editor's merge notice.
- A lost `.artisan/` costs the merge bases only: states and deletions are in the content.
  Without a base, a modified file is left alone and flagged.
- `SystemFiles.keep` and `madeAgainst`, which read `originals/…` origins, are rewritten on the
  index. MCP: deleting a file no longer means "back to the original"; `restore_document` does.

## Rejected

- **Keep `originals/`, fix each reader.** Fixes the YAML tab, not the owner editing by hand,
  and every new reader must remember the layer.
- **Keep `originals/` but hidden (`.artisan/originals/`).** Same layer and same readers, plus
  content outside the hash that changes what players see.
- **Keep the states in `.artisan/origins.yaml`** (the first draft of this ADR). Out of the hash,
  the Versions and the database: no state with the server offline, a restored Version read
  against the wrong origins, a lost `.artisan/` silently freezing files.
- **Never touch a modified file at all** (the plain Bukkit rule). Silently loses a module's
  fixes in a menu the owner retouched once; the three-way merge already exists.
- **Include the base theme `artisan`.** See decision 9.

## Steps

1. **Server**: `artisan-shipped.yml` (writer, reserved path, refusals); `SystemFiles.sync` writes
   the tree (decisions 1 to 6); comment-aware equality; `ShippedLang` through the sync; bases for
   every indexed YAML hash; `flatten` and the migration with its check and retry; `keep` and
   `madeAgainst` on the index; the test "migrate, then older sync".
2. **Hub**: the shipped-content cache filled at Presence; `flatten` on restored Versions and
   drafts; protocol minor and read-only folder for an older peer; a route to read a shipped file.
3. **Editor**: states from the index, compare, restore, view as shipped from the cache; deletes
   write `originals.exclude`; renames carry the index entry; `projectToFiles` writes Documents
   like any others; the module originals layer removed.
4. **Packs**: both builders read module folders as they are; the base theme unchanged; vectors
   regenerated (`npm run pack -- vectors --write`).
5. **MCP**: `list_documents` gives each Document's state from the index; `read_document` reads a
   shipped file from the cache; `restore_document`.
6. **Later release**: remove the `originals/` reader once every folder reports migrated, and
   `CalendarFiles`' fallback. `flatten` and the reserved name stay.

The editor's empty YAML tab can be fixed before all this in `DocumentYamlView` (read the shipped
text when the owner has no file); it disappears by construction at step 3.
