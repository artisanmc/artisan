export interface HelloMessage {
  type: "hello";
  server_key: string;
  plugin_version: string;
  minecraft_version: string;
  current_bundle_hash: string;
  local_pack_ids?: string[];
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

export type PluginToServerMessage =
  | HelloMessage
  | PongMessage
  | SetupRequestMessage
  | SetupClaimMessage
  | EditorSessionRequestMessage
  | EditorSessionRevokeMessage
  | EditorTrustRequestMessage;

export type ServerToPluginMessage =
  | HelloAckMessage
  | BundleAvailableMessage
  | DraftUpdateMessage
  | PingMessage
  | SetupCodeMessage
  | LinkConfirmedMessage
  | EditorSessionReadyMessage;
