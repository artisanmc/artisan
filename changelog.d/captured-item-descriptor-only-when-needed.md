- **Fixed**: Opening a module whose items came without an editor descriptor (rewards written by
  the Daily rewards screen) put `.artisan/editor.yaml` in the draft: the module's Deploy said
  "no change" while "To deploy" counted one changed file. A descriptor the item file already
  gives is no longer written anywhere.
- **Changed**: A captured item's display descriptor, when its stack does not express it (a custom
  material resolved by the plugin at capture), now lives in the item's own file
  (`items/<id>.yml`, root `display:` beside `item:`, ignored by the plugin) instead of
  `.artisan/editor.yaml`. Entries already in `.artisan/editor.yaml` are still read and kept.
