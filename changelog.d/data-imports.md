- **Added**: `/artisan import`: one place to import another plugin's data into the suite's modules
  (for example Auctions from zAuctionHouse). A dry run first reports what would be imported and
  what would be left aside, and why; `confirm` imports, and running it again skips what is
  already there; `rollback <batch>` undoes an import while keeping what players changed since.
  Each run is logged (`/artisan import history`). Modules register their sources through
  `api.getImports()` (API 1.7.0). Permission `artisan.admin.import`.
- **Added**: an **Imports** tab on a server's page in the editor (permission
  `artisan.editor.config`): the sources the installed modules can import, a dry run with its report
  (what would be imported, what is left aside and why), the import on a second click, and the
  history, where an import is undone after a dry run of its rollback. A run that fails is kept in
  the history; what an import wrote before failing can be undone.
