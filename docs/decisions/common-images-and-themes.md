# An image belongs to a module or to the server, and a theme redraws it

**Status:** accepted (2026-11-25), **being built**: of step 2, the image keyed by its module and
the theme `artisan` are in the code (see "Built so far"); the rest is not. Replaces decisions 12
(the kit as a module), 14 and 16 of `mcp-server`: 12 and 14 are replaced in the code, 16 (one
theme per server, a folder beside the common images) describes it until step 4. Nothing
this ADR removes shipped in a release. Design note: `Images partagées, thèmes et originaux`
(project files). Follows `addon-owned-project-roots`, `project-qualified-refs` and the design
`originaux-modules`.

## Context

On 24 and 25 November the server got a UI kit: a base of 19 images in the jar, named
`kit:<name>`; a module `ui-kit` whose image of the same name replaces a base image; themes under
`ui-kit/themes/<name>/`, one in place per server. Using it showed six problems.

- **Three notions for one thing.** A module's image, a kit image and a themed image are all a PNG
  a menu names, under three sets of rules and a prefix. "Kit" also reads as `/kit` to a Minecraft
  admin.
- **The kit is a module the server has to create**, stored among the modules the owner made.
  "Create the kit module" tells an owner nothing, and a storage choice shows up as a step.
- **The base sits in the jar.** The owner cannot see what Artisan ships, be told when it changed
  or come back to it: the originals mechanism does not reach it.
- **A redraw at another size is dropped without a word**: the base image shows instead.
- **One theme per server.** A theme for one module cannot sit beside another theme, a theme
  cannot add an image, and a module's own PNG is never recoloured.
- **Another module's image is used by copying it.** The copy no longer follows the image it
  came from.

## Decisions

1. **The unit is the image.** There is no kit object and no `kit:` or `ui:` prefix. An image
   belongs to its module, which is the default, or is **common to the server**: Artisan's base
   and what the owner moves there. A module's image is removed with the module, exported with
   it and follows its versions; that is why not everything is common. The editor does not say
   "kit", "UI" or "variant" for any of this.

2. **Artisan's base is the theme `artisan`**, in `plugins/Artisan/themes/artisan/`:
   `originals/assets/` holds the base, written by the originals sync (`SystemFiles`, which
   writes only what differs, so nothing on a start where Artisan did not change);
   `assets/` holds the server's redraw of a base image (same name) and the common images the
   server added; `data/` holds the drawing notes a model reads. `themes/` is one more Project
   root. The theme `artisan` is not in the module list, cannot be renamed or deleted, and its
   name is reserved. `modules/` does not change.
   *Rejected:* a `ui-kit` module among the owner's modules (decision 12); a system module under
   `system/` (one more kind of folder for what a theme already is); the base in the jar
   (decision 14), which was chosen to spare a write at each start and a Project nobody edits,
   and costs the owner the originals.

3. **A menu writes a bare name.** `button.3x1` is the menu's module's image, else the common
   one. `guilds:banner` is the image of the module `guilds`, always. `artisan:button.3x1` is the
   common one even when the module has its own. A module may so replace a common image for its
   own menus only. A name nothing answers shows a visible fallback in game and a problem in the
   editor: there is no "elsewhere on the server when the name is unique" as for Documents
   (`project-qualified-refs`). One rule, the server's and the editor's, held by a shared case
   file like `doc-ref-conformance.json`.
   **This changes the pack and the runtime.** Today an image's key is its name alone, for the
   whole server (`AssetIndex`, `asset-index.json`): two modules that each hold `button.3x1`
   collide and one of the two shows in every menu. The key becomes the module and the name, in
   both pack builders, in the asset index and where the runtime looks an image up, which then
   needs the menu's module.

4. **An image states its function, and the function fixes its measures.** Menu (pixel size,
   and slots when the name ends with `3x1`), glyph (height and `ascent`), HUD (pixel size),
   or none. It is declared in the `<name>.yml` an image already has. An image that replaces
   another at other measures is not taken: the one below shows, and the editor reports a
   problem on the image. The silent fallback goes.

