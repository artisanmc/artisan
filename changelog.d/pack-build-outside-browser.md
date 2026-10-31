- **Added**: `npm run pack -- build <projects-dir>` (editor) builds a server's Java resource pack from
  Project folders on disk, with the same bytes as the editor after a publication, without a browser.
  `npm run pack -- vectors` checks the pack conformance vectors, which now also record each entry's
  SHA-256 and cover module images (`pack.images`) and edge cases (PNG variants, loose YAML, key order).
- **Added**: `plugin/pack`, the Kotlin port of the pack builder, byte for byte the editor's on every
  conformance vector. Not wired yet: the hub will build packs itself with it.
- **Changed**: The pack orders assets and fonts by code unit instead of the browser's locale, so two
  editors in different languages build the same pack. A server whose asset names mix case or
  punctuation gets a new pack hash once (players download it again once).
- **Added** (preview): The hub builds each server's Java pack itself after that server reloads its
  Projects, and compares it with the pack the editor uploads (a WARNING when they differ). Shadow mode:
  nothing changes for players, the editor's pack is still the one served.
- **Added** (API 2.22.0, `@Beta`): `DocumentKindDeclaration.withPackImages(PackImagesProvider)`, the
  Java twin of an editor kind's `pack.images`. The server computes the images its Documents ask for
  at each load and records them with its loaded state; the hub's pack build includes them.
- **Changed**: The editor asks the kinds' `pack.images` file by file in path order, as the server
  does, instead of kind by kind. A server with module images in several folders may get a new pack
  hash once.
