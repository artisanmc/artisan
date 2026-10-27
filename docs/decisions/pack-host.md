# The pack host: players download the pack from Artisan's CDN

**Status:** proposed (2026-10-27). Follows `editor-tunnel` (decision 5) and direct sending (#226).

## Context

Since #226, Artisan sends its pack to players itself. Their clients download it from the hub's web
server (`web.url`, else `http://<ip>:<web.port>`). A hub reached only through its tunnel has neither:
its players cannot download the pack. Sending the downloads through the tunnel was ruled out: every
player of every server would download through Artisan's tunnel, all at once at each publish, on the
same WebSocket as the editor.

## Decisions

1. **An object store behind a Worker** (`deploy/pack-cdn-worker/`, `cdn.artisanmc.net`, R2 bucket
   `artisan-packs`). The hub uploads each pack **once**; players download it from Cloudflare. R2 bills
   no egress: the cost is storage, a few cents per GB-month.
2. **No bucket key in the plugin.** A key in the jar would turn the bucket into free file hosting for
   whoever extracts it. The hub calls the Worker, which writes to R2.
3. **Named by SHA-1, checked on write.** The path carries the hash; R2 refuses an upload whose bytes do
   not match it. Two hubs with one pack store it once, a pack is immutable (cached for a year by
   clients), and nobody can replace another hub's pack.
4. **Packs only.** An upload lands under `incoming/` and reaches `packs/` only if its central
   directory lists `pack.mcmeta` at the root, read by ranges without loading the zip. Served as
   `application/zip`, `attachment`, `nosniff`.
5. **The tunnel secret counts, it does not authorize.** The hub sends its tunnel secret, the host
   derives the tunnel's `<id>` and never stores the secret. Anyone can generate a secret: per-server
   quotas stop a hub that loops, not an abuser. Abuse is bounded by the quota per IP, a global daily
   quota, the pack check (4) and `DELETE /admin/resource-pack/<sha1>.zip`. A license check (Pro)
   replaces the secret once licenses exist.
6. **Deleted 30 days after the last write; the hub keeps its packs written.** An R2 lifecycle rule
   deletes `packs/` objects 30 days after their last write (and `incoming/` after a day). The hub
   touches each pack it serves (`POST`) at startup and daily; the host rewrites one older than 7
   days. A pack in use is never older than ~8 days.
7. **On by default, never in the way.** `web.pack-cdn: "cdn.artisanmc.net"`; `""` turns it off. Host
   down, refusing or over quota: players download from the hub, as before. The path is the hub's
   (`/resource-pack/<sha1>.zip`), so a leaf that downloads the pack for its pack plugin maps it onto
   its hub unchanged.

## Consequences

- A tunnel-only hub sends its pack directly with nothing to configure.
- The pack is public: anyone with its hash downloads it. It was already public on the hub.
- Each hub uploads to a third party by default: an admin who does not want that sets `""`.
- Not done yet: servers whose cached pack points at the hub keep that address until the next publish.
