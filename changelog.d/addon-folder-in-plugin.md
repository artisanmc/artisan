- **Added**: `ProjectRootRegistry.pluginFolder(folder, moduleId, dir)` (API 1.1.0) keeps an add-on's
  files in its own plugin folder (`plugins/<Plugin>/project/`), so deleting that folder uninstalls
  it. `plugins/Artisan/modules/<folder>/` moves there once, with its Versions and drafts; while both
  hold files, the old folder stays in use and the console says so.
- **Deprecated**: `ProjectRootRegistry.moduleFolder`, replaced by `pluginFolder` (removed in API 2.0.0).