5. **A theme is a folder of images, in the format of a module**, under
   `plugins/Artisan/themes/<name>/`: its redraws of images that exist elsewhere
   (`overrides/<module>/<image>.png`, the base's under `overrides/artisan/`), its colour table
   (`overrides/colors.yml`), its own images (`assets/`, named `<theme>:<name>`, available while
   the theme is installed, in place or not) and its drawing notes (`data/`). It holds no
   Document: installing a theme adds no menu, command or Trigger to a server. It has its own
   screen and is not in the module list. Export, import, versions and updates are a module's.
   **A module draws what it owns; a theme redraws what others own.** A module that arrives with
   its images stays a module, and an add-on that wants a look for the whole server ships a
   theme beside its module.
   *Rejected:* a theme as an ordinary module (it would sit between `guilds` and `quests`, and
   a bought look could carry commands). A theme's `overrides/` has nothing to do with the
   retired `overrides/command/` of a module.

6. **Three layers, and the themes in place are a stack.** From the bottom: the original
   drawings (each image as its module or the theme `artisan` ships it), the server's redraws
   (originals mechanism), the themes in place. For each image the highest layer that draws it
   wins. `resource-pack.themes` of `config.yml` is the ordered list; `artisan` is not in it and
   is always below. A theme names no parent: the server composes. A theme may cover one module
   only (`scope: guilds`), and its colours then touch that module only, so "Christmas for
   Guilds" sits beside another theme. Taking a theme out gives the look back: the server's
   redraws were below and untouched.

7. **Colour ramps.** The base declares its ramps (primary, danger, neutral, accent) and their
   shades. In the editor the owner picks the colour a ramp becomes; the editor computes each
   shade at the same lightness and the theme's file keeps the exact colour-to-colour table. The
   two pack builders apply a table and never compute a hue, so they give the same bytes. An
   image is recoloured only if it says it follows the ramps: the base's images do, an image
   made in the atelier from one of them does, an imported PNG does not until the owner asks.
   Decision 16's caution stands: a table applied blindly repaints an icon that happens to share
   a green.

8. **Originals reach images.** The base and an add-on module's images are originals: the
   server's redraw is the owner's image of the same name, "restore the original" deletes it.
   Two things are added, for images and menus alike: the original shown beside the owner's
   version, and "the original changed since your redraw" (the owner keeps theirs, starts again
   from the new original, or restores).

9. **Items stay in modules.** A Captured item is a serialized stack of the game, with no pixel
   to redraw: it is content, like a menu. The common scope is for images and fonts. An item
   shared between modules is a later step, by reference from an ordinary module.

10. **Export follows what a module names elsewhere.** In the base: Artisan's minimal version is
    recorded. A common image the server added: copied into the archive under the same name and
    marked as common at the origin; thanks to "the module first", no menu is rewritten. In an
    add-on's module or in a theme: a declared dependency. In another module of the server:
    embedded on request. At import a copy marked common is settled without a question:
    dropped when the server has the same image under that name, kept in the module otherwise
    (the editor offers to make it common when no common image has that name). A theme is
    exported alone; a module takes the look of the server it arrives on.

11. **The pack holds only what is named**, as today: a common image enters the pack when a menu
    or a module names it, and a server that names none keeps its pack byte for byte.

12. **One Resources screen.** The module selector gains "Common" (images and fonts); the
    server opens the screen on the whole server, a module on itself. Each image shows who
    provides it, its state (original, redrawn, original updated) and where it is used; it can
    be redrawn, restored, and moved or copied to another scope. Themes have their own screen:
    installed themes and the stack in place. The server's "UI kit" tab goes.

## Migration

Nothing below shipped in a release; only test servers hold it.

| Today | Becomes |
|---|---|
| `kit:button.3x1` in a menu | `button.3x1`; the old form stays read |
| The base in the jar | `themes/artisan/originals/assets/` |
| `ui-kit` module, image named like a base image | the server's redraw: same name in `themes/artisan/assets/` |
| `ui-kit` module, another image | a common image in `themes/artisan/assets/` |
| `ui-kit/themes/<name>/` | the theme `themes/<name>/` |
| `resource-pack.theme` | `resource-pack.themes`, a list; the old key stays read |
| `ui-kit/data/ui-kit.yml` | the same file in `themes/artisan/data/` |
| MCP tools `survey_ui`, `write_image`, `render_menu` | same names and arguments, reading the new places |

A module's existing images do not move, and the menus that name them stay valid. One visible
change: on a server where two modules hold an image of the same name, each module's menus now
show their own, where today one of the two shows everywhere. A menu that names, without a
prefix, an image only another module holds (allowed today, the index being the server's) keeps
working through a rewrite to `module:name` at load.

## Steps

1. This ADR and the glossary.
2. Common images: the theme `artisan` and its root, the base through originals, the naming
   rule and `module:name`, both pack builders and their vectors, the migration of `kit:` and
   `ui-kit`; in the editor, the common scope, and the kit tab removed.
3. Function and measures.
4. Themes: the stack, scope, ramps, the Themes screen, export and import of a theme, the
   migration of today's themes (which keep working until this step).
5. Originals shown: side by side, restore, "the original changed".
6. Export and import with dependencies and embedded common images.

## Built so far

**Step 2, first part: an image is keyed by its module** (`ImageNames.kt`, `imageNames.ts`,
`ImageRefs.kt`, `testdata/image-ref-conformance.json`).

- The first module, by Project order, that holds an image of a name keeps the bare name as its
  id in the pack: a server where no two modules share a name keeps its pack byte for byte. A
  later module's image of that name is `<folder>:<name>`, its files under `modules/<folder>/`.
- A name in a menu is read with the menu's module: its own image, then the bare id.
  `<module>:<name>` reaches that module's image. Both pack builders, the game (titles, image
  buttons, row images, `dump-title`) and `render_menu` follow the one rule, computed from the
  ids alone so the game needs nothing but the asset index.

**Step 2, second part: the theme `artisan`** (`ArtisanTheme.kt`, `ProjectRoots.theme`, `Kit.kt`,
`kit.ts`, `UiBase.kt`).

- `plugins/Artisan/themes/artisan/` is registered at start as the Project `artisan`, with
  `role: "theme"` in the Project roots: the editor leaves it out of the module list, and the hub,
  the drafts and the Versions treat it as they treat an Add-on's root (key `addon:artisan`, not
  renamed or deleted). **A theme shares the modules' namespace**: no module can be named
  `artisan`, and a folder `modules/artisan` is shadowed with a warning.
