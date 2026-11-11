# VPS deployment and CI/CD design

Date: 2026-06-18

## Goal

Deploy Artisan's backend, editor, and PostgreSQL database on a virgin OVH VPS,
then automatically deploy every validated merge to `main`. The Minecraft server
remains external to the VPS.

The deployment must be practical for a solo operator, keep the VPS origin IP
hidden from web clients, block releases that fail any project test suite, and
provide routine backups and rollback paths.

## Chosen architecture

The OVH VPS has 4 vCPU, 8 GB RAM, and Ubuntu 26.04. Coolify runs the application
stack and Cloudflare Tunnel is the only public web ingress.

| Public hostname | Destination | Purpose |
|---|---|---|
| `editor.artisanmc.net` | Editor nginx container | Static React editor |
| `api.artisanmc.net` | Bun backend container on port 3001 | REST, WebSockets, bundles, and resource packs |
| `coolify.artisanmc.net` | Coolify dashboard | Operations, protected by Cloudflare Access |

`cloudflared` establishes outbound connections from the VPS. Ports 80, 443, and
8000 are not opened inbound. SSH is the only directly reachable service and
should be restricted by the OVH firewall and UFW to the operator's trusted IP
whenever that IP is stable.

Cloudflare proxies both HTTP and WebSocket traffic. The Minecraft plugin connects
to `wss://api.artisanmc.net/ws/plugin`; the editor uses the API hostname for REST
and its WebSocket connection. Normal client reconnection handles tunnel or
deployment interruptions.

## Coolify resources

Coolify manages three persistent resources:

1. A PostgreSQL 16 database on the private Coolify network, with no published
   host port.
2. The backend built from `backend/Dockerfile`, with the repository root as build
   context and a persistent volume mounted at `/app/data`.
3. The editor built from `editor/Dockerfile`, with the repository root as build
   context and production API and WebSocket URLs passed as Vite build arguments.

The backend receives the database connection string over the private network.
Its startup command applies committed Drizzle migrations before starting Bun.
Migrations remain forward-only and idempotent. Backend deployment completes
before editor deployment begins.

The editor's canonical public hostname is `editor.artisanmc.net`; existing
production examples that use `app.artisanmc.net` will be updated.

## Cloudflare configuration

The `artisanmc.net` zone uses Cloudflare nameservers. A named Cloudflare Tunnel
routes the three public hostnames to their private Coolify services. No public A
or AAAA record exposes the VPS address.

Cloudflare Access protects the Coolify hostname. Interactive access requires the
operator identity. GitHub Actions receives a dedicated, least-privilege Access
service token plus the Coolify deployment credential; both live in GitHub
Actions secrets.

The selected Cloudflare plan's maximum HTTP request-body size applies to each
individual upload, not cumulative traffic. The initial deployment accepts this
constraint because Artisan uploads are expected to remain below 100 MB per HTTP
request. Downloads are not governed by that upload-body limit. This assumption
must be revisited before supporting larger single uploads; large WebSocket file
transfers are also outside the intended design.

## Continuous integration

A required GitHub Actions CI workflow runs for pull requests and pushes to
`main`. Independent jobs run in parallel:

- Backend: install with Bun, provision PostgreSQL for the isolated test database,
  and run `bun run test` through the repository's safe test wrapper.
- Editor: run `npm ci`, unit tests, and the production build. Repository-wide
  Biome lint becomes a required gate only after its pre-existing baseline is
  cleaned; enabling it now would reject `main` with hundreds of unrelated
  formatting errors.
- Plugin: run Gradle tests and build `shadowJar` on Java 21.

Dependency caches reduce repeat build times. The existing schema validation is
retained, either as its own required job or folded into the editor test job
without reducing coverage.

GitHub branch protection requires a pull request and all CI checks before merge
to `main`. No workflow ever runs `bun test` directly against the backend.

## Continuous deployment

Coolify's direct push auto-deploy is disabled. A deployment workflow runs only
for a successful CI result on `main` and has one active deployment at a time.
Before each deployment it pins the Coolify application's `git_commit_sha` to
the CI revision and rejects any deployment reporting a different commit.

The workflow performs this sequence:

1. Authenticate through Cloudflare Access and request a backend deployment from
   Coolify.
2. Wait for the Coolify deployment result, then probe
   `https://api.artisanmc.net/health` with bounded retries.
3. Request the editor deployment and wait for its Coolify result.
4. Probe `https://editor.artisanmc.net` and run lightweight REST and WebSocket
   smoke checks.
5. Mark the deployment failed if Coolify reports failure or any public smoke
   check remains unhealthy.

GitHub Actions environments serialize production deployments and can later add
manual approvals without redesigning the workflow. Secrets are masked and are
never written to repository files or workflow output.

## Failure handling and rollback

A CI failure prevents deployment. A backend build, migration, or health-check
failure stops the sequence before the editor is changed. An editor failure leaves
the already-compatible backend live and reports a failed release.

Coolify retains prior deployments for application rollback. Database migrations
are forward-only, so application changes must preserve compatibility during the
backend-first rollout. A destructive or incompatible database change requires a
separately reviewed expand/migrate/contract sequence rather than an automated
down migration.

Client WebSockets can disconnect during a backend rollout. Existing reconnect
behavior is the recovery mechanism; the deployment smoke test confirms that a
new WebSocket upgrade succeeds afterward.

## Backups and operations

- PostgreSQL receives daily automated backups with explicit retention and an
  off-host destination.
- `/app/data` is backed up separately. Runtime custom items and resource packs
  are treated as irreplaceable; generated Minecraft assets may be re-seeded.
- A restore drill validates both database and volume recovery after the first
  production deployment and periodically thereafter.
- Coolify and Ubuntu security updates are applied regularly.
- Logs and deployment history remain available in Coolify. Cloudflare provides
  edge and tunnel visibility without exposing the origin.

## Initial rollout and acceptance criteria

The initial rollout includes VPS hardening, Coolify, Cloudflare DNS and Tunnel,
Cloudflare Access, PostgreSQL, persistent storage, both application resources,
GitHub Actions CI/CD, branch protection, backups, and an operator runbook.

The rollout is accepted when all of the following are demonstrated:

- Pull requests cannot merge while any backend, editor, or plugin check fails.
- A validated merge to `main` deploys backend then editor without manual server
  commands.
- The REST health endpoint and both WebSocket endpoints work through Cloudflare.
- The editor uses `api.artisanmc.net`, with no production request to localhost.
- The origin IP is absent from public DNS and web ingress ports are closed.
- PostgreSQL is unreachable from the public Internet.
- A failed deployment is visible and does not continue to the next component.
- A previous application deployment can be selected for rollback.
- Database and `/app/data` backup jobs complete successfully, and restoration is
  documented and tested.

## Out of scope

- Hosting or deploying the Minecraft server.
- Publishing the plugin JAR to Minecraft servers.
- Multi-instance backend operation; WebSocket session state remains in memory.
- Supporting individual HTTP uploads above the active Cloudflare plan limit.
- Automatic database down migrations.
