# A theme replaces an image where it lives

**Status:** accepted (2026-11-27). Being built: step 1 (the two pack builders) and the first half
of step 2 (**Save as** and a theme's Resources) are in the code; the canvas and the MCP tools
of step 2, and steps 3 to 5, are not. Amends `resources-one-screen` (2026-11-26): replaces its decision 2 ("a
theme no longer aims at a module") and the part of its decision 7 that offers a module as a
place to save an image into. Its other decisions stand, colour tables and `scope` stay gone.

## Context

`resources-one-screen` removed a theme's redraws aimed at a module together with the colour
tables, because they came as three ways to change an image and boxes to tick. The need under
them was right. On the owner's first use, four needs were said, and they do not move:

1. Whoever builds a menu adds an image without choosing where it is filed.
2. A server changes its look at once, the modules it installed included.
3. An exported module works on a server that holds nothing.
4. Two unrelated modules that each hold a `banner` do not overwrite each other.

Needs 2 and 4 pull apart. Themes that replace by name everywhere break 4. Themes that never
reach a module (the code before this ADR) break 2.

The model is the one a CMS such as Azuriom uses: plugins write their views with a shared
vocabulary (Bootstrap), a theme restyles that vocabulary, and overrides one view of one plugin,
filed under the plugin's name, when that is not enough.

## Decisions

1. **An image that is added goes to the server's library.** The library is the theme `artisan`
   (the place **Base**): Artisan's base and what the server added. The editor no longer asks
   which module an added image goes to.

2. **A module holds the images it was shipped with**, and the owner's versions of them. A
   module names the library as much as it can and ships an image only where the library has
   nothing that serves: every image a module ships is one each theme has to redraw for it.
   Images the owner had added to a module stay read where they are; nothing is moved for them.

3. **A theme replaces an image where it lives.** In a theme's folder:

   ```
   assets/textures/banner.png      replaces the library's `banner`
   overrides/shop/banner.png       replaces the module shop's `banner`
   ```

   Never both from one file: the theme's image of a common name leaves a module's image of
   that name alone, and its image filed under a module changes that module's alone. The
   highest theme in place that holds one wins, and its image is taken as it is, at its size.
   The lookup order of a name (`resources-one-screen`, decision 1) is unchanged; what changes
   is the picture found at the module's step.
   A composed image of a module is not replaced itself: it follows its replaced layers.
   *Rejected again:* the server's themes above the modules by name (breaks need 4).
   *Rejected:* every image in the library and none in a module. Add-ons write their module's
   images at each update (`originals/assets/`); they would all have to change.

4. **One gesture in the editor.** From an image, **Save as** offers the library, a theme or a
   new theme. Saved into a theme from a module's image, the file goes under that module in the
   theme, and the dialog says the sentence of what will happen. No box, no scope.

5. **Export carries what the module names.** The archive of a module holds the library's
   images its menus name; on the server that imports it they arrive as images shipped with
   the module, which that server's themes reach by decision 3.

## Steps

1. The two pack builders read `overrides/<module>/<image>.png` (`theme.ts` and `Theme.kt`,
   `shownIn`), locked by the conformance vector. The server no longer reports such a folder as
   unread.
2. **Save as** into a theme from a module's image; a theme's Resources list what it replaces
   in each module; the canvas and the MCP tools (`render_menu`, `write_image`, the themes'
   description) show and write a module's image as the themes in place do. Until then they
   show a module's image as the module holds it, and the pack alone applies the theme.
3. Adding an image writes into the library; the image picker shows the library, then the
   images shipped with the menu's module; a module's Resources offer **Move to the library**.
4. Export and import (decision 5).
5. Publishing a menu that names an image of the library not published yet.

## Left open

- **Colour.** A tint on a neutral image, a palette of named colours held by a theme, a colour
  parameter on a component, and a sheet that shows every component in each of its values. It
  is a mechanism of its own, not the colour tables removed by `resources-one-screen`
  (decision 3), and gets its own ADR.
- **A richer library.** More base pieces (surfaces, controls, icons) so that modules need few
  images of their own.
