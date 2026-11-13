- **Changed**: The hub now builds and applies each server's Java resource pack itself, as it already
  did for the Bedrock one, after every reload of that server's modules. A publication made without
  an editor tab (`/artisan reload`, an AI app through MCP) now reaches Java players too. The editor
  no longer builds the pack in the browser: after a publication or a config change it asks the hub
  (`POST /api/v1/servers/<id>/resource-pack/rebuild`), and falls back to its own build on a hub
  without that route. `resource_pack_status` answers `mode: "server"` and the Java pack the server
  has (`applied_sha1`).
