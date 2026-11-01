- **Added** (preview): Module variants. A module with `variants.yml` keeps other versions of its
  menus and dialogs under `variants/<name>/` (same ids), and its display rules pick, for each
  player and each file, the first variant whose rule holds and that has the file: `client:
  bedrock`, `has_pack`, `permission`, or any condition. Without `variants.yml`, nothing changes.
  In the editor, **View as** on the canvas toolbar shows a variant: its versions in place, the
  module's shared documents faded; **Create a version for …** copies a menu, dialog or command into the
  variant; **Display rules…** orders and edits the rules. AI apps (MCP) see the variants in
  `list_documents` and write them like any file. The resource
  packs (Java and Bedrock) carry the variants' menus too, each Bedrock variant styled apart. A
  variant's command file changes only what the command runs (`actions`, `requirements`,
  `fallback`, sub-commands found by `name`); its name, aliases, permission and arguments stay the
  module's. The editor shows a command's version whole, those fields locked, and writes only the
  steps that differ.
  Going back to an older Artisan on a module that has variants: rename `variants.yml` and the
  `variants/` folder first, or the older version refuses each menu that has a variant (both files
  share an id there).
- **Fixed**: The Java resource pack left out the menus of themed folders (`shop/menus/…`): their
  image buttons, glyph title heights and transparent containers were missing. It now reads the menus
  the plugin loads, as the Bedrock pack already did; two menus sharing an id are left out of both.
