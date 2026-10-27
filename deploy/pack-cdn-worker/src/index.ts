// Resource packs hosted for Artisan hubs (README.md): a hub uploads its pack once per version, players
// download it from here. Hubs authenticate with their tunnel secret; the bucket never sees a key.
import { tunnelId } from "../../tunnel-worker/src/protocol";
import { QuotaObject, secondsToReset, type Limit } from "./quota";
import { isResourcePack } from "./zip";

export { QuotaObject };

export interface Env {
  PACKS: R2Bucket;
  QUOTAS: DurableObjectNamespace<QuotaObject>;
  /** Where players download: `https://cdn.artisanmc.net`. */
  PACK_PUBLIC_URL: string;
  PACK_MAX_MB?: string;
  PACK_SERVER_UPLOADS_PER_DAY?: string;
  PACK_SERVER_DAILY_MB?: string;
  PACK_IP_UPLOADS_PER_DAY?: string;
  PACK_IP_DAILY_MB?: string;
  PACK_GLOBAL_DAILY_MB?: string;
  /** A pack older than this is rewritten when its hub touches it, so the bucket's lifecycle rule keeps it. */
  PACK_REFRESH_DAYS?: string;
  /** `DELETE /admin/resource-pack/<sha1>.zip` takes a pack down; unset: no admin route. */
  PACK_ADMIN_TOKEN?: string;
}

/** The path players download, the same as on the hub (`PackStore.PATH`): a leaf maps it onto its hub. */
const PATH = /^\/resource-pack\/([0-9a-f]{40})\.zip$/;
const ADMIN_PATH = /^\/admin\/resource-pack\/([0-9a-f]{40})\.zip$/;
const IMMUTABLE = "public, max-age=31536000, immutable";
/** What this colo's cache keeps: a pack taken down stops being served within a day. */
const EDGE_CACHE = "public, max-age=86400";
const DAY_MS = 24 * 3600 * 1000;

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const MB = 1024 * 1024;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return text(200, "ok");
    const admin = ADMIN_PATH.exec(url.pathname);
    if (admin) return takeDown(request, env, admin[1]);
    const match = PATH.exec(url.pathname);
    if (!match) return text(404, "Artisan resource packs");
    const hash = match[1];
    switch (request.method) {
      case "GET":
      case "HEAD":
        return serve(request, env, ctx, hash);
      case "PUT":
        return upload(request, env, hash);
      case "POST":
        return touch(request, env, hash);
      default:
        return text(405, "method not allowed", { Allow: "GET, HEAD, PUT, POST" });
    }
  },
} satisfies ExportedHandler<Env>;

const packKey = (hash: string) => `packs/${hash}.zip`;

function publicUrl(env: Env, hash: string): string {
  return `${env.PACK_PUBLIC_URL.replace(/\/+$/, "")}/resource-pack/${hash}.zip`;
}

async function serve(request: Request, env: Env, ctx: ExecutionContext, hash: string): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).origin + new URL(request.url).pathname);
  const cached = await cache.match(cacheKey);
  if (cached) return request.method === "HEAD" ? new Response(null, cached) : withClientHeaders(cached);
  if (request.method === "HEAD") {
    const head = await env.PACKS.head(packKey(hash));
    return head ? new Response(null, { headers: packHeaders(hash, head.size, head.httpEtag) }) : text(404, "no such pack");
  }
  const object = await env.PACKS.get(packKey(hash));
  if (!object) return text(404, "no such pack");
  const [toPlayer, toCache] = object.body.tee();
  const edgeHeaders = packHeaders(hash, object.size, object.httpEtag);
  edgeHeaders.set("Cache-Control", EDGE_CACHE);
  ctx.waitUntil(cache.put(cacheKey, new Response(toCache, { headers: edgeHeaders })).catch((e) => console.warn(`Cache ${hash}: ${e}`)));
  return new Response(toPlayer, { headers: packHeaders(hash, object.size, object.httpEtag) });
}

function packHeaders(hash: string, size: number, etag: string): Headers {
  return new Headers({
    "Content-Type": "application/zip",
    "Content-Length": String(size),
    "Content-Disposition": `attachment; filename="${hash}.zip"`,
    "Cache-Control": IMMUTABLE,
    "X-Content-Type-Options": "nosniff",
    ETag: etag,
  });
}

/** A cached copy carries the edge's lifetime: players get the immutable one. */
function withClientHeaders(cached: Response): Response {
  const response = new Response(cached.body, cached);
  response.headers.set("Cache-Control", IMMUTABLE);
  return response;
}

/** `<id>` of the hub's tunnel secret: who a quota counts. Null: no usable secret. */
async function hubOf(request: Request): Promise<string | null> {
  const secret = (request.headers.get("Authorization") ?? "").replace(/^Bearer /, "").trim();
  return secret.length < 32 ? null : tunnelId(secret);
}

/**
 * Charges the hub, its address and everyone. A refusal leaves the earlier keys counted: a hub that hits
 * a limit loses one request of its day, which only matters to one already at its limit.
 */
