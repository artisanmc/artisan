# Editor tunnel server

Prototype (ADR `editor-tunnel`). An Artisan plugin with `web.tunnel` opens an outgoing WebSocket
to this server and receives the address `https://<id>.<domain>`; every browser request to
that address is passed as is to the plugin. The server only keeps the names that addresses
have taken (`survie.artisanmc.app`, see "Address names"), nothing of what passes through.

## Domain and certificate

Tunnels live on a **dedicated** domain, `artisanmc.app`, never on `artisanmc.net`: a page
served by a tunnel is chosen by the Minecraft server, not by Artisan. On a separate domain, an
abuse (phishing) does not touch the reputation of the site and the wiki, and a tunnel page cannot
set cookies on `.artisanmc.net`. This is the scheme of `github.io`, `vercel.app` or
`cloudflareaccess.com`.

Each Minecraft server has its subdomain, so a **wildcard** certificate is needed: Cloudflare's free
universal certificate covers `*.artisanmc.app` (one level). Tunnels answer on
`https://<id>.artisanmc.app` and plugins connect on `connect.artisanmc.app`. `.app` requires
HTTPS (preloaded HSTS), which Cloudflare provides.

## Deployment on the VPS (Coolify + Cloudflare Tunnel)

1. Cloudflare: add the `artisanmc.app` zone (nameservers at the registrar), SSL/TLS on "Full".
2. Coolify: Docker Compose resource from this repository, **Base Directory** `/deploy/tunnel-server` and
   **Docker Compose Location** `/docker-compose.yml`. With a base at `/`, Coolify resolves the
   `context: ../..` from the repository root and the build fails. No domain on the service, and
   tick "Connect To Predefined Network" so the container joins the `coolify` network.
   Variable `TUNNEL_DOMAIN=artisanmc.app`: Coolify pre-fills it with the compose's error message,
   it must be replaced. `TUNNEL_ACCESS_CODE` stays empty: the tunnel is open to everyone.
   For address names: `TUNNEL_NAMES_WEBHOOK` (Discord webhook) and `TUNNEL_ADMIN_TOKEN` (a
   long random secret, `openssl rand -hex 32`). The `tunnel-data` volume keeps the names.
3. Existing Cloudflare tunnel: a route ("Published application route", formerly "Public Hostname")
   `*.artisanmc.app` to the container, and a second `artisanmc.app` if the root must answer.
   - `cloudflared` installed on the machine (common case): `http://localhost:18080`. The compose
     publishes the port on `127.0.0.1` only, nothing is opened to the outside.
   - `cloudflared` in a container on the `coolify` network: `http://tunnel-server:8080`, the service
     name, stable from one deployment to the next (the container name changes every time).

   DNS: a `*` CNAME to `<tunnel-id>.cfargotunnel.com`, proxied, if it is not created on its own.
   A Cloudflare 502 on `/health` means `cloudflared` does not reach the route's URL.
4. Check: `curl https://connect.artisanmc.app/health` answers `ok`.

Cloudflare forwards WebSockets and keeps the `Host` header; it cuts an idle WebSocket after
100 s, the plugin sends a ping every 25 s. Bodies are limited to 100 MB on the Free and Pro plans,
like the hub's pack.

Minecraft server off or silent: the tunnel server answers **503** with its own page (FR/EN
depending on the browser, reloaded every 30 s, `OfflinePage.kt`), plain text for scripts.
Never 502 or 504: Cloudflare replaces them with its "Bad gateway" page, which blames Artisan's infrastructure.
A Cloudflare 502 page on `<id>.artisanmc.app` therefore comes from the unreachable container, or from a 502
returned by the hub itself (its `fetch_error` errors).

## Minecraft server side

```yaml
# plugins/Artisan/environment.yml
web:
  tunnel: "connect.artisanmc.app"   # the default value, without web.url
```

A leaf with no port to its hub targets the hub's tunnel address:
`web.hub: "https://<id>.artisanmc.app"`.

On restart, the console writes `Editor reachable through the tunnel server at https://<id>.artisanmc.app`,
and `/artisan editor` gives a link to this address. A refused code is also written to the console.

