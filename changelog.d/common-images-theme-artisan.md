- **Changed**: the images every menu of a server may name (the UI kit) are now the theme
  `artisan`, in `plugins/Artisan/themes/artisan/`, which every server has: it is not a module and
  is not in the module list. The base Artisan ships is written there (`originals/`), where the
  owner can see it and come back to it; the server's own images are in its `assets/`. A server
  that had a `ui-kit` module keeps it: its folder moves to the theme at the first start.
- **Added**: a menu reaches a common image by its name alone when no module holds an image of
  that name (`image: { asset: button.3x1 }`), and by `artisan:<name>` even when its own module
  holds one. `kit:<name>` stays read. A common image is in the pack only when a menu or a
  module names it; the pack of a server that names none does not change.
