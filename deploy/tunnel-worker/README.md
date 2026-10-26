# Tunnel server as a Cloudflare Worker

ADR `editor-tunnel`, decision 10. The same tunnel as `deploy/tunnel-server/`, same frames, same headers and
same addresses, but served by Cloudflare as close as possible to the Minecraft server: an unchanged plugin
connects to it without knowing. The Kotlin server stays the reference, and the Worker's fallback.

## Why

With a single tunnel server in France, a request goes browser → France → Minecraft server → France →
browser. For an admin and a server both far from France (Vietnam, the Americas), that is twice the distance
for nothing. Here each address is a Durable Object created next to the plugin at its first connection; the
browser enters Cloudflare next to it and crosses the network only once. Measured on 2026-10-26, plugin and
"browser" in US-East: 135 ms median through the Worker, 285 ms through the Kotlin server in France.

## How it works

- `src/index.ts` (the Worker): `/tunnel` on `connect.<domain>` checks the secret, the version and the access
  code like `TunnelServer.acceptTunnel`, then hands the connection to the address's object. A request to
  `<id>.<domain>` or `<name>.<domain>` goes to the address's object.
- `src/tunnel.ts` (`TunnelObject`, one per address): keeps the plugins' WebSockets (hibernation API) and
  replays each browser request and WebSocket as `Frame`s. The last plugin connected answers;
  `X-Artisan-Tunnel-Member` picks one (ADR `peer-servers`).
- `src/names.ts` (`NamesObject`, a single one): the address names, with `NameRegistry`'s rules (filter,
  quotas, expiry after 90 days, bans, Discord webhook). The Worker reads `name:<name>` from KV, never the object.
- KV `loc:<id>` = `{gen, continent}`: which object serves the address, written only when an address moves.
  Without it the address is at generation 0, whose object keeps the continent of its first plugin. A
  plugin connecting from another continent, while no plugin holds the old object, gets a new one (`gen + 1`)
  next to it. The address does not change. Browsers see it within a minute (KV cache and the Worker's cache).
  A KV write per new address would spend the free plan's 1,000 writes a day: on 2026-10-26, test runs that
  opened a fresh address per test did in an hour.
- An address's object is created next to its first plugin: nobody knows the address before its plugin
  connects. A browser request for an address with no plugin reaches the object, which answers "absent";
  the Worker then remembers it for 30 s and sends the next ones to the fallback.

## The Kotlin server as fallback

With `TUNNEL_FALLBACK=origin`, what the Worker does not serve goes to the zone's origin (`cloudflared` →
`tunnel-server` on the VPS): a Worker's request to its own route goes to the origin, not to itself.

- Worker quota exhausted: the route "fails open" (`request_limit_fail_open`), requests go straight to the
  origin, and so do plugins that reconnect.
- Object unreachable (Durable Objects quota) or address with no plugin on the Worker side: the request is
  replayed on the origin. A body over 1 MiB is not: that case gets the offline page.
- Origin down (502 or 530): the Worker's offline page.

## Known limits

- `TUNNEL_PER_ADDRESS` (tunnels per IP, all addresses together) does not exist here: it would need global
  state. The throughput per tunnel (`TUNNEL_BANDWIDTH_KBPS`) is not throttled; requests per minute and
  volume per day are, in the object's memory.
- A large response crosses the object without back-pressure: capped by its memory (128 MB).
- `/admin/names` does not say whether an address is connected.

## Run locally and test

```bash
npm ci
npm run dev:test        # http://127.0.0.1:8787, domain tunnel.test, access code letmein
cd ../../plugin
ARTISAN_TUNNEL_WORKER_URL=http://127.0.0.1:8787 ARTISAN_TUNNEL_WORKER_DOMAIN=tunnel.test \
  ARTISAN_TUNNEL_WORKER_SCHEME=http ARTISAN_TUNNEL_WORKER_ACCESS=letmein \
  ./gradlew :artisan-tunnel-server:test --rerun --tests '*TunnelWorkerTest*'
```

`TunnelWorkerTest` runs a real hub and the real `TunnelClient` against the Worker: address, the hub's rules,
a 3 MiB body, the editor WebSocket, the offline page, servers of a network, names, and the latency of a small
request. Against the deployed trial: `ARTISAN_TUNNEL_WORKER_DOMAIN=artisanmc.app ARTISAN_TUNNEL_WORKER_SUFFIX=-test`;
against production: `ARTISAN_TUNNEL_WORKER_DOMAIN=artisanmc.app`.

## Deployments

Iban's Cloudflare account, zone `artisanmc.app`. Both Workers run the same code; `npm run build` then
`wrangler deploy` (or the Workers API), with the secret `TUNNEL_ADMIN_TOKEN` (`wrangler secret put`) and
`TUNNEL_NAMES_WEBHOOK` for names.

**Production (since 2026-10-26)**

- Worker `artisan-tunnel`, route `*.artisanmc.app/*` failing open, KV `artisan-tunnel`
  (`439f307bdb1f407abd709ac445103228`), empty `TUNNEL_LABEL_SUFFIX`. The `*` DNS record is unchanged.
- The Kotlin server's names were imported (`POST https://connect.artisanmc.app/admin/import` with the output of
  its `GET /admin/names`). The Worker's `TUNNEL_ADMIN_TOKEN` is its own. `TUNNEL_NAMES_WEBHOOK` is not set yet:
  add the same one as on Coolify to be told about new names.
- Plugins connected to the Kotlin server stay there until they reconnect; until then the Worker sends their
  requests to the origin. No jar to update, no address changes.
- Rollback: delete the route. Everything goes back to the Kotlin server, which stays deployed as the
  fallback. A name taken on the Worker in the meantime is not copied back.

**Trial**

- Worker `artisan-tunnel-test`, route `*-test.artisanmc.app/*` failing open, KV `artisan-tunnel-test`.
  `TUNNEL_LABEL_SUFFIX=-test`: addresses are `<id>-test.artisanmc.app` and `connect-test.artisanmc.app`,
  covered by the universal certificate (one level). This route is more specific than production's, so it
  takes precedence.
- A server tries it with `web.tunnel: "connect-test.artisanmc.app"` in `environment.yml`.
