export interface HelloMessage {
  type: "hello";
  server_key: string;
  plugin_version: string;
  minecraft_version: string;
  current_bundle_hash: string;
}

export interface HelloAckMessage {
  type: "hello_ack";
  session_id: string;
  server_id: string;
  tier: "free" | "crew" | "network";
  needs_sync: boolean;
  latest_bundle_hash: string;
  api_url: string;
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

export type PluginToServerMessage =
  | HelloMessage
  | PongMessage
  | SetupRequestMessage
  | SetupClaimMessage;

export type ServerToPluginMessage =
  | HelloAckMessage
  | BundleAvailableMessage
  | DraftUpdateMessage
  | PingMessage
  | SetupCodeMessage
  | LinkConfirmedMessage;
