# repo.artisanmc.net (Reposilite)

Public Maven repository serving `net.artisanmc:artisan-core-api` to add-ons.
Repositories: `releases` (tags `api-vX.Y.Z`) and `snapshots` (pushes to `main` touching the API
or `plugin/build.gradle.kts`), both readable anonymously; writing needs a token.
Published by `.github/workflows/publish-api.yml`.

## Deploy in Coolify

1. New resource > Docker Compose, source: this repository, compose file
   `deploy/reposilite/docker-compose.yml`.
2. Domain of the `reposilite` service: `https://repo.artisanmc.net`, port 8080.
   DNS: add `repo.artisanmc.net` to the Cloudflare Tunnel (no A/AAAA record to the origin,
   cf. `deploy/README.md`). Do not put Cloudflare Access in front of it:
   Gradle must read it anonymously.
3. First deploy only: environment variable `REPOSILITE_OPTS=--token admin:<long random secret>`.

## Tokens (first deploy)

Open `https://repo.artisanmc.net`, sign in with `admin` / the secret, open the console and run:

```
token-generate --secret=<another long secret> github-ci
route-add github-ci /releases w
route-add github-ci /snapshots w
token-generate --secret=<a third secret> iban m
```

Command names can be checked with `help` in the console. Then remove `REPOSILITE_OPTS` in Coolify and redeploy (the temporary token disappears,
`iban` stays as the manager account).

In GitHub, `artisanmc/artisan` > Settings > Secrets and variables > Actions:
`ARTISAN_REPO_USERNAME=github-ci`, `ARTISAN_REPO_PASSWORD=<its secret>`.

## Release

Merging to `main` publishes the snapshot. A release: `git tag api-v1.6.0 && git push origin api-v1.6.0`.

## Check

`curl -s https://repo.artisanmc.net/releases/net/artisanmc/artisan-core-api/maven-metadata.xml`
lists the published versions.

Backups: the `reposilite-data` volume holds every artifact; include it in the VPS backups.
