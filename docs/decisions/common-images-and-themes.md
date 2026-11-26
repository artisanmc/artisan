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
| MCP tools `survey_ui`, `write_image`, `render_menu` | same tools, reading the new places; what they return and take says `common` and `base` (`kit_draft_id` is still read as `common_draft_id`) |

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
- The MCP tools read the common images in the theme's Project (`survey_ui`'s `common.project`), the
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
- What `survey_ui` returns is named for what it is: `common` (the common images' Project, its
  notes and the themes), `common_format`, `common_colours`, `ramps` and `base`, formerly `kit`,
  `kit_format`, `kit_colours`, `kit_ramps` and `kit_base`. `render_menu` takes
  `common_draft_id`; `kit_draft_id`, its former name, is still read.

**Step 2, sixth part: where a common image is used** (decision 12, "where it is used").

- The common images' page says, under each image, how many deployed menus name it.
- In a module's Resources, a common image lists the menus of the server that name it, each a
  link to that menu; the open module's menus count as its draft holds them.
- A menu names a common image by the rule it is read with (`commonNameOf`): `artisan:<name>`
  and `kit:<name>` always, a name alone when its module holds no image of that name.

**Step 2, seventh part: the deploy review reads every name the module writes**
(`checkImageIssues` and `ImageWriters` in `serverChecks.ts`, `imageWriters` in `imageUses.ts`).

- The review read the menus alone. It also reads the files of the module's kinds that ask the
  pack for images (a HUD of an add-on), by the menus' rule: a name no one holds, and a name
  alone that reaches another module's image, are said with the files that write them.
- A composed image's layer is read by another rule (`renderComposed`): a common image by its
  whole name (`artisan:<name>`, `kit:<name>`), else a PNG of the module, never another
  module's image nor another composed image. A layer that takes nothing is left out of the
  picture without a word; the review now says so, one line per composed image.
- Both are read as the draft holds them. In the common images' Project, an image the draft
  adds counts as common: it is one once deployed.

**Step 2, eighth part: the picker names another module's image where it is**
(`AssetPicker`'s `named`).

- The picker of a button's image and of a title layer, shown another module, offers **Name it
  in its module, without a copy**: the image picked is written `<module>:<name>`, nothing
  enters the open module, and the menu follows what that module deploys.
- Unticked, which is the default, the image is copied as before: a module that copies does not
  depend on another. The choice is offered only where the caller writes a name the pack
  resolves (`named`), on a server that reads names by this rule, for a module the editor can
  draw from (`useKitStore.modules`).
- An image whose descriptor states no size is measured from its PNG, as in the common picker.

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

**Step 3, second part: an image states its function** (`imageFunction.ts`, `ImageFunctions` in
`Assets.kt`).

- `function: menu | glyph | hud` in an image's descriptor; anything else, or no key, is none.
  The measures it fixes: the pixel size for `menu` and `hud`, the descriptor's `height` and
  `ascent` for `glyph`.
- Both pack builders apply one rule to a module's images: the owner's image of the name of an
  original (`originals/…`) that declares a function is taken at the original's measures only.
  Otherwise it is left out with its descriptor, and the original shows with its own. The
  function that counts is the original's: an original without one is replaced at any size, so
  no pack changes until a module declares a function. One case of the shared vector locks it.
- The editor keeps the key on every write of a descriptor, sets it from the image's advanced
  fields, and reports the owner's version that is not taken on the image, with both
  measures. It measures a menu or HUD image by the size its descriptor states (an image that
  states none is taken as fitting), the pack by the PNG.

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
- The origin of an owner's file is recorded when it is deployed (`SystemFiles.madeAgainst`,
  in the commit of `project_write` and of `project_draft_publish`): the original the folder
  holds at that moment, the one the owner saw. It was recorded at the first originals sync
  that saw the file, so a redraw deployed before a module update took the *new* original as
  what it was made against, and the change was never said. A YAML file's base is kept in the
  same commit, so it merges at that update. A file already there keeps its origin; one
  restored then redrawn takes the original of now.

