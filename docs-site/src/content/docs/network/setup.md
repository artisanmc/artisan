---
title: Set up a network
description: Step-by-step setup of a hub and its leaves behind Velocity, BungeeCord or no proxy.
sidebar:
  order: 2
---

Read [Network mode](/wiki/network/concepts/) first. The steps below assume a proxy
in front of three Paper servers: `lobby` (the hub), `survival` and `skyblock` (leaves),
on a private network where the lobby is `10.0.0.5`.

## 1. Install the same jar everywhere

Put the same `artisan-plugin-<version>-all.jar` in `plugins/` of every Paper
server, start each once so it writes `plugins/Artisan/environment.yml`, then stop them.
Nothing goes on the proxy.

## 2. Configure the hub

On `lobby`, `role` stays `hub`. Give it a public editor address and make `/ws/plugin`
reachable from the leaves:

```yaml
# lobby — plugins/Artisan/environment.yml
web:
  enabled: true
  port: 8765
  bind: ""                            # or "10.0.0.5" to listen on the private network only
  url: "https://editor.example.com"   # or "http://<public-ip>:8765"
  role: "hub"
  name: "lobby"
```

Setting `url` on the hub matters in a network: without it, links fall back to the
host the player joined with plus the hub's port — usually the proxy's address, where
nothing listens on 8765.

## 3. Configure each leaf

```yaml
# survival — plugins/Artisan/environment.yml
web:
  enabled: true
  role: "leaf"
  name: "survival"
  hub-url: "ws://10.0.0.5:8765/ws/plugin"
```

`hub-url` is the hub's address **as the leaf sees it**: a private IP, a Docker service
name (`ws://lobby:8765/ws/plugin`), or `wss://editor.example.com/ws/plugin` through a
TLS reverse proxy. Repeat with `name: "skyblock"` on the other leaf.

## 4. The shared secret

Hub and leaves must hold the same secret. Each server looks for it in this order:

1. `web.secret` in `environment.yml`, when not empty;
2. the **Velocity forwarding secret**, read from `config/paper-global.yml`
   (`proxies.velocity.secret`), when `proxies.velocity.enabled` is `true`;
3. the file `plugins/Artisan/network-secret`. The hub generates it (32 random bytes)
   when it finds nothing above; a leaf only reads it.

Pick the case that matches your proxy.

### Velocity

Nothing to do. With modern forwarding, every Paper server already has the same
secret in `config/paper-global.yml`:

```yaml
# config/paper-global.yml (written when you set up Velocity forwarding)
proxies:
  velocity:
    enabled: true
    online-mode: true
    secret: "the-content-of-velocity-forwarding.secret"
```

Leave `web.secret` empty everywhere and Artisan uses it.

### BungeeCord, Waterfall, or no proxy

There is no shared secret to reuse. Either:

- **choose one** and write it in `web.secret` on every server, for example from
  `openssl rand -base64 32`; or
- start the hub once with `web.secret` empty, then copy the content of its
  `plugins/Artisan/network-secret` into `web.secret` on each leaf (or copy the file
  itself into each leaf's `plugins/Artisan/`).

A secret in `web.secret` takes priority over Velocity's, on every server. If you set
it on one server, set it on all of them.

## 5. Open the network path

The leaves must reach the hub's `web.port` (8765). Allow it from the leaves' addresses
only, for example with `ufw` on the hub:

```bash
ufw allow from 10.0.0.0/24 to any port 8765 proto tcp
```

Admins reach the editor at `web.url`: through your reverse proxy, or the port itself.
See [Web server & HTTPS](/wiki/configuration/web-server/#networks-and-wsplugin).

## 6. Start and check

Start the hub, then the leaves (any order works; leaves retry). Expected logs:

| Server | Line |
|---|---|
| hub | `[Artisan] Editor listening on port 8765` |
| leaf | `[Artisan] Editor served by the hub at ws://10.0.0.5:8765/ws/plugin` |
| hub, per leaf | `[Artisan] Server survival connected to the editor` |

Then, on any server, run `/artisan editor`. The editor lists `lobby` and each leaf;
leaf projects appear as `survival.<folder>`.

Nothing in the logs, or an error? See [Network troubleshooting](/wiki/network/troubleshooting/).

## Optional: shared database

If add-ons must share data across servers, point every server at the same MySQL or
MariaDB database (`database.*` in `environment.yml`). See
[Database](/wiki/configuration/database/) and the
[full example configs](/wiki/network/example-configs/).
