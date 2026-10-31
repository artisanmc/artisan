- **Changed**: Every translatable text of the editor uses the translations button of the item
  dialog: dialog title, texts and labels, command descriptions, action texts, data cells, item
  values, plain titles and title text layers, image buttons. An empty language shows the default
  text as a placeholder instead of as its value.
- **Added**: "Use the reference" on an empty language of an unfolded field writes the default
  language's text there as is, so a text kept the same on purpose is no longer counted missing.
- **Changed**: A text with no word of its own (only placeholders such as `{r.name}`, tags, digits or
  symbols) is no longer counted as a missing translation, in fields, the Translations panel and the
  top bar.
- **Added** (editor SDK 1.17): `LocalizedField` and `textValues(project, key)`, so that a module's
  translatable fields behave like Artisan's.
