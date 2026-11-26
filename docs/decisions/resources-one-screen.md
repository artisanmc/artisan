# Resources: one rule to find an image, one screen to see it

**Status:** accepted (2026-11-26), being built: step 2 (the removal) is in the code; of
step 3, the places on the left of both Resources (`ResourcePlaces`), the **Show:** filter, the
read-only list of the whole server and the Themes screen gone, a theme holding its images
under `assets/` like a module and edited in its Project, with the marks of decision 6. Not
built: who provides a name under an image, a name alone reaching an image only a theme holds
(it is still written `<theme>:<name>`), step 5. Step 4 is in the code: **Save as** in the
atelier (`SaveAsDialog`, `saveAsPlaces.ts`, answered in the place's Project by
`useSaveAsAsked`), an image only (a font is not saved as), **Copy to the common images**
gone and **Redraw for the server** renamed **Open in the atelier**. Amends `common-images-and-themes` (2026-11-25):
replaces its decisions 4 (measures), 6 for the part on a theme's scope, 7 (colour ramps) and 12
(the Resources screen as it was built), and narrows decision 5 (what a theme may redraw). Its
decisions 1 to 3 and 8 to 11 stand. Mock-up: `Maquette Ressources du serveur` (project files).

## Context

`common-images-and-themes` was built in two days, one screen per notion. Using it on
2026-11-26 showed that the owner of the product could not find his way:

- **Two Resources screens for one thing.** The server's shows everything as published, read
  only, behind a filter (**Show:** whole server, common images, themes, each module); a module's
  is where files are edited. The common images are a hidden Project (the theme `artisan`) whose
  editable screen has no entry: it is reached through **Redraw for the server**, then back.
- **The themes are a value of that filter**, not a place.
- **Six words for two places**: common images, themes, originals, redraw, restore, the kit's
  base. On disk there are two places an image lives (a module, a theme) and one rule.
- **Three ways for a theme to change an image**: its own file of that name, a redraw aimed at
  a module (`overrides/<module>/`), a colour table that repaints pixels. The colour table
  answered a request that was about something else (named colours for MiniMessage texts).
- **A redraw at another size is refused.** The owner asked for the opposite: an image of
  another size is his to notice.

## Decisions

1. **Two places, one rule.** A resource (an image, a component, a font) lives in a module or in
   a theme. A name written in a menu is looked up in this order, and the first that has it
   wins:

   1. the menu's module;
   2. the server's themes in place, from the highest down (`resource-pack.themes`);
   3. the theme `artisan`: the server's files, then Artisan's base.

   This is the rule of `common-images-and-themes` (decision 3 and the stack of decision 6),
   said in one list. `module:name` and `artisan:name` still reach one place.

2. **A theme no longer aims at a module.** `overrides/<module>/<image>.png` and `scope:` go.
   A theme holds resources under names; it changes what the places below it show under the
   same names, which are the common ones. A module that holds its own `button` keeps it
   whatever the server's themes hold: to change it, the owner changes it in the module (its
   file over the module's original, as today).
   *Rejected:* the server's themes above the modules by name. Two modules that each hold a
   `banner` hold two unrelated drawings; a `banner` in a theme would replace both.
   *Rejected:* boxes "also replace in: Shop, Guilds" when an image is saved into a theme. The
   same file can arrive by an import or a copy, where no box is shown: two paths, two results.

3. **Colour tables go.** A theme no longer repaints pixels: `overrides/colors.yml`, the ramps
   of the base, "follows the ramps" on an image, the colour picker of a theme, and what the two
   pack builders and the MCP tools do with them are removed. A theme changes an image by
   holding an image. Named colours for texts are another subject, not decided here.

4. **Measures are not enforced.** An image that replaces another at another size is taken as
   it is. The editor says so on the image ("other size than the one it replaces"), and refuses
   nothing. The function of an image (`common-images-and-themes`, decision 4) is not built.

5. **One Resources screen**, the same from the server's tab and from a module's (which opens
   it on that module). On the left, always visible, the places in the order of decision 1 read
   from the top: the server's themes (in place or put away, reordered by dragging), the
   modules, Artisan's base (read only). On the right, the place selected: its images, its
   components, its fonts, edited there. Under an image, who provides its name, from the top
   down, and which one players see. The **Show:** filter, the read-only view "as published" and
   the separate Themes screen go; their content is in the tree.

6. **Words.** The editor says **theme**, **module** and **base**. It no longer says "common
   images" for a place (the place is the server's theme and the base), "redraw for the
   server", "originals" or "restore the original". A file in a theme that has the name of one
   below is marked **replaces the base**; one that has no such name, **added here**. Removing
   it is **Delete**, with what players will then see written under the button. "Folder" stays
   the glossary's word for a group of Documents inside a module and is not used for a theme.

7. **Save as, in the atelier.** An image or a component open in the atelier, whatever place it
   comes from and read only or not, is saved under a name into a place chosen there: a theme
   of the server, a module, or a new theme. It replaces **Redraw for the server** and **Copy to
   the common images**. Saving under the same name into a higher place is how an image is
   replaced; the dialog says what that changes ("replaces Artisan's in 14 buttons of 3
   modules").

## Left open

- **A module that ships several themes** (`themes/<name>/` under the module, an ordered list in
  its configuration). It contradicts "a module draws what it owns; a theme redraws what others
  own" and adds a format; decided when a module needs two looks.
- **Items.** `common-images-and-themes`, decision 9 stands: they stay in modules.
- **Named colours for MiniMessage texts**, set by a theme.

## Migration

Nothing below shipped in a release; only test servers hold it.

| Today | Becomes |
|---|---|
| `themes/<name>/overrides/artisan/<image>.png` | the theme's image of that name |
| `themes/<name>/overrides/<module>/<image>.png` | no longer read; the load reports the file |
| `themes/<name>/overrides/colors.yml`, `scope:` | no longer read; the load reports them |
| "follows the ramps" in an image's `.yml` | ignored |

## Steps

1. This ADR.
2. Removal: colour tables and ramps, a theme's scope and its redraws aimed at a module, in
   both pack builders (same bytes, vectors), the plugin, the editor and the MCP tools.
3. The Resources screen as a tree.
4. Save as in the atelier.
5. Measures: the refusal becomes a mark.

## Consequences

- A server's theme reaches every module that names the common images, and no module that
  ships its own under the same name. An add-on that wants to follow the server's look names
  the common images; one that wants its own look ships its images.
- A theme made before this ADR that relied on colours or on a module's redraw loses them:
  the pack shows the images below.
- One way to replace an image: a file of the same name in a higher place.
