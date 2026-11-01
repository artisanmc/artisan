- **Added**: Module variables (API 2.24.0, `@Beta`, ADR `triggers-and-variables` §10): a module
  declares read-only values with `api.getVariables()` (`guilds.has_guild`), computed from its own
  state at each read. Conditions and texts read them as `var.<module>.<name>`
  (`expression: "var.guilds.has_guild"`, `{var.guilds.rank}`); a module that is not installed
  reads as nothing. Reported at Presence as `declared_variables` and served by
  `GET /api/v1/servers/:server/variables`; the editor's condition list offers them under
  "module variable" and strikes through a name the server does not declare.
- **Added**: `PlayerCommandDeclaration.Builder.fileActions(...)` (API 2.24.0, `@Beta`): a module
  writes the actions its command file starts with, such as an `if:` on one of its Variables, so
  the admin sees and edits in the editor what the command does instead of a single
  `module_command`.