async function charge(env: Env, id: string, ip: string, bytes: number): Promise<string | null> {
  const server: Limit = { requests: int(env.PACK_SERVER_UPLOADS_PER_DAY, 50), bytes: int(env.PACK_SERVER_DAILY_MB, 1024) * MB };
  const address: Limit = { requests: int(env.PACK_IP_UPLOADS_PER_DAY, 200), bytes: int(env.PACK_IP_DAILY_MB, 2048) * MB };
  const global: Limit = { requests: Number.MAX_SAFE_INTEGER, bytes: int(env.PACK_GLOBAL_DAILY_MB, 50 * 1024) * MB };
  const quota = (key: string) => env.QUOTAS.get(env.QUOTAS.idFromName(key));
  if (!(await quota(`server:${id}`).charge(bytes, server))) return "this server's daily upload quota is used up";
  if (!(await quota(`ip:${ip}`).charge(bytes, address))) return "this address's daily upload quota is used up";
  if (!(await quota("global").charge(bytes, global))) return "the pack host's daily upload quota is used up";
  return null;
}

/**
 * `PUT /resource-pack/<sha1>.zip`: the hub's pack, named by its SHA-1, which R2 checks on write. It lands
 * under `incoming/` first and reaches `packs/`, where players download, only once it reads as a pack.
 */
async function upload(request: Request, env: Env, hash: string): Promise<Response> {
  const id = await hubOf(request);
  if (!id) return text(401, "missing or short secret");
  const length = Number(request.headers.get("Content-Length") ?? "NaN");
  if (!Number.isInteger(length) || !request.body) return text(411, "Content-Length required");
  if (length > int(env.PACK_MAX_MB, 100) * MB) return text(413, "pack too large");
  if (length < 22) return text(422, "not a resource pack");
  const existing = await env.PACKS.head(packKey(hash));
  if (existing) {
    // Another hub, or this one before a restart, already sent it: nothing to store.
    await refresh(env, hash, existing);
    return json(200, { url: publicUrl(env, hash), hash, stored: false });
  }
  const refusal = await charge(env, id, request.headers.get("CF-Connecting-IP") ?? "", length);
  if (refusal) return text(429, refusal, { "Retry-After": String(secondsToReset()) });

  const incoming = `incoming/${hash}-${crypto.randomUUID()}.zip`;
  try {
    const { readable, writable } = new FixedLengthStream(length);
    await Promise.all([
      env.PACKS.put(incoming, readable, { sha1: hash }),
      request.body.pipeTo(writable),
    ]);
  } catch (e) {
    await env.PACKS.delete(incoming).catch(() => {});
    console.warn(`Upload ${hash} from ${id}: ${e}`);
    return text(422, "upload interrupted, or its SHA-1 is not the one in its path");
  }
  try {
    if (!(await isResourcePack(env.PACKS, incoming, length))) return text(422, "not a resource pack (no pack.mcmeta at its root)");
    await copy(env, incoming, hash, id);
  } finally {
    await env.PACKS.delete(incoming).catch(() => {});
  }
  console.log(`Pack ${hash} (${length} bytes) from ${id}`);
  return json(201, { url: publicUrl(env, hash), hash, stored: true });
}

/** Writes [from] to the pack's key, with what players are served. */
async function copy(env: Env, from: string, hash: string, id: string): Promise<void> {
  const source = await env.PACKS.get(from);
  if (!source) throw new Error(`${from} vanished`);
  const { readable, writable } = new FixedLengthStream(source.size);
  await Promise.all([
    env.PACKS.put(packKey(hash), readable, {
      sha1: hash,
      httpMetadata: { contentType: "application/zip" },
      customMetadata: { server: id },
    }),
    source.body.pipeTo(writable),
  ]);
}

/**
 * `POST /resource-pack/<sha1>.zip`: the hub still serves this pack. 404 asks it to upload; else the pack
 * is rewritten if it is old, since the bucket deletes what was not written for 30 days.
 */
async function touch(request: Request, env: Env, hash: string): Promise<Response> {
  const id = await hubOf(request);
  if (!id) return text(401, "missing or short secret");
  const existing = await env.PACKS.head(packKey(hash));
  if (!existing) return text(404, "no such pack");
  const refusal = await charge(env, id, request.headers.get("CF-Connecting-IP") ?? "", 0);
  if (refusal) return text(429, refusal, { "Retry-After": String(secondsToReset()) });
  await refresh(env, hash, existing);
  return json(200, { url: publicUrl(env, hash), hash, stored: false });
}

/** Rewrites a pack written more than `PACK_REFRESH_DAYS` ago, in place: the lifecycle rule counts from the last write. */
async function refresh(env: Env, hash: string, object: R2Object): Promise<void> {
  if (Date.now() - object.uploaded.getTime() < int(env.PACK_REFRESH_DAYS, 7) * DAY_MS) return;
  await copy(env, packKey(hash), hash, object.customMetadata?.server ?? "");
}

/** `DELETE /admin/resource-pack/<sha1>.zip`, bearer `PACK_ADMIN_TOKEN`: an abuse report. */
async function takeDown(request: Request, env: Env, hash: string): Promise<Response> {
  const expected = env.PACK_ADMIN_TOKEN ?? "";
  if (!expected || request.method !== "DELETE") return text(404, "Artisan resource packs");
  const token = new TextEncoder().encode((request.headers.get("Authorization") ?? "").replace(/^Bearer /, "").trim());
  const wanted = new TextEncoder().encode(expected);
  if (token.byteLength !== wanted.byteLength || !crypto.subtle.timingSafeEqual(token, wanted)) return text(401, "unauthorized");
  const object = await env.PACKS.head(packKey(hash));
  await env.PACKS.delete(packKey(hash));
  // This colo only: the others keep their copy for at most a day (EDGE_CACHE).
  await caches.default.delete(new URL(request.url).origin + `/resource-pack/${hash}.zip`);
  return json(200, { hash, deleted: object !== null, server: object?.customMetadata?.server ?? null });
}

function text(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers } });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
