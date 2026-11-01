- **Changed**: A module's shipped menus, dialogs, commands and variants now live in its
  `originals/` folder, written by the server only; the module's folder keeps only what you changed
  or added, and your file wins over the original of the same id. Untouched copies are removed at
  the first start, edited ones stay yours and still receive the module's updates through the
  three-way merge (deleted when they end up identical to the shipped file). A seed into the
  module's own folder works the same way: its examples follow the module's updates, and one you
  delete is listed under `originals: { exclude: [...] }` in `artisan-module.yml`. The menus and
  dialogs the module's code opens (`.system()`) are required and cannot be excluded.
  In the editor, each document of a module shows whether it is the module's, modified or yours,
  with **Compare with the original** and **Back to the original**; only documents that differ from the module's are
  written. AI apps (MCP) see each document's origin and cannot write into `originals/`.
  Going back to an older Artisan after this: copy the contents of `originals/` to the module's
  folder (without overwriting your files) first, or its shipped documents disappear.
