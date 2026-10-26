# The editor tunnel: a server with no open port

**Status:** proposed (2026-10-20), prototype. Follows `editor-web-server`.

## Context

The hub serves the editor on `web.port`. Many hosts only give one port, or charge for
it, and without HTTPS the browser does not expose `crypto.subtle`. A cloud-hosted editor
would solve access, but would reopen what self-hosting closed: a one-version editor
facing the engines of all installed versions (`content-version-negotiation`),
storage, accounts. Analysis: `cloud-ou-auto-hebergement.md` (project files).

## Decisions

1. **The tunnel by default, nothing more.** Without `web.url`, the hub opens an **outbound**
   WebSocket to `/tunnel` on `web.tunnel` (default `connect.artisanmc.app`, `""` to opt out),
   which gives it an address `https://<id>.artisanmc.app`. No port to open for an
   installation with no configuration. Every HTTP request and every browser WebSocket
   goes through this WebSocket and is replayed as is on the hub's local web port
   (`TunnelClient`, `hub` module). A leaf ignores `web.tunnel`.
2. **The tunnel server understands nothing.** It does not serve the editor, only stores address
   names (decision 8) and
   reads neither the editor's protocol nor its formats. It passes the browser's headers,
   `Host` and `Origin` included: the same-origin check and the hub's cookies
   apply unchanged. The served editor stays the one in the jar: no new version axis
   between editor and engine. Only the tunnel wire is versioned
   (`X-Artisan-Tunnel-Version`, different major = refusal).
3. **Minimal binary wire** (`plugin/tunnel`, `Frame`): `[type][stream][payload]`, one stream per
   browser request or WebSocket, bodies split in 256 KiB chunks. A request body
   is kept whole plugin-side before being replayed (100 MiB at most, the limit of the hub's
   pack); the response comes back as a stream.
4. **Identity comes from a secret.** The plugin generates `plugins/Artisan/tunnel-secret` once;
   `<id>` is derived from it (SHA-256, base32, 16 characters). The address is stable across
   restarts, nobody can take it without the secret, and the tunnel server needs
   no database. Several connections with the same secret coexist: the last one answers, the
   previous one takes over if it leaves (servers of a network, ADR `peer-servers`).
5. **Players never go through the tunnel.** They receive the pack from a pack plugin
   (Nexo, Oraxen, ItemsAdder), never from the editor's web server: bandwidth grows with
   editing sessions and pack updates, never with player connections.
   Nothing is blocked by default (`TUNNEL_BLOCKED_PATHS` remains available).
6. **A leaf with no port reaches its hub through the tunnel.** `web.hub: "https://<id>.artisanmc.app"`:
   `/ws/plugin` and the pack download go through the hub's tunnel, neither
   server listens. The network stays carried by the hub and the follow-up database; the tunnel
   server does not know about networks.
7. **Private server possible.** `TUNNEL_ACCESS_CODE` server-side, `web.tunnel-access` plugin-side:
   a refused code closes the tunnel with the reason (code 4003), which the plugin writes to its console.
8. **A name for the address** (2026-10-21). The tunnel server keeps, in a JSON file
   (`NameRegistry`, `TUNNEL_NAMES_FILE`), names that addresses have taken:
   `survie.artisanmc.app` answers like `<id>.artisanmc.app`, which stays valid. An admin
   picks it in the editor settings; the plugin requests it through its tunnel connection
   (`NAME`/`NAME_RESULT` frames), already signed with its secret: no separate page or account
   to prove who holds the address. The tunnel server sends `HELLO` back to each tunnel of
   the address with the new name, so to all servers of a network; the plugin's database
   keeps nothing. One name per address, first come first served, released after 90 days without
   connection, at most 3 changes per address and 10 per plugin IP per day. Refused:
   the names of the tunnel server and of the project, those containing a brand where people log in
   or a phishing word, and those shaped like an `<id>`. Each name taken goes
   to a Discord webhook (`TUNNEL_NAMES_WEBHOOK`); `/admin/names` (token `TUNNEL_ADMIN_TOKEN`)
   frees or bans a name. The session stays on the old address (`__Host-` cookie): the hub
   returns a login link for the new one (`Sessions.handOff`).
9. **Standalone server** in the repository (`plugin/tunnel-server`, Jetty, `deploy/tunnel-server/`), deployed
   as a container behind a TLS proxy that covers `*.<domain>`.

*Rejected:* hosted editor calling the plugin (mixed content HTTPS → HTTP blocked, and the return of the
editor ↔ engine axis); hosted hub (stateful multi-tenant, one hub version facing all
leaves); online storage and retrieval by command, NxMenu style (accounts, storage,
central editor); path routing `/t/<id>/` (all servers would share an origin,
hence their cookies).

## Consequences

- The tunnel server sees the traffic in clear (TLS terminated at its end): session cookies and
  project content. To tell users; direct mode remains the default.
- A modified plugin can serve any page under `*.<domain>`. With random identifiers
  phishing is not very credible. So tunnels live on a dedicated domain,
  `artisanmc.app`, separate from the `artisanmc.net` site: an abuse does not affect its reputation and a tunnel
  page cannot set cookies on the site.
- Per-tunnel limits, in memory (`TunnelLimits`): requests per minute and volume per day
  (429 beyond), throttled throughput, simultaneous tunnels per address.
- Behind the tunnel the hub sees `X-Forwarded-Proto: https` and sets `__Host-artisan_session`
  (`Secure`): a page on another subdomain can neither read nor overwrite it. The hub reads this
  cookie before `artisan_session`.
- `web.url` keeps priority: an admin with their own proxy is not concerned.
- A readable name makes phishing more credible than an `<id>`: hence the word filter, the
  webhook and the revocation. An `<id>` address cannot be cut off yet; to do before a wide
  opening, with an abuse page.
- The names file is the tunnel server's only state: it lives on a volume
  (`tunnel-data`). Losing it releases all names, the `<id>` addresses remain.
