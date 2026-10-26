# Equal servers on one database: a network without a designated hub

**Status:** proposed (2026-10-20). Follows `editor-web-server` and `editor-tunnel`.

## Context

A network has a hub (`web.hub` empty) and leaves (`web.hub` set) connected to its
`/ws/plugin`. So each leaf must be configured, a leaf → hub network path must be kept,
and the hub is the only access to the editor: if it goes down, nobody edits. With the
default tunnel (`editor-tunnel`), each server already has its own link
`https://<id>.artisanmc.app`, and the servers of a network already share a MySQL/MariaDB
database (`server-identity-and-versions`).

## Decisions

1. **The shared database makes the network.** Two servers on the same database (same
   `database_id`) are peers; no `web.hub`. Each server that serves its editor announces in
   `artisan_servers` where its `/ws/plugin` answers: `editor_url` (its public address,
   tunnel or `web.url`) and `internal_url` (`ws://<web.bind or the machine's
   address>:<port>/ws/plugin`).
2. **Each is a hub for its link, a leaf for the others.** Every 30 s, a server re-reads
   the running peers seen less than 3 minutes ago (`ServerRegistry.peers`) and joins each
   one as a leaf, with the existing `/ws/plugin` protocol: internal address first, then
   public address (`HubLink.alternates`). From any link you see and publish on all
   servers; a stopped server only cuts its own link.
3. **The secret comes from the database.** `network_secret` in `artisan_meta`, generated
   by the first server that asks for it. Whoever reads the database already controls the
   network; the secret only keeps strangers out of `/ws/plugin`. The hub accepts it in
   addition to its configured secret.
4. **Responses go back to whoever asked.** A server keeps the origin of each request
   (`request_id`) and answers it; its announcements (`modules_changed`,
   `projects_reloaded`…) go to all its hubs. A peer does not impose on it the pack it
   holds in memory at connection: only a `resource_pack_updated` changes it, downloaded
   from the peer that sends it.
5. **One address for the network.** On a shared database, the tunnel secret is derived
   from `network_secret` (`TunnelClient.networkSecret`): all servers open their tunnel on
   the same address, and each names itself there (`X-Artisan-Tunnel-Member`, its server
   id). The tunnel server sends browsers to the last one connected, the others take over
   if it leaves; a request that names a server goes to that one alone, which is how peers
   reach each other through the common address. The `/artisan editor` links are stored in
   the database like sessions (`Sessions`, key `link:`), and each server re-reads from
   the database a session held in memory at most every 30 s: a link created on one server
   opens on another, and a session closed or permissions removed elsewhere apply
   everywhere.
6. **The configured hub stays.** `web.hub` keeps its meaning (leaf of a chosen hub); a
   leaf has no link of its own and does not announce itself as a peer. H2 has no peers.

## Consequences

- A single address per network, which survives the stop of any server. All editing traffic
  goes through one server at a time; a switch reconnects the open editor.
- A database unavailable for more than 30 s disconnects the sessions already re-read from
  the database.
- No port to open: outgoing tunnel, outgoing connection to the peer's tunnel, outgoing
  database.
- N servers make N×(N-1) links. Negligible up to about twenty; not measured beyond.
- No presence between links: an admin on A does not see live who is editing on B. The
  publish compare-and-swap refuses the second publish instead of overwriting.
- Each link serves its own editor: servers of different versions each show their own,
  like a hub facing leaves of other versions today.
- A wrong internal address (different machines) is tried then dropped for the public
  address; an address that answers but leads to another server is refused by
  `/ws/plugin` (server id, `database_id`, secret).
