import { Hono } from "hono";

const router = new Hono();

// In-memory cache: key → PNG bytes. Capped at 4000 entries (~200 MB worst-case).
const cache = new Map<string, ArrayBuffer>();
const CACHE_MAX = 4000;

// Pending fetches: key → Promise so concurrent requests for the same texture
// coalesce into one upstream fetch instead of hammering mcasset.cloud.
const inflight = new Map<string, Promise<ArrayBuffer | null>>();

// Returns the PNG buffer, null for non-OK upstream, or throws on network failure.
async function fetchTexture(key: string, url: string): Promise<ArrayBuffer | null> {
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const res = await fetch(url);  // throws on network failure — let it propagate
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, buf);
    return buf;
  })().finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

router.get("/:version/*", async (c) => {
  const version = c.req.param("version");
  const fullPath = c.req.path;
  const prefix = `/${version}/`;
  const rest = fullPath.includes(prefix) ? fullPath.split(prefix)[1] : "";
  const cacheKey = `${version}/${rest}`;

  const cached = cache.get(cacheKey);
  if (cached) {
    return new Response(cached, {
      status: 200,
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
    });
  }

  const upstreamUrl = `https://assets.mcasset.cloud/${version}/assets/minecraft/textures/${rest}.png`;
  let buf: ArrayBuffer | null;
  try {
    buf = await fetchTexture(cacheKey, upstreamUrl);
  } catch {
    return c.newResponse(null, 502);
  }
  if (!buf) return c.newResponse(null, 404);

  return new Response(buf, {
    status: 200,
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
  });
});

export { router as texturesRouter };
