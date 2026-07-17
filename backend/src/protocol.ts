// Data sources registered plugin-side (DataSourceRegistry). Drives the
// editor's menu source picker + data explorer. Absent/empty on older plugins;
// module_id/schema absent on pre-schema plugins (legacy schema_hint only).
export interface ReportedDataSource {
  ref: string;
  module_id?: string | null;
  schema?: { name: string; type: string; description?: string | null }[];
  schema_hint?: string | null;
  // "static" = stable, enumerable key-set (placeable); "dynamic" = runtime/player-
  // dependent (pagination only). Absent on pre-stability plugins → treated as dynamic.
  stability?: "static" | "dynamic" | null;
  // Row key: the field identifying each row of a static source. Null unless static.
  key_field?: string | null;
}

export interface HelloMessage {
  type: "hello";
  protocol_version?: string;   // NEW — "1" for current protocol
  core_version?: string;       // NEW — plugin's own version string; mirrors plugin_version
  server_key: string;
  plugin_version: string;
  minecraft_version?: string;
  current_bundle_hash: string;
  local_project_ids?: string[];
  custom_items_hash?: string | null;   // null/absent means no custom item plugin detected
  // Modules the Core plugin currently has registered. Drives editor visibility
  // (presence activation). Absent/empty on older plugins → no modules reported.
  installed_modules?: { id: string; version: string }[];
  // Data sources registered plugin-side (DataSourceRegistry). Drives the
  // editor's menu source picker. Absent/empty on older plugins.
  data_sources?: ReportedDataSource[];
}

export interface HelloAckMessage {
  type: "hello_ack";
  session_id: string;
  server_id: string;
  tier: "free" | "crew" | "network";
  needs_sync: boolean;
  latest_bundle_hash: string;
  api_url: string;
  bundle_url: string;  // plugin-internal URL for bundle downloads/uploads (may differ from api_url in Docker)
  editor_url: string;  // browser-facing editor URL (EDITOR_URL) — informational, shown by /artisan editor
  server_url: string;  // deep link to this server's page in the editor (falls back to editor_url if network/server rows are missing)
  network_name: string;  // display name of the network this server_key belongs to
  project_hashes: Record<string, string>;  // projectId → latest stored hash on backend
  deleted_project_ids: string[];
  resource_pack: { url: string; hash: string } | null;
}

export interface BundleAvailableMessage {
  type: "bundle_available";
  project_id: string;
  url: string;
  hash: string;
  signature: string;
}

export interface DraftUpdateMessage {
  type: "draft_update";
  project_id: string;
  menu_id: string;
  menu_yaml: string;
}

export interface PingMessage { type: "ping" }
export interface PongMessage { type: "pong" }

// Plugin → backend: sent on hot-reload when custom items change
export interface CustomItemsChangedMessage {
  type: "custom_items_changed";
  hash: string;
}

// Backend → plugin: request the full bundle
export interface CustomItemsRequestMessage {
  type: "custom_items_request";
}

// Plugin → backend: compressed bundle payload
export interface CustomItemsBundleMessage {
  type: "custom_items_bundle";
  hash: string;
  data: string;  // base64(gzip(zip archive))
}

// Backend → editor (on /ws/editor)
export interface EditorDraftUpdateMessage {
  type: "draft_update";
  project_id: string;
  menu_id: string;
  menu_yaml: string;
  updated_by: string;
}

// Backend → plugin : project supprimé côté éditeur
export interface ProjectDeletedMessage {
  type: "project_deleted";
  project_id: string;
}

// Plugin → backend: push local project files to backend (/artisan pushLocal flow)
export interface LocalPushMessage {
  type: "local_push";
  project_id: string;
  files: Record<string, string>;
  hash: string;
}

// Plugin → backend: emitted when a module registers after hello (runtime registration seam)
export interface ModulesChangedMessage {
  type: "modules_changed";
  // redundant with the authenticated session; ignored by the backend (kept for payload parity with hello)
  server_key: string;
  installed_modules: { id: string; version: string }[];
  // Data sources registered plugin-side (DataSourceRegistry). Drives the
  // editor's menu source picker. Absent/empty on older plugins.
  data_sources?: ReportedDataSource[];
}

// Backend → plugin: request a live data source fetch (preview). Correlated by
// request_id with DataSourceFetchResultMessage; backend times out after 5 s.
export interface DataSourceFetchMessage {
  type: "data_source_fetch";
  request_id: string;
  ref: string;
  params: Record<string, unknown>;
  filter: Record<string, string>;
  sort: { by: string; direction?: "asc" | "desc" } | null;
  limit: number | null;
  // Interpolation context for {arg} tokens in filter/params values (test values from the editor).
  args: Record<string, string>;
}

// Plugin → backend: reply to DataSourceFetchMessage, correlated by request_id.
export interface DataSourceFetchResultMessage {
  type: "data_source_fetch_result";
  request_id: string;
  ok: boolean;
  rows?: Record<string, unknown>[];
  truncated?: boolean;
  error?: "unknown_source" | "player_required" | "fetch_error";
  message?: string;
}

export type PluginToServerMessage =
  | HelloMessage
  | PongMessage
  | CustomItemsChangedMessage
  | CustomItemsBundleMessage
  | LocalPushMessage
  | ModulesChangedMessage
  | DataSourceFetchResultMessage;

export interface ResourcePackUpdatedMessage {
  type: "resource_pack_updated";
  url: string;
  hash: string;
}

export type ServerToPluginMessage =
  | HelloAckMessage
  | BundleAvailableMessage
  | DraftUpdateMessage
  | PingMessage
  | CustomItemsRequestMessage
  | ResourcePackUpdatedMessage
  | ProjectDeletedMessage
  | DataSourceFetchMessage;