**Step 5, third part: a module's images** (`imageStanding.ts`, `localAssets.ts`).

- Saving, in the atelier, an image the module ships and the owner does not hold writes the
  owner's version beside the original: same name, size, codepoint, ascent and uses. It was
  refused (`not_found`), so a shipped image could not be redrawn from the editor.
- The owner's version of a shipped image shows the module's original beside it, and its delete
  is **Restore the original**. An image as shipped offers nothing to rename or delete: the
  owner holds no file. The same holds in the common images' Project, where a piece of the
  base as shipped was offered a restore that could only fail.

**Step 5, fourth part: the module's list marks its images** (`imageMarks` in
`imageStanding.ts`, `AssetGrid`'s `markOf`, `McpTools.listDocuments`).

- In a module's **Resources**, the tile of the owner's version of a shipped image carries a
  dot, and its tooltip says so. The dot is the warning's when the pack does not take the
  image (decision 4): the list says it before the image is opened.
- `list_documents` lists the images that are not taken (`images_not_taken`: the path, the
  original that shows, its function, the measures to draw at), as `read_image` says of one.

**Step 4, first part: the themes in place are a stack** (`ThemeStack` in `Theme.kt`,
`kitThemeStack` in `theme.ts`, `EditableConfig.kt`).
`resource-pack.themes` of `config.yml` is the ordered list of decision 6, the lowest first, on
today's theme folders (`themes/artisan/themes/<name>/`). Both pack builders fold the list:
each theme is applied to what the ones below show, so the highest that redraws an image wins
as drawn, a theme of colours alone repaints what is below it, and the colours of a theme
above a drawing repaint that drawing (a composed common image's too). A theme the server does
not hold is left out. One theme in place gives the pack it gave before, byte for byte (the
vector's former case is unchanged; a second case locks a stack of three and one missing).
The former `resource-pack.theme` is read while the list is empty, and a server reports it
still, as its highest theme, so a hub older than the list keeps building its pack in one
theme; the first write of either key leaves the list alone in the file. In the editor the
theme's page puts a theme on top of the stack or takes it off (`themeChange`), the common
images' page lists the themes in place first, numbered from the lowest, and the Configuration
page holds the list in order; against a server older than the list, the former key is written.
The MCP tools show the server's images in its stack (`common.in_place` in `survey_ui`, `themes` on
a render) and draw one theme alone when asked for it.
Not in this part: a theme as its own folder `themes/<name>/` with `overrides/` (decision 5), a
theme's redraw of a module's image and `scope`, colour ramps (decision 7), ordering the stack
by hand elsewhere than in the Configuration list, and a preview of a theme within the stack
(the theme's page compares it alone against no theme).

**Step 4, second part: a theme read from its own folder** (`ServerThemes.kt`, `KitTheme.own`
in `Theme.kt`, `readOwnTheme` in `theme.ts`, `kitStore.own`).
Each folder of `plugins/Artisan/themes/` other than `artisan` is a theme of decision 5,
registered at start as the Project of its name with the role `theme`: `overrides/colors.yml`
is its table, `overrides/artisan/<image>.png` its redraw of a common image, with the rules of
the first part (256 colours, a drawing at the image's size only). It holds no Document: the
server reads no menu, command or Trigger from it, and neither pack builder, the server's
Resources nor the MCP survey counts it as a module. A folder named like a module is left
unregistered, with a warning: the module keeps the name. A name of the stack is read from the
theme's own Project when the server has one, else from the folder the common images keep for
it (`themes/artisan/themes/<name>/`), so a server's themes and its pack are unchanged (the
vector locks the same stack in either place to the same bytes). The editor lists both, shows
and stacks them alike, and the MCP tools draw them alike (`common.themes[].project` in
`survey_ui` names a theme's own Project).
A theme's folder is read at start: one added by hand shows after a restart.

**Step 4, third part: a theme is created and written in its own folder**
(`ServerThemes.create` and `migrate`, `create_theme` in `McpTools.kt`, `NewThemeDialog.tsx`).
`project_create` takes `role: "theme"` (protocol `1.11`): an empty folder `themes/<name>/`,
registered at once, under a name no module, theme or folder has. The editor's **New theme**
(common images' page) and the MCP tool `create_theme` send it, with the permission that
creates a module. In a draft of a theme's Project, `write_document` takes one file, its table
`overrides/colors.yml`, checked by the hub (the server checks Documents, and a theme holds
none), and `write_image` writes the theme's drawing of the common image it names, at that
image's size, to `overrides/artisan/<name>.png`; `render_menu` draws a menu in a theme as a
draft of it has it (`theme` with `theme_draft_id`). On such a server the former place is no
longer written (`themes/<name>/theme.yml` and `write_image theme=` in the common images are
refused, with the way to the theme's Project); against a leaf older than `1.11` the tools
write it as before. At start, each theme the common images kept moves to its own folder, its
files put at a theme's places; one whose name a module has, or whose folder holds files
already, stays where it is and is still read there. A name's place in the stack and the pack
do not change (the vector locks both places to the same bytes).
Not in this part: deleting or renaming a theme from the editor (its folder is moved by hand);
editing a theme's colours in the editor (the assistant or the file); a theme's own images
(`assets/`, `<theme>:<name>`) in the pack; a draft of the common images that still held a
former theme, which would write that folder back when deployed (the theme's own folder wins).

**Step 4, fourth part: a theme redraws a module's image** (`moduleDrawing` in `Theme.kt` and
`theme.ts`, both pack builders).
`overrides/<module>/<image>.png` in a theme's folder is its drawing of the image `<image>` of
the module whose folder is `<module>`, taken when it has that image's size and left out
otherwise, like a redraw of a common image. The image keeps its id, its descriptor and its
measures: a glyph stays a glyph of that height. Among the themes in place the highest that
redraws the image wins, as drawn. No theme's colours touch a module's image, drawn by a theme
or not: which images follow the colours is decision 7's (ramps), not built. A module's
composed image follows the redraw of its own layers and is not redrawn itself. The vector
locks it in both builders and both packs. The MCP tools write one (`write_image` in a draft
of the theme, `name` as `<module>:<image>`), list them (`common.themes[].module_redraws` in
`survey_ui`) and draw a menu with them (`render_menu`); a theme's page lists them.
Not in this part: `scope` (a theme of one module, whose colours touch that module: it needs
decision 7's "follows the ramps"); the editor's canvas and a module's Resources, which show a
module's image as the module holds it, not as a theme in place redraws it; an add-on's
original beside a theme's redraw.

**Step 4, fifth part: which images a theme's colours repaint, and a theme of one module**
(`KitTheme.shown` and `moduleShown` in `Theme.kt` and `theme.ts`, `DiskAsset.ramps`, both pack
builders).
An image follows the ramps when it is the base's (the theme `artisan`'s own drawing, as
shipped) or when its descriptor says `ramps: true`, for a common image and a module's alike
(decision 7). A theme's table of colours repaints those and no other: an image that does not
follow is a theme's drawing of it, as drawn, or itself. The earlier parts repainted every
common image and no module's image; no server had a theme in place. Through the stack an
image that follows takes each theme in turn (its drawing, else its colours over what the ones
below show); one that does not takes the highest theme's drawing. A composed image says
nothing of the ramps: it follows its layers, and a theme's drawing of it is taken as drawn.
The owner's version of an image a module ships reads the shipped descriptor unless it comes
with its own (the rule of every descriptor), so it follows when the original does.
`scope: <module>` beside `colors` in `overrides/colors.yml` keeps a theme's colours to the
images of that one module, `scope: artisan` to the common images; without it they reach
every image that follows the ramps. A scope narrows the colours only: what a theme redraws
is named by its path. A scope that is not a text is no scope.
In the editor an image's panel has **Follows the themes' colours**; the server's version of a
base image, first drawn over the base in the atelier, has it set, an imported image does not,
and a retouch or a rename keeps what the image said. A theme's page says what its colours
reach. The MCP tools: `write_image` takes `ramps`, `survey_ui` marks the images that follow
and gives a theme's `scope`, `render_menu` draws accordingly, and a theme's file is checked
for its `scope`. The vector locks it in both builders and both packs (one case), with twin
unit cases.
Not in this part: an image made in the atelier from a base image under another name, which
does not get the flag by itself; the editor's canvas and a module's Resources, which show a
module's image as the module holds it, not in the colours of a theme in place.

**Step 4, sixth part: the ramps declared, and one colour picked per ramp** (`ramps.json`
beside the base, `ramps.ts` and `Ramps.kt`, `KitThemePage`).
The base declares its four ramps, `primary`, `danger`, `accent` and `neutral`: each colour of
its images is in one ramp and one only, with the ramp's main colour (a button's face, a
window's body). The declaration is one file, `editor/src/assets/kit/ramps.json`, shipped in
the jar beside the base; a test on each side checks that it covers the base's images colour
for colour, so an image added to the base in a new colour fails until the colour has a ramp.
A theme changes a ramp by the colour its main one becomes (decision 7). Each shade takes the
picked colour's hue, its saturation in the proportion it had to the main colour's (the picked
one's for the greys), and keeps its place between black, the main colour and white. This is
not the "same lightness" the decision words: the main colour becomes the picked one exactly,
which is what the owner chose, and the shades keep their order around it, so a dark red
button still has a darker edge and a lighter highlight; black stays black and white stays
white. The result is written as the exact colour-to-colour table: the builders compute
nothing, as decided.
In the editor the page of a theme of its own folder has one colour to pick per ramp. The menu
beside is drawn with the table being picked, before anything is written; **Save the colours**
writes `overrides/colors.yml` on the server (`saveThemeColors`: the file's other keys, such
as `scope`, are kept, a file changed since it was read is refused), and rebuilds the pack
when the theme is in place. The page also opens the theme's Project, where a draft of it is
deployed. The MCP tool `theme_colours` computes the same table from the same picks
(`Ramps.table`, checked against the editor's on `testdata/ramp-shades-conformance.json`), and
`survey_ui` gives the ramps (`ramps`).
Not in this part: a theme the common images' Project still keeps has no picker (it moves to
its own folder at the server's next start); a theme's `scope` is still written by hand or by
the assistant; a table written by hand that changes a ramp's shades without its main colour
shows the ramp as unchanged, and picking a colour for it replaces those entries.

**Step 4, seventh part: the Themes screen** (`ThemesPage.tsx`, decision 12).
The server's Resources offer **Themes** beside the whole server and the common images
(`?show=themes`): the stack in place, the highest first, over a fixed last row for Artisan's
images and the server's, then the themes the server holds that are not in place. Each row
says what the theme changes (colours replaced, images redrawn, the one module it is kept to)
and opens its page. A theme is dragged to another place in the stack (`themesMoved` gives
the server's order, the lowest first, written to `resource-pack.themes`), put in place or
taken off; each change rebuilds the pack. A name the configuration puts in place that no
folder of the server holds is listed as not found, to be taken off. On a server older than
the list there is one theme in place at most and nothing to reorder. The common images' page
keeps its row of themes as a shortcut and links to the screen; a theme's page goes back to
the page it was opened from.
Not in this part: deleting or renaming a theme (the server's folder operations reach modules
only), and a theme's export and import.

**Step 4, eighth part: a theme is renamed and deleted** (`ServerThemes.rename` and `.delete`,
`ThemeMoves.tsx`, protocol minor 12).
`project_rename` and `project_delete` reach a theme of its own folder: the folder moves
within `themes/` (its drafts and history with it), or to `themes/.artisan-trash/`, never
erased, and the theme is a Project of the server under its new name, or no more. The theme
`artisan` is refused (`addon_immutable`), and so is a name a module, a theme or a folder of
`themes/` has (`destination_exists`). The server leaves `resource-pack.themes` alone: the
page of a theme, which offers **Rename** and **Delete** when the server says it moves the
folder (`capabilities.canRename` of the Project's summary, kept as `KitRead.canMove`),
moves the folder first, then writes the list (`themesRenamed`: a renamed theme keeps its
place; a deleted one leaves it) and rebuilds the pack when the theme was in place. A name
left in the list with no folder changes nothing and shows as not found on the Themes screen.
Not in this part: a theme's export and import; putting a deleted theme back from the trash
is done in the server's files.

**Step 4, ninth part: a theme is exported and imported** (`themeArchive.ts`,
`runExportThemeZip`, `runImportTheme.ts`, `ImportThemeDialog.tsx`; decisions 5 and 10).
A theme's archive is its folder as the server holds it, its files at the top, named
`<name>.theme.zip`: a theme is exported alone, it holds no menu and embeds nothing of a
module. The page of a theme of its own folder has **Export**. The Themes screen has
**Import a theme**: the archive is read in the browser (`themeArchiveFiles`: what is under
`overrides/`, `assets/` and `data/` of the shallowest folder that has one of them, 8 MB at
most; an archive that holds a module's file is refused as a module's, one that holds several
themes side by side as no theme's), the name proposed is the file's, and the theme is made
on the server by what already exists: `project_create` with `role: "theme"`, then
`project_write` with the files, the images among them (in batches of 2 MB). It arrives
installed and not in place. When a write is refused the folder just created is deleted
again. Nothing new on the server or in the protocol.
Not in this part: importing over a theme the server has (the name must be free: no update,
no merge, no version of a theme), and an MCP tool for either.

**Step 4, tenth part: a theme's own images in the pack** (`ImageNames.themeOwn` in both
builders, `packAssembly.ts`, `ResourcePackBuilder.kt`; decisions 5 and 11).
An image under `assets/` of a theme's Project (any theme but `artisan`, whose `assets/` are
the common images) is `<theme>:<name>`, while the server holds the theme, in place or not.
The id never is the bare name, so a name alone does not reach one: a menu, a title or a
module's kind writes `<theme>:<name>`. It is in the pack only when named (decision 11), its
files under `themes/<theme>/`, shown as its file is: the themes in place neither repaint nor
redraw it. A glyph keeps its descriptor, its codepoint after the modules' and the common
images'. The game finds it by the asset index like any id (`ImageRefs`, unchanged). A theme
whose folder is a module's gives none (`<folder>:<name>` is that module's), and of two images
of one name in a theme the first read keeps the id. The two vectors lock it
(`image-ref-conformance.json`: `themes`; `resource-pack-conformance.json`: one case).
Not in this part: a composed image of a theme (not taken); the editor, which neither draws
nor offers a theme's own image and reads `<theme>:<name>` as a name no image answers
(`reachOf`); the MCP tools, which do not write one; the archive's note, which does not say a
module names one.

**Step 4, eleventh part: the editor reads a theme's own image** (`reachOf` and `themeOwnNames`
in `lib/pack/elsewhere.ts`, `kitAssets.ts`, `ImageReachNote.tsx`, `imageHolders.ts`,
`KitThemePage.tsx`).
`reachOf` answers `{ kind: "theme" }` for `<theme>:<name>` when the theme holds that image
and no module has the theme's folder, as the pack does. The editor draws it in a menu (a
button, a title layer, the inspector) from the theme's published file, says under the name
which theme it is, and no longer flags it in the deploy review; its name alone still reaches
nothing and is flagged. The page of a theme of its own folder lists its own images, each as
a menu writes it. A theme's own images are its PNGs under `assets/`, the first of a name,
a composed one left out, as in the pack.
Not in this part: choosing one in the image picker (the name is typed); a draft of the
theme (the images are the published ones); the MCP tools; the archive's note.

**Step 4, twelfth part: the MCP tools write and draw a theme's own image** (`McpTools.kt`:
`writeImage`, `Images.own`, `renderMenu`, `survey_ui`).
In a draft of a theme's own Project, `write_image` with `name` as `<theme>:<image>` (the
theme's own name before the colon) writes the theme's own image like a module's
(`assets/textures/` or `assets/glyphs/` by `use`, with its descriptor), at any size; any other
name stays the theme's drawing of a common image or of a module's. `compose` and `ramps` are
refused: the pack takes one drawn PNG and shows it as drawn. `render_menu` draws
`<theme>:<name>` as the theme's file is, deployed or as `theme_draft_id` has it, the theme in
place or not, and no theme's redraw applies to it. `survey_ui` lists them
(`common.themes[].own_images`, each as a menu names it) and `themes_format` says how.
Not in this part: the archive's note (Step 6, third part).

**Step 4, thirteenth part: the picker offers a theme's own images** (`KitPicker.tsx`,
`useThemesOwnImages` in `kitAssets.ts`).
The picker of common images (**Common** on a button's image and on a title layer) lists,
after the common images, the own images of the server's themes, each under the name a menu
writes (`<theme>:<name>`). Picking one names it where it is: nothing is copied, and the menu
writes that name. One whose descriptor says no size is measured from its PNG when picked, so
a button takes its footprint. Until then the editor had no way to write such a name but the
menu's file or the assistant.

**Step 6, first part: a module's archive says what it names elsewhere** (`lib/pack/elsewhere.ts`,
`exportElsewhere.ts`, `runImportZip.ts`; decision 10). The export reads the image names the
module writes as the pack reads them and tells who holds each one. A common image the server
added, reached by its name alone, is copied into the archive at the path it has in the theme
`artisan`, and the archive's note (`artisan-export.yml`, `schema: export/v1`) marks it as
common at the origin; no menu is rewritten, the module's copy answers first. The note also
records the base images named with the origin's version of Artisan, and what a copy cannot
answer: a common image named as `artisan:<name>` or composed, and the images of other modules
by folder. A module that names its own images only keeps the archive it had. At import the
note is read and never written; a copy is dropped when the server's common image of that name
is the same PNG, kept in the module otherwise, without a question; the base images, common
images and modules the server lacks are listed before anything is written. Nothing new on the
server or in the protocol.
Not in this part: embedding another module's images on request (they are noted, never
copied), a declared dependency the server checks at load, fonts, and the MCP tools.

**Step 6, second part: another module's images are embedded on request** (`reachOf`,
`imageCopy`, `embedNames`, `renameImageRefs` in `elsewhere.ts`; `EmbedImagesDialog.tsx`;
decision 10). When the module's own menus name images of another module of the server, the
export asks. On yes each image is copied into the archive as an image of the module, under
its name when a name alone reached it or when that name is free there, else `<name>_2`…, and
the menus of the archive that wrote `<folder>:<name>` write the new name. Only the archive is
rewritten, never the server's files: here a rewrite is what makes the module's own image
answer, where a common image's copy needs none. An add-on's module is a dependency: its
images are noted, never offered. What is embedded leaves the note.
Not in this part: an image named by a kind's file, a composed image's layer or a menu the
module ships is not rewritten, so it stays a dependency even when the menus' one is embedded;
a composed image of another module is not copied.

**Step 6, third part: a theme's own image is a dependency of the archive** (`namedElsewhere`,
`ExportNote.requires.themes`, `exportElsewhere.ts`, `settleElsewhere` in `runImportZip.ts`;
decisions 5 and 10). A module that names `<theme>:<name>` depends on that theme: the image
is never copied nor offered for embedding, it comes with the theme. The note lists such
images by theme (`requires.themes`), read from the themes a name qualifies. At import, each
is checked against the server's themes: the theme absent (a module of that folder is no
theme), or without an image of that name, is said before anything is written, with the way
to import the theme. A note written before this part has no `themes` and reads as before.
Not in this part: exporting the theme along with the module (two archives, two imports).

