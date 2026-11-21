- **Fixed**: Translations listed every text of a module's untouched originals twice, the second
  time as an `(unused)` `lt_…` key: the copy the editor keeps for Compare and Revert. "Remove N
  unused" deleted those texts, which made the original read as modified. The shipped copies are
  no longer listed, cleaned up or counted missing; a variant's texts off the canvas count as used.
- **Added**: The Translations panel groups its texts by menu, command, dialog or data source, then
  by `lang/` segment, each section with its missing count, and has a search box.
- **Added**: An add-on's own messages (a `files` bundle `inFolder`) are editable in Translations:
  the server copies the jar's `lang/<code>.yml` to the module's `originals/lang/`, the editor lists
  each message with the module's text, and `lang/<code>.yml` holds only the keys the owner changed,
  read key by key over the original. A changed message can go back to the module's text.
- **Added**: Translations filters by type (menus, commands, dialogs, data, module's messages…).
- **Added**: A module's home has a Translations block and a Captured items block; the Resources
  tab lists the module's captured items beside its images and fonts (see, remove, capture).
