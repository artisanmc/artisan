- **Fixed**: `/artisan reload` now runs every module's `onReload()` and reads their folder lang
  files again, as a Deploy does. Before, a module kept what it read at its start until a Deploy.
- **Added**: `/artisan reload <module>` reloads one module's folders and calls its `onReload()`
  only; add-ons reach it through `api.project.reload(moduleId)` (API 1.12.0) for their own reload
  command.
