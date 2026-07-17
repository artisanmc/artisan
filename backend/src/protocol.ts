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

// Backend → plugin: snapshot a player's inventory for the editor's capture
// panel (ADR captured-items-and-module-field-kit). Correlated like
// data_source_fetch; same 5 s timeout.
export interface PlayerInventoryFetchMessage {
  type: "player_inventory_fetch";
  request_id: string;
  player: string;
}

// One non-empty inventory slot: the opaque serialized stack (capture payload)
// + the display descriptor derived plugin-side from vanilla components.
export interface InventorySlot {
  slot: number;
  stack_yaml: string;
  display: {
    material?: string;
    head_texture?: string;
    enchanted?: boolean;
    count?: number;
    name?: string;
  };
}

// Plugin → backend: reply to PlayerInventoryFetchMessage.
export interface PlayerInventoryResultMessage {
  type: "player_inventory_result";
  request_id: string;
  ok: boolean;
  slots?: InventorySlot[];
  error?: "player_not_found" | "fetch_error";
  message?: string;
}

// Plugin → backend: module message from `/boutique additem` — the boutique
// backend module applies the mutation (ADR captured-items-and-module-field-kit
// §3). Fire-and-forget plugin-side; the reply is informational.
export interface BoutiqueAdditemMessage {
  type: "boutique_additem";
  request_id?: string;
  item_id: string;
  price: number;
  category?: string;
  stack_yaml: string;
  display: InventorySlot["display"];
}

export interface BoutiqueAdditemResultMessage {
  type: "boutique_additem_result";
  request_id: string | null;
  ok: boolean;
  error?: "no_boutique_project" | "invalid_input";
}

export type PluginToServerMessage =
  | HelloMessage
  | PongMessage
  | CustomItemsChangedMessage
  | CustomItemsBundleMessage
  | LocalPushMessage
  | ModulesChangedMessage
  | DataSourceFetchResultMessage
  | PlayerInventoryResultMessage
  | BoutiqueAdditemMessage;

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
  | DataSourceFetchMessage
  | PlayerInventoryFetchMessage;