Not there yet:

- Against decision 3: a name that neither the menu's module nor the common images hold still
  reaches **another module's** image of that name (no rewrite to `module:name` at load). The
  editor says so where the name is written (`ImageReachNote`: the button editor and a title
  layer's form, with a button that writes `<module>:<name>`) and in the deploy review
  (`checkImageIssues`: a warning per name, with the menus and the kinds' files that write
  it, and the layers of a composed image that take nothing), both read against
  the other modules and the common images as published. The editor draws another module's image from its
  published file: not a composed one, and not as a theme redraws it. Its picker names
  another module's image where it is on request only (step 2, eighth part): the copy stays
  the default, and dragging a thumbnail of another module still copies. `<module>:<name>` for an image that
  module does not hold falls on the bare name, then on the common image, instead of the
  visible fallback, because the asset index does not say who holds a bare id.
- Against decision 1: the notes file is still `data/ui-kit.yml`, and `render_menu` still reads
  `kit_draft_id` beside `common_draft_id`. In the editor, a composed image's layers still hold
  `kit:<name>`.
- Against decision 12: the server's Resources and a module's are two components, the first
  read-only. Both read the common images as published, so an image drawn in the theme's draft
  shows there once deployed. The uses count the menus, the composed images' layers and the
  files of the kinds that ask the pack for images, the open module's as its draft holds
  them; a name the pack does not read (in a text) counts nowhere. The change of an original and a module's
  original show on the image in its module only, not in the server's list (the module's
  list marks the owner's versions, step 5, fourth part). A module's own image or
  font is copied to the common images from its panel in the module (**Copy to the common
  images**: `useResourcesView.askShare`, answered in the common images' Project by
  `useCommonCopyAsked` with the copy the picker already makes, into that Project's draft); it
  is not moved in one action (the module keeps its own until the owner deletes it there), a
  composed image is not copied, and nothing is copied or moved from the server's list.
- Against decision 4: the base's pieces take their measures from Artisan's own list, not from
  a declared function, and the slots a name ends with (`3x1`) are not read from the function.
  The MCP tools apply the rule to a module's images (`OwnerImages.notTaken`): `render_menu` and
  `survey_ui` show the original where the pack does, `write_image` and `read_image` say of an
  image that it is not taken (`not_taken`), `list_documents` lists them (`images_not_taken`). A
  composed image over an original is not measured. The editor reads a size from the
  descriptor, the pack from the PNG: the module's list and the image's panel may call taken
  an image whose descriptor states another size than its pixels.
- Against decision 8: a file written in the folder by hand, without a deploy, takes its
  origin at the first originals sync that sees it. A menu keeps what module originals already gave it (compare with
  the original, back to the original, a merge at each update): it has no "the original
  changed" notice of its own.
- Against decision 10: an image of another module is embedded only where a menu of the
  module's own names it (not from a kind's file, a composed layer or a shipped menu), and a
  composed one never is. A theme's own image is noted, and its theme is exported and
  imported apart. The note lives in the archive only: a module's folder copied by hand
  carries no dependency, and nothing at load reports an image it names and the server lacks
  (the editor's deploy review does, for the names its menus write: `image_missing`).
  The copies are compared by their PNG alone (a descriptor that differs does not keep a
  copy). A font named elsewhere is neither copied nor noted. The version of Artisan in the
  note is the origin's, shown when a base image is missing, never compared.
- Against decision 5: a theme's own images (`assets/`, `<theme>:<name>`) are in the pack when
  named, the editor draws one a menu names, as published, and the MCP tools write and draw
  one, and the picker offers one. A composed one is not taken, and the editor shows a
  theme's own images as published, not as a draft of the theme has them. `<theme>:<name>` for
  an image the theme does not hold falls on the bare name like a module's.
  A theme has no versions and no update: an archive is imported under a free name only.
- Against decision 7: an image of the server that follows the ramps is repainted by its
  colours as they are, so one drawn in other colours than the base's is not reached by a pick.
  The image's panel says which of its colours are in no ramp (`offRampColors`), once the image
  says it follows them.
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
  owner's image at a shipped path gets its origin at the first sync that sees it (read again
  for step 5: the first reading, "no origin today", was wrong), which is what decision 8's
  "the original changed" reads.

## Still to check

- On a running network: that the hub's sync to the other servers and the drafts treat the
  theme's root as they treat an Add-on's (the code path is the same; no test covers a leaf).
- What the editor's own lookup does when two modules hold the same name: it shows the open
  module's images and the common ones, never another module's.
