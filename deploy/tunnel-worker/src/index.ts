// The editor tunnel as a Cloudflare Worker (ADR `editor-tunnel`, study `tunnel-latence-regions`). Same wire
// and same addresses as `plugin/tunnel-server`, which stays the reference and this Worker's fallback.
import { config, jsonResponse, labelOf, textResponse, type Config, type Env, type Location } from "./config";
import { NamesObject, type Stored } from "./names";
import { offlinePage, type Reason } from "./offline";
import { ACCESS_HEADER, CONNECT_PATH, MEMBER_HEADER, VERSION, VERSION_HEADER, looksLikeId, major, tunnelId } from "./protocol";
import { ABSENT_HEADER, INTERNAL, TunnelObject } from "./tunnel";

export { NamesObject, TunnelObject };

/** KV reads kept in this isolate: a busy editor does not read KV on every request. */
const CACHE_MS = 30_000;
const cache = new Map<string, { value: string | null; until: number }>();
/** Addresses whose object had no plugin lately: they go straight to the fallback. */
const absent = new Map<string, number>();
/** A body this small is kept to replay on the fallback when the address turns out to be served there. */
const REPLAYABLE = 1024 * 1024;

async function cachedGet(env: Env, key: string): Promise<string | null> {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await env.KV.get(key);
  cache.set(key, { value, until: Date.now() + CACHE_MS });
  return value;
}

function tunnelStub(env: Env, id: string, gen: number) {
  // No location hint: the object is created next to the first request, the plugin's own connection.
  return env.TUNNELS.get(env.TUNNELS.idFromName(`${id}:${gen}`));
}

function namesStub(env: Env) {
  return env.NAMES.get(env.NAMES.idFromName("names"));
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const cfg = config(env);
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const label = labelOf(host, cfg);
    // Plugins connect on any host but a tunnel's: the domain, `connect.<domain>`, or an address of
    // the machine in local runs.
    if (url.pathname === CONNECT_PATH && (label === null || cfg.reserved.has(label))) return acceptTunnel(request, env, cfg);
    if (host === cfg.domain || (label !== null && cfg.reserved.has(label))) {
      if (url.pathname === "/health") return textResponse(200, "ok", { "X-Artisan-Tunnel": "worker" });
      if (url.pathname.startsWith("/admin/")) return admin(request, env, url);
      return textResponse(404, "Artisan tunnel server");
    }
    if (label === null) return textResponse(404, "Artisan tunnel server");
    return browser(request, env, ctx, host, label);
  },
} satisfies ExportedHandler<Env>;

/** A plugin opens its tunnel: same checks as TunnelServer.acceptTunnel, then the address's object takes it. */
async function acceptTunnel(request: Request, env: Env, cfg: Config): Promise<Response> {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return textResponse(426, "Expected a WebSocket");
  const secret = (request.headers.get("Authorization") ?? "").replace(/^Bearer /, "").trim();
  const version = request.headers.get(VERSION_HEADER) ?? "";
  const access = env.TUNNEL_ACCESS_CODE ?? "";
  const refusal = secret.length < 32 ? "missing or short secret"
    : major(version) !== major(VERSION) ? `tunnel version ${version}, tunnel server ${VERSION}: update Artisan or the tunnel server`
    : access && request.headers.get(ACCESS_HEADER) !== access ? "wrong or missing access code (web.tunnel-access)"
    : null;
  if (refusal) return refuse(refusal);
  const id = await tunnelId(secret);
  try {
    const location = await locate(env, id, request.cf?.continent as string | undefined ?? "XX");
    const headers = new Headers(request.headers);
    headers.set(`${INTERNAL}kind`, "plugin");
    headers.set(`${INTERNAL}id`, id);
    headers.set(`${INTERNAL}address`, request.headers.get("CF-Connecting-IP") ?? "");
    headers.set(`${INTERNAL}member`, request.headers.get(MEMBER_HEADER) ?? "");
    return await tunnelStub(env, id, location.gen).fetch(new Request(request, { headers }));
  } catch (e) {
    // Out of quota, or Durable Objects down: the plugin connects to the Kotlin tunnel server instead.
    console.error(`Tunnel ${id}: ${e}`);
    if (env.TUNNEL_FALLBACK === "origin") return fetch(request);
    return textResponse(503, "Tunnel server unavailable, retrying");
  }
}

/** Refused tunnels still upgrade, to receive the reason in the close frame (4003): the plugin logs it. */
function refuse(reason: string): Response {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();
  server.close(4003, reason);
  return new Response(null, { status: 101, webSocket: client });
}

/**
 * Which object holds [id]: created where its first plugin connected. Servers that moved to another
 * continent get a new one there, once none of them holds the old one (servers of one network may sit
 * on several continents: the address stays where it is while any of them is connected).
 */
