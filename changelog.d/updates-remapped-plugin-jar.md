- **Fixed**: updating a module from a server's **Updates** tab was refused ("the jar of this plugin
  is not in the plugins folder") for every plugin Paper runs from a remapped copy, which is any
  plugin that does not declare Mojang mappings. The server now finds that plugin's jar in
  `plugins/` and stages its update as for the others.
