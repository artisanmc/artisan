- **Added**: `/artisan import`: one place to import another plugin's data into the suite's modules
  (for example Auctions from zAuctionHouse). A dry run first reports what would be imported and
  what would be left aside, and why; `confirm` imports, and running it again skips what is
  already there; `rollback <batch>` undoes an import while keeping what players changed since.
  Each run is logged (`/artisan import history`). Modules register their sources through
  `api.getImports()` (API 1.6.0). Permission `artisan.admin.import`.
