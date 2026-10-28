// The tunnel wire, as `plugin/tunnel` defines it (Frame.kt, Tunnel.kt): this Worker speaks it to
// unchanged plugins. Change both together, or bump Tunnel.VERSION.

export enum T {
  HELLO = 0,
  REQUEST = 1,
  REQUEST_BODY = 2,
  REQUEST_END = 3,
  RESPONSE = 4,
  RESPONSE_BODY = 5,
  RESPONSE_END = 6,
  WS_OPEN = 7,
  WS_OPENED = 8,
  WS_TEXT = 9,
  WS_BINARY = 10,
  WS_CLOSE = 11,
  RESET = 12,
  NAME = 13,
  NAME_RESULT = 14,
}

export interface Frame {
  type: T;
  stream: number;
  payload: Uint8Array;
}

export interface Hello { url: string; name?: string | null; names: boolean }
export interface NameRequest { name: string; check?: boolean }
export interface NameResult { ok: boolean; name?: string | null; url?: string | null; error?: string | null }
/** `[name, value]` pairs: names keep their case and may repeat. */
export type HeaderList = string[][];
export interface RequestHead { method: string; path: string; headers: HeaderList }
export interface ResponseHead { status: number; headers?: HeaderList }
export interface WsClose { code: number; reason?: string }

/** Body chunks are cut at this size, as on the plugin side. */
export const CHUNK = 256 * 1024;
const HEADER = 5;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encode(type: T, stream: number, payload: Uint8Array = new Uint8Array(0)): ArrayBuffer {
  const out = new Uint8Array(HEADER + payload.byteLength);
  const view = new DataView(out.buffer);
  view.setUint8(0, type);
  view.setInt32(1, stream);
  out.set(payload, HEADER);
  return out.buffer;
}

export function encodeJson(type: T, stream: number, value: unknown): ArrayBuffer {
  return encode(type, stream, encoder.encode(JSON.stringify(value)));
}

export function decode(data: ArrayBuffer): Frame {
  if (data.byteLength < HEADER) throw new Error("frame too short");
  const view = new DataView(data);
  return { type: view.getUint8(0), stream: view.getInt32(1), payload: new Uint8Array(data, HEADER) };
}

export function json<V>(frame: Frame): V {
  return JSON.parse(decoder.decode(frame.payload)) as V;
}

export function text(frame: Frame): string {
  return decoder.decode(frame.payload);
}

export const VERSION = "1.0";
export const VERSION_HEADER = "X-Artisan-Tunnel-Version";
export const ACCESS_HEADER = "X-Artisan-Tunnel-Access";
export const MEMBER_HEADER = "X-Artisan-Tunnel-Member";
export const CONNECT_PATH = "/tunnel";

export function major(version: string): string {
  return version.split(".")[0];
}

/** Headers about one hop only, never passed through (Tunnel.HOP_BY_HOP). */
export const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-connection", "transfer-encoding", "te", "trailer", "upgrade",
  "proxy-authorization", "proxy-authenticate", "content-length",
  "sec-websocket-key", "sec-websocket-accept", "sec-websocket-version", "sec-websocket-extensions",
]);

const ID_LENGTH = 16;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** `<id>` from the plugin's secret: SHA-256, base32, 16 characters (Tunnel.id). */
export async function tunnelId(secret: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(secret)));
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of digest) {
    buffer = ((buffer << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5 && out.length < ID_LENGTH) {
      out += ALPHABET[(buffer >> (bits - 5)) & 31];
      bits -= 5;
    }
    if (out.length === ID_LENGTH) break;
  }
  return out;
}

export function looksLikeId(label: string): boolean {
  return label.length === ID_LENGTH && [...label].every((c) => ALPHABET.includes(c));
}

export function validName(name: string): boolean {
  return name.length >= 3 && name.length <= 32 && NAME.test(name) && !name.includes("--") && !looksLikeId(name);
}

/** Names of the tunnel server itself and of the project (NameRegistry.RESERVED). */
export const RESERVED = new Set([
  "connect", "tunnel", "www", "api", "app", "admin", "administrator", "root", "system", "status", "health",
  "mail", "smtp", "imap", "pop", "ftp", "ns1", "ns2", "cdn", "static", "assets", "files", "download", "downloads",
  "docs", "doc", "wiki", "help", "support", "contact", "abuse", "security", "legal", "privacy", "terms",
  "blog", "news", "shop", "store", "boutique", "pay", "billing", "account", "accounts", "auth", "oauth", "sso",
  "dashboard", "panel", "console", "editor", "dev", "staging", "test", "demo", "official", "staff", "team",
  "artisan", "artisanmc", "artisan-mc",
]);

/** Words no name may contain (NameRegistry.BLOCKED_WORDS). */
export const BLOCKED_WORDS = [
  "paypal", "discord", "mojang", "microsoft", "xbox", "google", "apple", "icloud", "steam", "epicgames",
  "nitro", "login", "signin", "password", "verify", "wallet", "bank", "crypto", "giftcard", "freecoins",
];
