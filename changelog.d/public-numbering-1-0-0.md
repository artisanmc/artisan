- **Changed**: public numbering. The plugin and its add-on API (`net.artisanmc:artisan-core-api`)
  start at **1.0.0**. The API surface that was numbered 2.25.0 internally is API 1.0.0: every
  member is `Since 1.0.0`, `ArtisanAPI.getApiVersion()` returns `1.0.0`, and the `@Sunset`
  members announced for removal in 3.0.0 now go in 2.0.0. An add-on built against an internal
  2.x API recompiles against 1.0.0 unchanged, but must lower its own minimum (`isCompatibleWith`,
  `MIN_API_VERSION`) to `1.0.0`: a 1.0.0 server refuses a 2.x minimum.
