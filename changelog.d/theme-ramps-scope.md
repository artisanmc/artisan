- **Changed**: a theme's colours repaint the images that follow them, and no other: Artisan's
  own images, and any image, common or a module's, with **Follows the themes' colours** ticked
  in **Resources** (`ramps: true` in its `.yml`). An image of yours without it keeps its
  colours under any theme, so an icon that shares a green with the buttons is not repainted.
  Before, a theme's colours changed every common image of the server and no module's image:
  tick the box on the common images you drew in Artisan's colours. The server's version of a
  base image, first drawn in the atelier, has it ticked.
- **Added**: a theme of one module. `scope: guilds` beside `colors` in a theme's
  `overrides/colors.yml` keeps its colours to the images of that module (`scope: artisan`: the
  common images), so a theme for one module sits beside another. A theme's page says what its
  colours reach.
- **Added**: the assistant says whether an image it writes follows the themes' colours
  (`write_image`'s `ramps`), sees which images do (`survey_ui`), and draws a menu accordingly.
