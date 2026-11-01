- **Fixed**: An edit made in the editor right after the server restarted could land in a second
  draft of a module: for the few seconds before the module registered its folder, the folder was
  addressed by a new id. A module's folder now keeps its module id in `.artisan/project-id`, so it
  is the same project from the first request.
