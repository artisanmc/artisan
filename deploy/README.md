# Artisan production deployment

Since the cloud was retired (phase F), **only the `artisanmc.net` showcase is deployed**: the landing page and
the wiki (docs-site). There is no hosted API or editor any more — the editor is bundled in the plugin,
which runs on each user's Minecraft server. The OVH VPS (Ubuntu, Coolify) also hosts
the `repo.artisanmc.net` Maven repository (see below).

## What is served

The `editor/Dockerfile` image (context = repository root) runs `npm run build:site`: Astro build of the
wiki, Vite `--mode site` build of the landing page, then the wiki is copied into `dist/wiki/`. Nginx
(`editor/nginx.conf`) serves a single `artisanmc.net` block:

- `/` → landing page; `/health` → `200 ok`;
- `/wiki` → `308 /wiki/`; `/wiki/…` → wiki files, the wiki's 404 for an unknown guide;
- any other unknown path → 404 (no SPA fallback, no `/pricing`, no editor redirect).

Redirects stay relative (`absolute_redirect off`) to keep the public scheme and port
behind the proxy.

## Cloudflare and Coolify

Cloudflare runs the nameservers of `artisanmc.net`. The named Tunnel publishes:

| Public hostname | Coolify service |
|---|---|
| `artisanmc.net` | "editor" resource (the showcase), port 80 |
| `repo.artisanmc.net` | Reposilite, port 8080 |
| `coolify.artisanmc.net` | Coolify UI, behind Cloudflare Access |
| `*.artisanmc.app` | the editor's tunnel server, `http://localhost:18080` ([`tunnel-server/`](tunnel-server/README.md)) |

The `artisan-tunnel` Worker (route `*.artisanmc.app/*`, fail open) serves the tunnel ahead of this server, which stays as the fallback; `artisan-tunnel-test` takes `*-test.artisanmc.app` ([`tunnel-worker/`](tunnel-worker/README.md)).

No A/AAAA record to the origin; the VPS firewall exposes no inbound web port.

The showcase's Coolify resource (historically "editor", hence `COOLIFY_EDITOR_UUID`) builds
from the `/` context with `editor/Dockerfile`, **without build args**, domain `https://artisanmc.net`.
Turn off auto-deploy on push: only the GitHub workflow deploys.

## GitHub Actions delivery

`.github/workflows/ci.yml` (editor job): `deploy/*.test.mjs` tests, editor tests, e2e smoke,
`npm run build` (self-hosted editor), `npm run build:site` (showcase + wiki), `npm run verify` in
`docs-site` (links, anchors, assets, search index). The wiki pages live in `docs/site/`: `docs-site` compiles them for `/wiki/`, and the future artisanmc.net site assembles the same folder under `/docs/artisan/`. `.github/workflows/plugin.yml` runs the
Gradle tests and `shadowJar`.

The repository is private: every runner minute counts against the organization's quota (2,000 min/month
included). So each workflow only starts when its inputs change (`paths`, to be kept up to date when
a module reads a new directory, see `deploy/ci-workflow.test.mjs`), and only `main` gets a run
after merge (`deploy.yml` waits for it): a PR to `v2` is already tested on its merge ref.

`.github/workflows/deploy.yml` fires when CI succeeds on `main`: it refuses a SHA that is no longer
the head of `main`, then `deploy/coolify-deploy.mjs` pins `git_commit_sha` on the resource,
triggers the deployment, checks that Coolify reports exactly that commit and waits until
`https://artisanmc.net/` answers. Each request and the job have a timeout.

`.github/workflows/deploy-tunnel.yml` deploys the tunnel server when `plugin.yml` succeeds on
`main` (`plugin.yml` also starts on `deploy/tunnel-server/**`). `deploy/deploy-tunnel-server.mjs`
compares the deployed commit with the new one on `plugin/tunnel/`, `plugin/tunnel-server/`, the Gradle build and
`deploy/tunnel-server/`: with no change, nothing is redeployed, since a redeploy drops every
open tunnel (the plugins reconnect). Otherwise it pins the resource on `main` to that commit,
deploys and waits for `https://connect.artisanmc.app/health`.

