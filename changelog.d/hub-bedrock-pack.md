- **Changed**: The hub builds each server's Bedrock pack itself after the server reloads its
  modules, and sends it to the server when it changed, in every edition: a publication made
  without an open editor tab (MCP `draft_publish`, `/artisan reload`) now reaches Bedrock players.
  The Kotlin builder produces the editor's bytes (Bedrock cases of
  `testdata/resource-pack-conformance.json`). MCP `resource_pack_status` gains `bedrock_sha1`.
