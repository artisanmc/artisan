- **Fixed**: A module's export (.zip) put its files under `plugins/Artisan/projects/<folder>/`, a
  path that is not where any module lives (core modules are in `plugins/Artisan/modules/`, an
  add-on's in its own plugin folder, like `plugins/ArtisanDailyRewards/artisan_module/`). The
  archive now holds the module's files at its root, so it unzips straight into the module's
  folder, and is named after the module (`daily.zip`): the import reads that name to know which
  module it updates. Older archives still import.
