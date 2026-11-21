- **Fixed**: Translations listed every text of a module's untouched originals twice, the second
  time as an `(unused)` `lt_…` key: the copy the editor keeps for Compare and Revert. "Remove N
  unused" deleted those texts, which made the original read as modified. The shipped copies are
  no longer listed, cleaned up or counted missing; a variant's texts off the canvas count as used.
- **Added**: The Translations panel groups its texts by menu, command, dialog or data source, then
  by `lang/` segment, each section with its missing count, and has a search box.
