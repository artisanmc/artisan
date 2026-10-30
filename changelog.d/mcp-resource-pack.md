- **Added** (preview): Two MCP tools for the resource pack built by the hub:
  `resource_pack_status` reads its state (its SHA-1, the editor's, whether they match, the last
  error), and `resource_pack_rebuild`, for an AI app allowed to deploy, rebuilds it and waits for
  the result. The hub still only builds and compares: players get the editor's pack.