- The base is written by the originals sync into `themes/artisan/originals/assets/textures/`
  (system template `base` of the shipper `artisan`, `SystemFiles`): only what differs is
  written, and a server image identical to the base is removed. Both pack builders read the
  base there, so the base a server shows is the one of its own Artisan; a builder falls on its
  own copy for a server that has none yet.
- `modules/ui-kit/` moves to `themes/artisan/` at the first start, when the theme holds nothing
  of the server's. On a server that has no theme `artisan` (an older Artisan), both builders and
  the editor still read the `ui-kit` module.
- A common image keeps the pack id `kit:<name>`. The naming rule gains two steps:
  `artisan:<name>` is the common image, and a name no module holds reaches the common image of
  that name (the three places, `image-ref-conformance.json`). `kit:<name>` stays read.
- The theme's own images are not rows of the pack: one enters it as `kit:<name>` when a menu
  or a module names it (decision 11), the base included.
- The MCP tools read the common images in the theme's Project (`survey_ui`'s `kit.project`), the
  base as the server holds it; their names and arguments did not change.

**Step 2, third part: the common images in the editor** (`ProjectSource.tsx`, `AssetsTab.tsx`,
`kitAssets.ts`, `servers.$serverId.common.tsx`).

- The editor says "common images", never "UI kit". The server's tab is **Common images**
  (`/servers/<id>/common`); it no longer offers to create a module, the theme being there from
  the server's start.
- The picker writes the name alone, or `artisan:<name>` when the open module holds an image of
  that name, deployed or not. On a server that has no theme `artisan` it still writes
  `kit:<name>`, the only spelling that server reads.
