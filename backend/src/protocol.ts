export interface HelloMessage {
  type: "hello";
  server_key: string;
  plugin_version: string;
  minecraft_version: string;
  current_bundle_hash: string;
  local_pack_ids?: string[];
  custom_items_hash?: string;   // null/absent means no custom item plugin detected
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
  pack_hashes: Record<string, string>;  // packId → latest stored hash on backend
  deleted_pack_ids: string[];
  resource_pack: { url: string; hash: string } | null;
}

export interface BundleAvailableMessage {
  type: "bundle_available";
  pack_id: string;
  url: string;
  hash: string;
  signature: string;
}

export interface DraftUpdateMessage {
  type: "draft_update";
  pack_id: string;
  menu_id: string;
  menu_yaml: string;
}

export interface PingMessage { type: "ping" }
export interface PongMessage { type: "pong" }

export interface SetupRequestMessage { type: "setup_request" }
export interface SetupClaimMessage   { type: "setup_claim"; code: string }

export interface SetupCodeMessage {
  type: "setup_code";
  code: string;
  url: string;
  expires_at: string;
}
export interface LinkConfirmedMessage {
  type: "link_confirmed";
  server_key: string;
}

// Plugin → backend (on authenticated WS)
export interface EditorSessionRequestMessage {
  type: "editor_session_request";
  sender: string;
}
export interface EditorSessionRevokeMessage {
  type: "editor_session_revoke";
}

export interface EditorTrustRequestMessage {
  type: "editor_trust_request";
  trust_code: string;
}

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

export interface SessionTrustedMessage { type: "session_trusted" }

// Backend → plugin
export interface EditorSessionReadyMessage {
  type: "editor_session_ready";
  url: string;
  expires_at: string;
  trust_code: string;
}

// Backend → editor (on /ws/editor)
export interface SessionExpiredMessage { type: "session_expired" }
export interface EditorDraftUpdateMessage {
  type: "draft_update";
  pack_id: string;
  menu_id: string;
  menu_yaml: string;
  updated_by: string;
}

// Plugin → backend : divergence disque ↔ backend détectée au boot ou /ifz reload
export interface PackDivergenceDetectedMessage {
  type: "pack_divergence_detected";
  pack_id: string;
  disk_files: Record<string, string>;
  disk_hash: string;
  last_synced_hash: string;
}

// Backend → plugin : pack supprimé côté éditeur
export interface PackDeletedMessage {
  type: "pack_deleted";
  pack_id: string;
}

// Backend → éditeur : conflit ouvert/refresh
export interface PackConflictDetectedEditorMessage {
  type: "pack_conflict_detected";
  conflict_id: string;
  pack_id: string;
  detected_at: string;
}

// Backend → éditeur : conflit résolu (multi-onglets)
export interface PackConflictResolvedEditorMessage {
  type: "pack_conflict_resolved";
  conflict_id: string;
  pack_id: string;
  resolution: "editor" | "server";
}

export type PluginToServerMessage =
  | HelloMessage
  | PongMessage
  | SetupRequestMessage
  | SetupClaimMessage
  | EditorSessionRequestMessage
  | EditorSessionRevokeMessage
  | EditorTrustRequestMessage
  | CustomItemsChangedMessage
  | CustomItemsBundleMessage
  | PackDivergenceDetectedMessage;

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
  | SetupCodeMessage
  | LinkConfirmedMessage
  | EditorSessionReadyMessage
  | CustomItemsRequestMessage
  | ResourcePackUpdatedMessage
  | PackDeletedMessage;
