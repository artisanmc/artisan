# A module's folder holds its whole tree; the shipped version stays in the jar

**Status:** proposed (2026-11-28), not built. Replaces the design `originaux-modules`
(`originals/` in the module's folder, project files: `archive/architecture/design-originaux-modules.md`)
and the parts of `docs/architecture/project-files.md` § Originals that follow from it. Amends
`module-templates` (consequences), `common-images-and-themes` decision 8 (how a redraw of the base
is stored, not what the owner sees) and `module-config-screens` (shipped data). Keeps the
three-way merge, `.artisan/origins.yaml` and `.artisan/bases/` of `SystemFiles`.

## Context

Since the design `originaux-modules` (2026-11-01), what a module ships into its own folder lives
under `originals/`, written by the server only, and the owner's folder holds only what they
changed or added. The loaded tree is computed: `originals/` under the owner's files, id for id,
minus `originals.exclude`. Four weeks of use show the cost:

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
  about 65 source files and 40 test files name `originals`.
- **What the design wanted from two layers is available without them.** "What did the owner
  change" is a hash compare against `.artisan/origins.yaml`, already recorded per file. "Read the
  shipped version" is in the jar (`template_fetch`, protocol 1.3) and, for the version a file was
  copied from, in `.artisan/bases/`. "Follow the module's updates" is `SystemFiles.sync`'s
  three-way merge, already written and tested.

## Decision

1. **The module's folder holds the whole tree, and all of it is the owner's.** At sync the
   server writes every shipped file at its own path (`menus/main.yml`,
   `variants/textured/menus/main.yml`, `lang/fr.yml`, `data/settings.yml`, `assets/...`). There
   is no `originals/` folder. Loading is a plain read of the folder: no layer, no exclusion
   list applied at read time.

2. **Each shipped file has an origin.** `.artisan/origins.yaml` keeps, per path, the module,
   template, version and hash of the shipped content the file was written from (format
   unchanged). `.artisan/bases/<hash>` keeps that content for YAML files (today only for edited
   ones; now for every file with an origin), so the next merge has its base.

3. **A file's state comes from its origin**, the same rule on the server, the editor and MCP:
   - **untouched**: its content equals its origin's. For YAML, equal means the same tree once
     parsed (`Yaml12`), not the same bytes, so a save from the visual editor that changes no
     value does not detach a file from updates. Other files compare by hash.
   - **modified**: another content.
   - **deleted**: recorded but absent (and not moved elsewhere, `movedElsewhere`).
   - **added**: no origin.
   - **update available**: modified, and the module now ships another hash than the origin.

4. **A module update (sync) follows the state:**
   - untouched → rewritten with the new shipped content, origin moved forward;
   - modified → three-way merge (base = origin, ours = the file, theirs = new shipped), as
     today. Clean: written, origin moved forward. Conflicts: the owner's values stay, the
     origin stays on the old version, the editor shows "update available" with the diff.
     Not YAML, or no base: left alone, shown as "update available";
   - deleted, optional → not written again; recorded in the module file
     (`originals.exclude`, name kept for compatibility both ways) so that it survives the loss
     of `.artisan/`;
   - deleted, required (a `.system()` template file, the menus code opens by id) → written
     again, with a warning on the module file (`originals_required` becomes
     `required_restored`);
   - a file no longer shipped → removed when untouched, kept (as the owner's) when modified;
   - a new shipped file → written, unless a file already holds that path or Document id: then
     it is the owner's, compared at the next update.

5. **Messages merge key by key.** `lang/<code>.yml` is a full file the owner edits like any
   other, and a module update merges it with the same three-way merge: a new key is added, a
   key the owner did not change follows the module, a changed key stays. This replaces the
   key-by-key override of `originals/lang/` (`Resources.layers`, `keptLangEntries`) with the
   same result for the owner.

6. **The shipped version stays readable, from the jar.** Presence already announces each
   template's paths and SHA-256 (`installed_modules[].templates`); it adds which paths are
   required. The hub keeps shipped contents it fetched (`template_fetch`) by hash, so the
   editor can compare, view as shipped and restore while the server is offline once it has been
   seen online. "Restore the original" writes the shipped bytes and the matching origin; the
   file is untouched again.

7. **A lost `.artisan/` fails safe.** A file without origin whose content equals a shipped
   version of the module's current templates is adopted as untouched; any other is the owner's
   and is never overwritten. Deletions survive through `originals.exclude` in the module file,
   which is in the content hash and in Versions.

8. **Scope.** Module folders (what `.system()` and own-folder `.seed()` templates ship, shipped
   messages, shipped data) and the base theme `artisan` (`themes/artisan/assets/`,
   `components/`). A theme's image over the base by name stays a layer: themes are Projects
   stacked on purpose (`resources-one-screen`), which this ADR does not change. A copy into
   another Project (`template_copy`) was already a plain copy with origins and is unchanged.

## Migration

At the first start of the version that builds this, for each folder that holds `originals/`,
in one journaled commit (`ProjectPublisher`), which creates a Version:

1. for each `originals/<p>` with an origin: if the owner has a file at `<p>` (or the same
   Document id elsewhere), keep it and its origin; if `<p>` is in `originals.exclude`, write
   nothing; else copy `originals/<p>` to `<p>`, give it the original's origin and keep its base;
2. remove `originals/` and the origins of `originals/…` paths;
3. **check before committing**: the effective tree computed the old way (originals under the
   owner's files, exclusions applied) must equal the new folder, Document for Document. If not,
   nothing is written and the server logs which path differs. Players see the same content.

**Going back** to an older Artisan works without a script: its sync rewrites `originals/` and
removes every owner file whose content equals its origin's or the shipped one (the
"migration of a folder that held full copies" already in `SystemFiles.sync`), so the folder
returns to its originals layout; edited files stay the owner's; `originals.exclude` is still
there.

**Mixed versions on a network** (hub newer than a leaf, or the reverse) and folders not migrated
yet: for one release, the readers keep reading `originals/` as a lower layer when a folder still
holds it. That code is removed the release after, with the `.system()` / `.seed()` `@Sunset`.

**Add-ons**: `CalendarFiles.find` (daily-rewards) reads the owner's file first, then
`originals/`. After migration the owner's file is always there: no change needed, the fallback
becomes dead code to remove later. No other add-on names `originals/` (checked 2026-11-28).

## Consequences

- An owner editing by hand finds every file where it is loaded from, and edits it in place.
  The editor's YAML tab shows the file the canvas shows, by construction.
- One resolution less in three languages: `DocumentLayout` loses `original`/`excluded`,
  `ShippedView`/`shippedView.ts`/`shippedData.ts` go, the packs read the folder as it is. The
  conformance vectors that carry `originals/` cases are regenerated.
- The folder is larger (every variant's files on disk) and a module update writes files in the
  owner's tree. Both are what owners expect from a Minecraft plugin.
- A modified file no longer follows updates silently: it merges when it can and says so when it
  cannot. Today's behaviour, now visible on the file itself.
- Comparing with the shipped version needs the hub to have seen the server online once since
  that module version (decision 6). Today it reads `originals/` from the Version.
- A merge rewrites the file with `EditorYaml` and drops its comments, as today.
- An image redraw of the base is the base file itself, changed: "Override" (resources-one-screen)
  becomes "Modified" for the base theme only. The rule "an original that declares a `function`
  is replaced at its measures only" is checked against the shipped image from the hub's cache
  instead of `originals/`.

## Rejected

- **Keep `originals/`, fix each reader.** Fixes the YAML tab, not the owner editing by hand,
  and every new reader must remember the layer.
- **Keep `originals/` but hidden (`.artisan/originals/`).** Same layer and same readers, plus
  content outside the hash that changes what players see.
- **Never touch a modified file at all** (the plain Bukkit rule). Silently loses a module's
  fixes in a menu the owner retouched once; the three-way merge already exists.

## Steps

1. **Server**: `SystemFiles.sync` writes the tree (decisions 1 to 5, 7); semantic YAML compare;
   shipped messages through the sync; base of every file in `.artisan/bases/`; the migration
   with its check; readers keep `originals/` as a lower layer for one release.
2. **Shipped content for the hub**: `required` in Presence; the hub's cache of shipped contents
   by hash; a route to read a shipped file (module, template, path).
3. **Editor**: states from origins and the cache (`domain/originals.ts` rewritten), compare,
   restore, view as shipped from the cache; `projectToFiles` writes Documents like any others;
   the originals layer removed (`shippedView.ts`, `shippedData.ts`, `keptLangEntries`,
   `Project.originals`, `OriginalBanner` fed by the cache).
4. **Packs**: both builders read the folder; vectors regenerated (`npm run pack -- vectors --write`).
5. **MCP**: `list_documents` gives each Document's state from origins; `read_document` reads a
   shipped file from the cache; `ORIGINALS_HOWTO` goes.
6. **Base theme `artisan`**: `ArtisanTheme` writes `themes/artisan/assets/` and `components/`
   in place; after `resources-one-screen` step 3, to avoid building the same screen twice.
7. **Release after**: remove the `originals/` lower layer, `CalendarFiles`' fallback,
   `.system()` / `.seed()`.
