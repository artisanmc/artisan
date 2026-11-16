- **Added**: API 1.3.0, conditions evaluated without a player
  (`ConditionsApi.testWithoutPlayer`, `validateWithoutPlayer`), for a console command, a scheduled
  task or a guild event. `expression` reads the args the caller binds and the server-scoped
  variables; a condition that needs a player (`has_permission`, `placeholder_equals`, a
  `%placeholder%` in an expression…) makes the list false, and validation names it.
