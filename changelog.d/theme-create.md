- **Added**: **New theme**, on the common images' page, creates a theme on the server, and the
  assistant creates one when asked (`create_theme`). It writes the theme's colours and its
  redrawn images into a draft of that theme, and shows a menu in the theme before it is
  deployed.
- **Changed**: a theme kept inside the common images (`themes/artisan/themes/<name>/`) moves to
  its own folder, `plugins/Artisan/themes/<name>/`, at the server's next start. Its name, its
  place among the themes in place and the pack do not change.