async function locate(env: Env, id: string, continent: string): Promise<Location> {
  const key = `loc:${id}`;
  let location = await env.KV.get<Location>(key, "json");
  if (location === null) {
    location = { gen: 0, continent };
    await env.KV.put(key, JSON.stringify(location));
  } else if (location.continent !== continent) {
    const held = await tunnelStub(env, id, location.gen).connected().catch(() => 0);
    if (held === 0) {
      console.log(`Tunnel ${id} moves from ${location.continent} to ${continent}`);
      location = { gen: location.gen + 1, continent };
      await env.KV.put(key, JSON.stringify(location));
    }
  }
  cache.set(key, { value: JSON.stringify(location), until: Date.now() + CACHE_MS });
  return location;
}

async function browser(request: Request, env: Env, ctx: ExecutionContext, host: string, label: string): Promise<Response> {
  const id = looksLikeId(label) ? label : await cachedGet(env, `name:${label}`);
  const raw = id ? await cachedGet(env, `loc:${id}`) : null;
  // Never connected here: no object is created for it, a browser does not pick where an address lives.
  if (!id || !raw || (absent.get(id) ?? 0) > Date.now()) return fallback(request, env, host, "offline");
  const location = JSON.parse(raw) as Location;
  const length = Number(request.headers.get("Content-Length") ?? "0");
  const replay = env.TUNNEL_FALLBACK === "origin" && request.body && length <= REPLAYABLE ? request.clone() : null;
  const headers = new Headers();
  for (const [name, value] of request.headers) if (!name.toLowerCase().startsWith(INTERNAL)) headers.append(name, value);
  headers.set(`${INTERNAL}kind`, "browser");
  headers.set(`${INTERNAL}host`, host);
  let response: Response;
  try {
    response = await tunnelStub(env, id, location.gen).fetch(new Request(request, { headers }));
  } catch (e) {
    console.error(`Tunnel ${id}: ${e}`);
    return fallback(replay ?? request, env, host, "offline");
  }
  if (response.headers.get(ABSENT_HEADER)) {
    absent.set(id, Date.now() + CACHE_MS);
    return fallback(replay ?? request, env, host, "offline");
  }
  absent.delete(id);
  return response;
}

/**
 * What this Worker cannot serve: the zone's origin (the Kotlin tunnel server, where plugins connect
 * when the Worker is out of quota) when `TUNNEL_FALLBACK=origin`, else the offline page. A Worker's
 * request to its own route goes to the origin, not back to itself.
 */
async function fallback(request: Request, env: Env, host: string, reason: Reason): Promise<Response> {
  if (env.TUNNEL_FALLBACK === "origin" && !request.bodyUsed) {
    try {
      const response = await fetch(request);
      // 502 and 530: the origin itself is down (cloudflared or the VPS).
      if (response.status !== 502 && response.status !== 530) return response;
    } catch (e) {
      console.warn(`Fallback to origin failed: ${e}`);
    }
  }
  return offlinePage(request, reason, host);
}

/**
 * `GET /admin/names`; `DELETE /admin/names/<name>` frees a name, `?ban=1` also keeps it from being taken
 * again; `DELETE /admin/bans/<name>` lifts a ban; `POST /admin/import` takes the Kotlin server's
 * `names.json`. Bearer `TUNNEL_ADMIN_TOKEN`.
 */
async function admin(request: Request, env: Env, url: URL): Promise<Response> {
  const expected = env.TUNNEL_ADMIN_TOKEN ?? "";
  if (!expected) return textResponse(404, "Artisan tunnel server");
  const token = new TextEncoder().encode((request.headers.get("Authorization") ?? "").replace(/^Bearer /, "").trim());
  const wanted = new TextEncoder().encode(expected);
  if (token.byteLength !== wanted.byteLength || !crypto.subtle.timingSafeEqual(token, wanted)) {
    return textResponse(401, "unauthorized");
  }
  const parts = url.pathname.replace(/^\/admin\//, "").split("/").filter(Boolean);
  const names = namesStub(env);
  if (request.method === "GET" && parts.length === 1 && parts[0] === "names") return jsonResponse(await names.list());
  if (request.method === "POST" && parts.length === 1 && parts[0] === "import") {
    return jsonResponse(await names.importStored(await request.json<Stored>()));
  }
  if (request.method === "DELETE" && parts.length === 2 && parts[0] === "names") {
    const name = parts[1].toLowerCase();
    const ban = ["1", "true"].includes(url.searchParams.get("ban") ?? "");
    const id = await names.revoke(name, ban);
    cache.delete(`name:${name}`);
    if (id) {
      const raw = await env.KV.get(`loc:${id}`);
      if (raw) await tunnelStub(env, id, (JSON.parse(raw) as Location).gen).hello().catch(() => {});
    }
    return jsonResponse({ name, id, banned: ban });
  }
  if (request.method === "DELETE" && parts.length === 2 && parts[0] === "bans") {
    return jsonResponse({ name: parts[1], unbanned: await names.unban(parts[1].toLowerCase()) });
  }
  return textResponse(404, "unknown admin route");
}
