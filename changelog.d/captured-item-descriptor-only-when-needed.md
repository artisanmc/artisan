- **Fixed**: Opening a module whose items came without an editor descriptor (rewards written by
  the Daily rewards screen) put `.artisan/editor.yaml` in the draft: the module's Deploy said
  "no change" while "To deploy" counted one changed file. The editor now writes a captured item's
  entry there only when its label or look says more than the item file itself.
