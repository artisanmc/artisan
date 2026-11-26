- **Added**: several themes can be in place on a server at once, as a stack
  (`resource-pack.themes` in `config.yml`, the lowest first). The highest that redraws a common
  image wins. A theme's page puts it on top of the stack or takes it off; the
  common images' page numbers the themes in place, and **Configuration**, **Themes in place**
  holds the list in order.
- **Changed**: `resource-pack.theme` gives way to `resource-pack.themes`. A `config.yml` that
  names one theme keeps it in place, and its pack does not change; the old key leaves the file
  the first time the list is written from the editor.
