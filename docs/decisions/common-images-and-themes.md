# An image belongs to a module or to the server, and a theme redraws it

**Status:** accepted (2026-11-25), **not built yet**. Replaces decisions 12 (the kit as a module),
14 and 16 of `mcp-server`: those three still describe the code until the steps below land. Nothing
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

## Still to check before step 2

- That the hub's sync to the other servers and the drafts treat a `themes/` root as they treat
  a module's folder.
- What the editor's own lookup does today when two modules hold the same name (`render_menu`
  already looks in the menu's module first).