- The Resources screen's module selector has an entry **Common images**: the published common
  images, what a menu of the open module writes for each, and a way to the atelier of the
  common images. The theme's Project is not one of its "other modules", nor part of "all
  modules".

**Step 2, fourth part: the common image before another module's** (`ImageNames.common`, in both
builders; `ImageRefs.kt` did not change).

- A builder is told the common images' names before it names any module's image: the theme's
  own, the base as the server holds it, and the base's 19 names. A module's image of such a
  name is `<folder>:<name>`, the first module's included. A bare id is therefore never an image
  a common one shares its name with, and the rule the game already had (own id, bare id, common
  image) gives decision 3's order from the ids alone: the menu's module's image, the common
  one, then another module's.
- What changes on a server: a module whose image has a common image's name (`button.3x1`) has
  it under `modules/<folder>/` in the pack, and another module's menu that named it by the name
  alone now shows the common image. `<module>:<name>` reaches it as before. A server where no
  module's image has a common image's name keeps its pack byte for byte.
- A server older than the theme `artisan` (its common images are the module `ui-kit`) keeps the
  ids it had.

**Step 2, fifth part: what the MCP tools say and write** (`McpTools.kt`).

- The tools' texts say "common images". `survey_ui` gives each image of the base under its
  name alone, what a menu writes; `write_image` in the theme's Project says the same of the
  image it wrote. A composed image's layer is `artisan:<name>` (`kit:<name>` stays read).
- On a server that has no theme `artisan`, `survey_ui` still gives `kit:<name>` and says that
  this server reads nothing else.

**Step 2, sixth part: where a common image is used** (decision 12, "where it is used").

- The common images' page says, under each image, how many deployed menus name it.
- In a module's Resources, a common image lists the menus of the server that name it, each a
  link to that menu; the open module's menus count as its draft holds them.
- A menu names a common image by the rule it is read with (`commonNameOf`): `artisan:<name>`
  and `kit:<name>` always, a name alone when its module holds no image of that name.

**Decision 12, first part: the server's Resources** (`ServerResources.tsx`, `imageUses.ts`,
`servers.$serverId.resources.tsx`).

- The server's **Common images** tab is gone. Its **Resources** tab is the Resources screen on
  the whole server: every module's images and fonts and the common images in one list, as
  deployed; **Show** narrows it to one module, or to the common images, whose page (pieces by
  family, the trial menu, the themes) is the one the old tab had.
- Each image shows who provides it, and the menus that name it, each a link to that menu. A
  module's image is named by a menu of its module that writes its name, and by a menu of
  another module that writes `<module>:<name>` (`imageNamedBy`).
- The list changes nothing: an image opens where it lives, in its module's Resources or in the
  atelier of the common images.

**Step 3, first part: a common image that is not taken is reported** (`kitAssets.ts`,
`CommonImageState.tsx`).

- The server's image of a base piece's name at another size than the piece's was already not
  taken by the pack, silently. The editor now says so: **Not taken**, with the image's size and
  the piece's, on the common images' page, in the Resources lists, and on the image itself in
  the common images' Project.

**Step 5, first part: the original beside a redrawn piece** (`CommonImageState.tsx`).

- A piece of the base the server drew its own version of shows Artisan's original beside it:
  in the Resources lists and in the common images' Project, where deleting the server's image
  is named **Restore the original**.

**Step 5, second part: the original changed since the server's version** (`SystemFiles.keep`,
`OriginalChanged.tsx`).

- The originals sync already records, in `.artisan/origins.yaml`, the original an owner's file
  at a shipped path was made against, and leaves an image alone when its original changes.
  The editor reads the two hashes: when they differ, the image says the original changed
  since the owner's version, in any module.
- **Keep mine** is a request of its own to the server (`project_origin_keep`, protocol 1.10),
  which records the current original beside the owner's file: only the server writes
  `.artisan/origins.yaml`. "Start again from the new original" is restoring it, then
  redrawing: no third action.