## Address names

From the editor settings, an admin (`artisan.editor.config`) can give their address a name:
`https://survie.artisanmc.app` then answers like `https://<id>.artisanmc.app`, which
keeps working. The plugin requests the name through its tunnel connection, signed with its secret: only
the server (or network) that holds the address can name it. One name per address, first come
first served, released after 90 days without a connection.

Refused: the names of the tunnel server and of the project (`connect`, `www`, `admin`, `artisan`…), those
that contain a brand where people sign in or a phishing word (`paypal`, `discord`,
`login`, `verify`…, list in `NameRegistry.kt`), and those in `TUNNEL_RESERVED_NAMES`. At most 3
changes per address and 10 per server IP per day.

Each name taken is sent to the Discord webhook in `TUNNEL_NAMES_WEBHOOK`. To remove a name
(`TUNNEL_ADMIN_TOKEN` in the `TOKEN` variable):

```bash
# List the names
curl -H "Authorization: Bearer $TOKEN" https://connect.artisanmc.app/admin/names
# Release a name; ?ban=1 also prevents it from being taken again
curl -X DELETE -H "Authorization: Bearer $TOKEN" "https://connect.artisanmc.app/admin/names/paypal-mc?ban=1"
# Lift a ban
curl -X DELETE -H "Authorization: Bearer $TOKEN" https://connect.artisanmc.app/admin/bans/paypal-mc
```

The server concerned immediately gets its `<id>` address back. Without `TUNNEL_ADMIN_TOKEN`,
the `/admin/` routes do not exist.

## Variables

| Variable | Default | Role |
|---|---|---|
| `TUNNEL_DOMAIN` | required | Tunnel domain. Plugins connect on `/tunnel` of any name that is not a connected tunnel (the domain, or `connect.<domain>`). |
| `TUNNEL_PORT` | `8080` | Local HTTP port (behind the TLS proxy). |
| `TUNNEL_PUBLIC_SCHEME` | `https` | Scheme of the addresses given to plugins. |
| `TUNNEL_ACCESS_CODE` | empty | Code required from plugins; empty: open to everyone. |
| `TUNNEL_MAX_BODY_MB` | `100` | Maximum size of a browser request. |
| `TUNNEL_MAX_STREAMS` | `64` | Simultaneous requests and WebSockets per tunnel. |
| `TUNNEL_BLOCKED_PATHS` | empty | Path prefixes never passed, comma-separated. |
| `TUNNEL_REQUESTS_PER_MINUTE` | `600` | Browser requests per tunnel per minute (429 beyond); 0: no limit. |
| `TUNNEL_BANDWIDTH_KBPS` | `2048` | Throughput per tunnel, both directions combined, in KiB/s: slowed, never cut; 0: no limit. |
| `TUNNEL_DAILY_MB` | `2048` | Volume per tunnel per UTC day (429 beyond); 0: no limit. |
| `TUNNEL_PER_ADDRESS` | `3` | Tunnels open at the same time from a single address; 0: no limit. |
| `TUNNEL_NAMES_FILE` | empty (`/app/data/names.json` in the compose) | Address names file; empty: no names, only `<id>`s. |
| `TUNNEL_RESERVED_NAMES` | empty | Names forbidden in addition to the built-in list, comma-separated. |
| `TUNNEL_NAME_EXPIRY_DAYS` | `90` | Days without a connection after which a name becomes free again. |
| `TUNNEL_NAMES_WEBHOOK` | empty | Discord webhook notified of each name taken. |
| `TUNNEL_ADMIN_TOKEN` | empty | Token for the `/admin/` routes; empty: no admin routes. |
| `TUNNEL_CLIENT_IP_HEADER` | empty | Header carrying the client address set by the TLS proxy: `CF-Connecting-IP` behind Cloudflare. Never without such a proxy (forgeable). |

## Before a public launch

Done: per-tunnel limits (variables above), `__Host-` cookie behind the tunnel, names
filtered and reported to the webhook. Remaining: an abuse and contact page on the domain, and a way to
cut an `<id>` address (only names can be removed today).
