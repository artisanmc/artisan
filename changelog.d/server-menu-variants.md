- **Added**: Menu variants are declared by the server, the same for every module: `default`,
  `bedrock` (Geyser players) and `textured` (Java players with the resource pack) are always
  there, and `menu-variants` in `config.yml` adds your own, each with a parent a module without
  a version falls back to. Players choose theirs with `/artisan variant <name|auto>`
  (permission `artisan.variant`, everyone by default), kept across restarts and servers. A
  module's own display rules (`show:` of its `variants.yml`) still apply to players who did not
  choose: nothing changes on update.
- **Fixed**: A resource pack the client refuses, fails to reload or drops no longer counts as
  loaded: `textured` menus and `has_resource_pack` give way to the plain ones at the next
  opening instead of drawing missing glyphs.
