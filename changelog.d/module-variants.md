- **Added** (preview): Module variants. A module with `variants.yml` keeps other versions of its
  menus and dialogs under `variants/<name>/` (same ids), and its display rules pick, for each
  player and each file, the first variant whose rule holds and that has the file: `client:
  bedrock`, `has_pack`, `permission`, or any condition. Without `variants.yml`, nothing changes.
  The editor keeps these files as they are; editing them in the editor comes later.
  Going back to an older Artisan on a module that has variants: rename `variants.yml` and the
  `variants/` folder first, or the older version refuses each menu that has a variant (both files
  share an id there).
