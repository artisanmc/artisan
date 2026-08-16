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
  api_url: string;
  editor_url: string;  // browser-facing editor URL (EDITOR_URL) — informational, shown by /artisan editor
  server_url: string;  // deep link to this server's page in the editor (falls back to editor_url if network/server rows are missing)
  network_name: string;  // display name of the network this server_key belongs to
  resource_pack: { url: string; hash: string } | null;
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

// Backend → plugin: who is connected right now. Feeds the editor's player
// pickers (capture panel, canvas "preview as") so an admin chooses from a list
// instead of typing a name blind. Correlated like data_source_fetch.
export interface OnlinePlayersFetchMessage {
  type: "online_players_fetch";
  request_id: string;
}

// Plugin → backend: reply to OnlinePlayersFetchMessage — names, case as the
// server knows them, sorted.
export interface OnlinePlayersResultMessage {
  type: "online_players_result";
  request_id: string;
  ok: boolean;
  players?: string[];
  error?: "fetch_error";
  message?: string;
}

// Backend → plugin: which Projects exist on this server's disk RIGHT NOW.
// La liste ne se mémorise pas côté backend (ADR server-disk-only-storage) : un
// dossier renommé ou supprimé doit se voir immédiatement, sans réconciliation.
export interface ProjectListMessage {
  type: "project_list";
  request_id: string;
}

// Plugin → backend: reply to ProjectListMessage — dir names, sorted. Le nom du
// dossier EST l'identité du Project.
export interface ProjectListResultMessage {
  type: "project_list_result";
  request_id: string;
  ok: boolean;
  project_ids?: string[];
  error?: "read_error";
  message?: string;
}

// Backend → plugin: read a Project's whole file tree, live from the server's
// disk (ADR server-disk-only-storage). The editor opens a Project through this —
// the backend stores no Project content. Correlated like data_source_fetch.
export interface ProjectReadMessage {
  type: "project_read";
  request_id: string;
  project_id: string;
}

// Plugin → backend: reply to ProjectReadMessage. `files` is the whole tree,
// rel-path keyed and sorted, `.artisan/editor.yaml` included (the editor owns
// it) but trash and sync metadata excluded.
export interface ProjectReadResultMessage {
  type: "project_read_result";
  request_id: string;
  ok: boolean;
  files?: { path: string; content: string }[];
  /**
   * Documents que le serveur n'a PAS réussi à charger, avec la raison. Ils
   * figurent quand même dans `files` (donc réparables depuis l'éditeur) : un
   * YAML cassé était sauté en silence des deux côtés, sans que rien n'explique
   * sa disparition.
   */
  failed?: { path: string; reason: string }[];
  error?: "invalid_path" | "unknown_project" | "too_large" | "read_error";
  message?: string;
}

// Backend → plugin: write a Project's files to the server's disk. The plugin is
// the only writer (ADR server-disk-only-storage) and enforces both guard-rails:
// per-file compare-and-swap (`base_hash`, null = "I expect no file here") and
// the `.artisan/history/` trash. All-or-nothing: one stale file cancels the
// whole save.
export interface ProjectWriteMessage {
  type: "project_write";
  request_id: string;
  project_id: string;
  files: { path: string; content: string; base_hash: string | null }[];
  deletes?: { path: string; base_hash: string | null }[];
  /**
   * Déplacements déclarés par l'éditeur. L'arbre seul ne distingue pas un
   * renommage d'un « supprimer + créer » — l'éditeur, lui, le sait, et le dire
   * préserve la corbeille et l'historique du fichier.
   */
  renames?: { from: string; to: string; base_hash: string }[];
  /** Créer le dossier du Project s'il n'existe pas (création / import). Sans ce
   *  drapeau un id inconnu reste une erreur, plutôt qu'un dossier fantôme. */
  create?: boolean;
}

// Plugin → backend: reply to ProjectWriteMessage. On `conflict`, `conflicts`
// carries each stale path with its current disk content (null = deleted on
// disk), so the editor can show the diff without a second round-trip.
export interface ProjectWriteResultMessage {
  type: "project_write_result";
  request_id: string;
  ok: boolean;
  conflicts?: { path: string; disk: string | null }[];
  /**
   * L'état RÉEL du dossier au moment du conflit. Un renommage fait à la main
   * ressemble à une suppression pour le compare-and-swap : sans cette liste,
   * « garder ma version » recrée l'ancien fichier en laissant le nouveau.
   */
  disk_files?: string[];
  error?: "invalid_path" | "unknown_project" | "conflict" | "write_error";
  message?: string;
}

// Backend → plugin: list the archived versions of ONE file (corbeille
// `.artisan/history/`, ADR server-disk-only-storage décision 5). Restaurer n'a
// pas de message dédié : c'est une écriture normale du contenu choisi.
export interface ProjectHistoryMessage {
  type: "project_history";
  request_id: string;
  project_id: string;
  path: string;
}

// Plugin → backend: reply to ProjectHistoryMessage — newest first.
export interface ProjectHistoryResultMessage {
  type: "project_history_result";
  request_id: string;
  ok: boolean;
  versions?: { at: number; content: string }[];
  error?: "invalid_path" | "unknown_project" | "read_error";
  message?: string;
}

// Backend → plugin: read the files of a Config-screen table, live from disk
// (ADR module-config-screens). Correlated like data_source_fetch; 5 s timeout.
export interface ConfigReadMessage {
  type: "config_read";
  request_id: string;
  project_id: string;
  table: string;
}

// Plugin → backend: reply to ConfigReadMessage.
export interface ConfigReadResultMessage {
  type: "config_read_result";
  request_id: string;
  ok: boolean;
  files?: { path: string; content: string }[];
  error?: "invalid_path" | "unknown_project" | "too_large" | "read_error";
  message?: string;
}

// Backend → plugin: write Config-screen files to disk (plugin hot-reloads and
// auto-pushes the change through the normal sync loop). 10 s timeout.
export interface ConfigWriteMessage {
  type: "config_write";
  request_id: string;
  project_id: string;
  files: { path: string; content: string }[];
  deletes?: string[];
}

// Plugin → backend: reply to ConfigWriteMessage.
export interface ConfigWriteResultMessage {
  type: "config_write_result";
  request_id: string;
  ok: boolean;
  error?: "invalid_path" | "unknown_project" | "write_error";
  message?: string;
}

// Plugin → backend: module message from `/boutique additem` — the boutique
// backend module applies the mutation (ADR captured-items-and-module-field-kit
export type PluginToServerMessage =
  | HelloMessage
  | PongMessage
  | CustomItemsChangedMessage
  | CustomItemsBundleMessage
  | ModulesChangedMessage
  | DataSourceFetchResultMessage
  | PlayerInventoryResultMessage
  | ConfigReadResultMessage
  | ConfigWriteResultMessage
  | ProjectReadResultMessage
  | ProjectWriteResultMessage
  | ProjectHistoryResultMessage
  | ProjectListResultMessage;

export interface ResourcePackUpdatedMessage {
  type: "resource_pack_updated";
  url: string;
  hash: string;
}

export type ServerToPluginMessage =
  | HelloAckMessage
  | DraftUpdateMessage
  | PingMessage
  | CustomItemsRequestMessage
  | ResourcePackUpdatedMessage
  | ProjectDeletedMessage
  | DataSourceFetchMessage
  | PlayerInventoryFetchMessage
  | OnlinePlayersFetchMessage
  | ConfigReadMessage
  | ConfigWriteMessage;
