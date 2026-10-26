import { RESERVED } from "./protocol";

export interface Env {
  TUNNELS: DurableObjectNamespace<import("./tunnel").TunnelObject>;
  NAMES: DurableObjectNamespace<import("./names").NamesObject>;
  /** `name:<name>` → id, `loc:<id>` → {@link Location}: read at the edge on every browser request. */
  KV: KVNamespace;
  TUNNEL_DOMAIN: string;
  /** Appended to every label: `-test` serves `<id>-test.<domain>`, a trial beside production. */
  TUNNEL_LABEL_SUFFIX?: string;
  TUNNEL_PUBLIC_SCHEME?: string;
  TUNNEL_ACCESS_CODE?: string;
  TUNNEL_ADMIN_TOKEN?: string;
  TUNNEL_NAMES_WEBHOOK?: string;
  TUNNEL_RESERVED_NAMES?: string;
  /** `origin`: what this Worker cannot serve goes to the zone's origin, the Kotlin tunnel server. */
  TUNNEL_FALLBACK?: string;
  TUNNEL_MAX_BODY_MB?: string;
  TUNNEL_MAX_STREAMS?: string;
  TUNNEL_REQUESTS_PER_MINUTE?: string;
  TUNNEL_DAILY_MB?: string;
  TUNNEL_NAME_EXPIRY_DAYS?: string;
}

/** Where an address's tunnel object lives: its generation changes when its servers change continent. */
export interface Location { gen: number; continent: string }

export interface Config {
  domain: string;
  suffix: string;
  scheme: string;
  reserved: Set<string>;
  maxBodyBytes: number;
  maxStreams: number;
  requestsPerMinute: number;
  bytesPerDay: number;
  nameExpiryDays: number;
}

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function config(env: Env): Config {
  const extra = (env.TUNNEL_RESERVED_NAMES ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return {
    domain: env.TUNNEL_DOMAIN.trim().toLowerCase().replace(/\.$/, ""),
    suffix: (env.TUNNEL_LABEL_SUFFIX ?? "").trim().toLowerCase(),
    scheme: env.TUNNEL_PUBLIC_SCHEME?.trim() || "https",
    reserved: new Set([...RESERVED, ...extra]),
    maxBodyBytes: int(env.TUNNEL_MAX_BODY_MB, 100) * 1024 * 1024,
    maxStreams: int(env.TUNNEL_MAX_STREAMS, 64),
    requestsPerMinute: int(env.TUNNEL_REQUESTS_PER_MINUTE, 600),
    bytesPerDay: int(env.TUNNEL_DAILY_MB, 2048) * 1024 * 1024,
    nameExpiryDays: int(env.TUNNEL_NAME_EXPIRY_DAYS, 90),
  };
}

/** `survie` for `survie<suffix>.<domain>`; null for the domain itself, another suffix or a deeper host. */
export function labelOf(host: string, cfg: Config): string | null {
  if (!host.endsWith(`.${cfg.domain}`)) return null;
  const full = host.slice(0, -(cfg.domain.length + 1));
  if (full.includes(".") || !full.endsWith(cfg.suffix)) return null;
  const label = full.slice(0, full.length - cfg.suffix.length);
  return label || null;
}

export function publicUrl(label: string, cfg: Config): string {
  return `${cfg.scheme}://${label}${cfg.suffix}.${cfg.domain}`;
}

export function textResponse(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