GitHub `production` environment:

| Type | Name | Value |
|---|---|---|
| Variable | `COOLIFY_BASE_URL` | `https://coolify.artisanmc.net` |
| Variable | `COOLIFY_EDITOR_UUID` | UUID of the showcase's Coolify resource |
| Variable | `COOLIFY_TUNNEL_SERVER_UUID` | UUID of the tunnel server's Coolify resource |
| Secret | `COOLIFY_API_TOKEN` | Coolify API token dedicated to deployment |
| Secret | `CF_ACCESS_CLIENT_ID` | client ID of the Cloudflare Access service token |
| Secret | `CF_ACCESS_CLIENT_SECRET` | secret of the Cloudflare Access service token |

After a release: open `/`, open `/wiki/`, search for a term, follow a guide, confirm that an
unknown URL (inside and outside `/wiki/`) answers 404. Rollback: redeploy the last healthy
revision in Coolify (the site is static, stateless).

Locally: `npm ci --prefix docs-site`, then `npm run dev:site --prefix editor`.

## Signed plugin releases

A `v<version>` tag (`git tag v1.0.50 && git push origin v1.0.50`) runs `.github/workflows/release.yml`:
build with the editor (`-PwithEditor -PartisanVersion=<version>`), then `.github/workflows/sign-release.yml`
signs the jar with Ed25519 and publishes a GitHub Release with the jar and `release.json`
(`{plugin, version, sha256, signature}`, signed message `artisan-release\n<plugin>\n<version>\n<sha256>`).
`/artisan update` checks them against the keys of `ReleaseKeys` before writing to `plugins/update/`.

`sign-release.yml` is shared: every plugin of the suite releases from its own repo, builds its jar,
uploads it as the `jar` artifact and calls
`uses: artisanmc/artisan/.github/workflows/sign-release.yml@v2` with `secrets: inherit` and
`permissions: contents: write`.

Setup, once for the organization:

- Secret `ARTISAN_SIGNING_KEY` (Settings → Secrets and variables → Actions → organization secret,
  limited to the plugin repos): the PEM private key, `openssl genpkey -algorithm ed25519`. Its public
  half (`openssl pkey -in key.pem -pubout -outform DER | base64 -w0`) goes into `ReleaseKeys.TRUSTED`.
- Whoever can push a `v*` tag publishes a release, and whoever can push a workflow to one of these
  repos can read the secret. With a single maintainer nothing more is needed. With collaborators, add a
  `v*` tag ruleset restricting creation, update and deletion: org-wide needs GitHub Team (the free plan
  does not enforce organization rulesets), per repo it is free on public repos. If the free plan keeps
  the organization secret from private repos, set the same `ARTISAN_SIGNING_KEY` as a repository secret
  there.

## Public API and Reposilite

- `.github/workflows/api-version-check.yml` + `deploy/api-version.mjs`: a PR that touches the public API
  must bump the highest `Since` version in `docs/architecture/api-surface.md`.
- `.github/workflows/publish-api.yml` publishes `artisan-core-api` to `repo.artisanmc.net`; Reposilite
  deployment and tokens: [`reposilite/README.md`](reposilite/README.md).

## Cloud retirement — checklist when merging into `main`

To do once the cloud-free branch is merged into `main`:

- [ ] Coolify: delete the backend resource, the PostgreSQL resource and the `/app/data` volume
      (after a last backup if needed).
- [ ] Cloudflare Tunnel: remove `api.artisanmc.net` and `editor.artisanmc.net`.
- [ ] Showcase resource: remove the `https://editor.artisanmc.net` domain and the old `VITE_*`
      build args; keep only `https://artisanmc.net`.
- [ ] GitHub `production`: delete the `COOLIFY_BACKEND_UUID` variable and the `PLUGIN_SIGNING_KEY` secret.
- [ ] Delete the app's Google and Discord OAuth clients.
- [ ] Delete the Stripe webhook (and deactivate the products/prices no longer needed).
