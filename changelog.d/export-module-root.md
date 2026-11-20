- **Fixed**: A module's export (.zip) put its files under `plugins/Artisan/projects/<folder>/`, a
  path that is not where any module lives (core modules are in `plugins/Artisan/modules/`, an
  add-on's in its own plugin folder, like `plugins/ArtisanDailyRewards/artisan_module/`). The
  archive now holds the module's root under its folder name (`daily/…`). Imports read both shapes.
