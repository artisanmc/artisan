- **Fixed**: EssentialsX `/back` again returns to where a player was before a teleport made by
  Artisan: the `teleport` action, and `NetworkApi.teleport` / `connect` (an ArtisanGuilds home,
  for instance, on this server or another one). MSCore used to save that place; Artisan now
  does when EssentialsX is enabled, and does nothing without it.