- Limit: the origin of an owner's file is recorded at the first originals sync that sees it
  (a start or a reload), not when it is deployed. An original that changes between the
  deploy and that sync is not flagged.

**Step 5, third part: a module's images** (`imageStanding.ts`, `localAssets.ts`).

- Saving, in the atelier, an image the module ships and the owner does not hold writes the
  owner's version beside the original: same name, size, codepoint, ascent and uses. It was
  refused (`not_found`), so a shipped image could not be redrawn from the editor.
- The owner's version of a shipped image shows the module's original beside it, and its delete
  is **Restore the original**. An image as shipped offers nothing to rename or delete: the
  owner holds no file. The same holds in the common images' Project, where a piece of the
  base as shipped was offered a restore that could only fail.

Not there yet:

- Against decision 3: a name that neither the menu's module nor the common images hold still
  reaches **another module's** image of that name (no rewrite to `module:name` at load, no
  problem shown in the editor). `<module>:<name>` for an image that module does not hold falls
  on the bare name, then on the common image, instead of the visible fallback, because the
  asset index does not say who holds a bare id.
- Against decision 1: the MCP tools keep the names `kit`, `kit_base`, `kit_format`,
  `kit_colours` and `kit_draft_id` in what they take and return, and the notes file is still
  `data/ui-kit.yml`. In the editor, a composed image's layers still hold `kit:<name>`.
- Against decision 12: the server's Resources and a module's are two components, the first
  read-only. Both read the common images as published, so an image drawn in the theme's draft
  shows there once deployed. The uses count menus only: an image named by a dialog, an overlay
  or a composed image's layer is not counted yet. The change of an original and a module's
  original show on the image in its module only, not in the server's list, and the module's
  list does not mark which images are the owner's versions (step 5). An image cannot be moved or copied to another scope from the server's list. Themes have
  no screen of their own yet: they are reached from the common images' page.
- Against decision 4: an image does not declare its function yet. Only the base's pieces
  have fixed measures (their pixel size, from Artisan's own list); a module's image that
  replaces its original (`originals/`) at other measures is still taken, and nothing is said
  of a glyph's height and ascent or of a HUD image. The editor reads a redrawn piece's size
  from its descriptor, the pack from the PNG.
- Against decision 8: "the original changed since your redraw" is not there (a redrawn image
  records no origin), and neither the side by side nor the restore reach an add-on module's
  images or a menu.
- Against decisions 5 and 6: a theme other than `artisan` is still a folder
  `themes/artisan/themes/<name>/`, one in place per server (`resource-pack.theme`).
- An overlay image keeps its key on the name the add-on asks with (`OverlayApi.image` has no
  module), so two modules asking for the same name at the same rise share one picture.
- The editor draws the base from its own build, not from the server's `originals/`: the two
  differ only while the editor and the server run different versions of Artisan.

## Consequences

- A menu written against the base keeps its layout whatever the server and the themes draw:
  names and measures are fixed by the theme `artisan` alone.
- The owner sees the base, redraws it in place and comes back to it.
- Copying a module's folder by hand from one server to another may give an incomplete module;
  the check at load reports what is missing.
- The glossary gains **Theme**, which it refused as a term for a Variant: a theme changes
  pixels only.

## Read in the code on 2026-11-25

- The pack keys an image by its name alone (`ResourcePackBuilder`, `AssetIndex`; the Bedrock
  pack keeps the first module's): decision 3 says what step 2 changes.
- The core registers a Project root itself (`ProjectRoots`, `registerProjectRoot`), so
  `themes/<name>/` needs no new mechanism.
- `SystemFiles` keeps where an owner's file came from (`.artisan/origins.yaml`, the version and
  its hash) and merges YAML files only; a file that is not YAML stays as the owner left it. An
  image the owner redraws has no origin today: decision 8's "the original changed" records one
  when the redraw is written.

## Still to check

- On a running network: that the hub's sync to the other servers and the drafts treat the
  theme's root as they treat an Add-on's (the code path is the same; no test covers a leaf).
- What the editor's own lookup does when two modules hold the same name: it shows the open
  module's images and the common ones, never another module's.
