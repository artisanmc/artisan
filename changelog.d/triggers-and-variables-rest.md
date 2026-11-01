- **Added**: Variables (`variables/<id>.yml`, `schema: variable/v1`): a named value of type text,
  number, true/false or place, one per player or one for the server, with an optional default and
  lifetime. Chains write it with `set_var`, `add_var` and `clear_var`; conditions, texts and
  arguments read it as `var.<id>`, `has_var` says whether a value is stored. Values are kept in the
  suite database (table `artisan_vars`), survive a restart and follow a player across a network.
  PlaceholderAPI reads them, and module Variables, as `%artisan_var_<name>%`.
- **Added**: `chat_button`: a chat line with a button that only the player it was sent to can
  click, a given number of times before it expires, and that runs its own actions.
- **Added**: The Game event `variable_changed`, fired when a Variable is written or a module
  reports a change (API 2.25.0: `VariableRegistry.changed`, `ModelFieldType.location()`,
  `VariableType.LOCATION`).
- **Added**: `player.location`, and `player.vanished`, which reads the vanish plugins'
  `vanished` metadata (EssentialsX, SuperVanish, PremiumVanish).
- **Added**: The editor's condition list offers project and module Variables (`is true`,
  comparisons, `is set`), the `{` autocomplete lists them, and an `expression` that is a
  placeholder alone (always true) is flagged.
- **Changed**: A number, true/false or place argument of an action accepts a template resolved when
  the action runs (`give_money: "{var.reward}"`). One that does not resolve skips the action with
  a warning in the console. `teleport` takes a `location` (`teleport: "{var.last_death}"`);
  `world/x/y/z` are still read, and a missing world no longer teleports to 0, 0, 0.
