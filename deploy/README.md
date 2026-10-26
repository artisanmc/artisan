# Déploiement production Artisan

Depuis le retrait du cloud (phase F), **seule la vitrine `artisanmc.net` est déployée** : la landing et
le wiki (docs-site). Il n'y a plus d'API ni d'éditeur hébergés — l'éditeur est embarqué dans le plugin,
qui tourne sur le serveur Minecraft de chaque utilisateur. Le VPS OVH (Ubuntu, Coolify) héberge
aussi le dépôt Maven `repo.artisanmc.net` (voir plus bas).

## Ce qui est servi

L'image `editor/Dockerfile` (contexte = racine du dépôt) exécute `npm run build:site` : build Astro du
wiki, build Vite `--mode site` de la landing, puis copie du wiki dans `dist/wiki/`. Nginx
(`editor/nginx.conf`) sert un unique bloc `artisanmc.net` :

- `/` → landing ; `/health` → `200 ok` ;
- `/wiki` → `308 /wiki/` ; `/wiki/…` → fichiers du wiki, 404 du wiki pour un guide inconnu ;
- tout autre chemin inconnu → 404 (pas de fallback SPA, pas de `/pricing`, pas de redirection éditeur).

Les redirections restent relatives (`absolute_redirect off`) pour garder le schéma et le port publics
derrière le proxy.

## Cloudflare et Coolify

Cloudflare gère les nameservers de `artisanmc.net`. Le Tunnel nommé publie :

| Hostname public | Service Coolify |
|---|---|
| `artisanmc.net` | ressource « editor » (la vitrine), port 80 |
| `repo.artisanmc.net` | Reposilite, port 8080 |
| `coolify.artisanmc.net` | interface Coolify, derrière Cloudflare Access |
| `*.artisanmc.app` | serveur de tunnel de l'éditeur, `http://localhost:18080` ([`tunnel-server/`](tunnel-server/README.md)) |

Le Worker `artisan-tunnel-test` intercepte `*-test.artisanmc.app` avant ce tunnel (essai, [`tunnel-worker/`](tunnel-worker/README.md)).

Aucun enregistrement A/AAAA vers l'origine ; le firewall du VPS n'expose aucun port web entrant.

La ressource Coolify de la vitrine (historiquement « editor », d'où `COOLIFY_EDITOR_UUID`) se construit
depuis le contexte `/` avec `editor/Dockerfile`, **sans build args**, domaine `https://artisanmc.net`.
Désactiver l'auto-deploy sur push : seul le workflow GitHub déploie.

## Livraison GitHub Actions

`.github/workflows/ci.yml` (job editor) : tests `deploy/*.test.mjs`, tests éditeur, smoke e2e,
`npm run build` (éditeur auto-hébergé), `npm run build:site` (vitrine + wiki), `npm run verify` dans
`docs-site` (liens, ancres, assets, index de recherche). Les pages du wiki vivent dans `docs/site/` : `docs-site` les compile pour `/wiki/`, et le futur site artisanmc.net assemble le même dossier sous `/docs/artisan/`. `.github/workflows/plugin.yml` lance les tests
Gradle et `shadowJar`.

Le dépôt est privé : chaque minute de runner est décomptée du quota de l'organisation (2 000 min/mois
incluses). Chaque workflow ne démarre donc que si ses entrées changent (`paths`, à tenir à jour quand
un module lit un nouveau répertoire, cf. `deploy/ci-workflow.test.mjs`), et seul `main` a un run
après merge (`deploy.yml` l'attend) : une PR vers `v2` est déjà testée sur son ref de merge.

`.github/workflows/deploy.yml` se déclenche quand la CI réussit sur `main` : il refuse un SHA qui n'est
plus la tête de `main`, puis `deploy/coolify-deploy.mjs` épingle `git_commit_sha` sur la ressource,
déclenche le déploiement, vérifie que Coolify rapporte exactement ce commit et attend que
`https://artisanmc.net/` réponde. Chaque requête et le job ont un délai maximal.

`.github/workflows/deploy-tunnel.yml` déploie le serveur de tunnel quand `plugin.yml` réussit sur
`main` (`plugin.yml` démarre aussi sur `deploy/tunnel-server/**`). `deploy/deploy-tunnel-server.mjs`
compare le commit déployé au nouveau sur `plugin/tunnel/`, `plugin/tunnel-server/`, le build Gradle et
`deploy/tunnel-server/` : sans changement, rien n'est redéployé, car un redéploiement coupe tous les
tunnels ouverts (les plugins se reconnectent). Sinon il épingle la ressource sur `main` à ce commit,
déploie et attend `https://connect.artisanmc.app/health`.

Environnement GitHub `production` :

| Type | Nom | Valeur |
|---|---|---|
| Variable | `COOLIFY_BASE_URL` | `https://coolify.artisanmc.net` |
| Variable | `COOLIFY_EDITOR_UUID` | UUID de la ressource Coolify de la vitrine |
| Variable | `COOLIFY_TUNNEL_SERVER_UUID` | UUID de la ressource Coolify du serveur de tunnel |
| Secret | `COOLIFY_API_TOKEN` | token API Coolify dédié au déploiement |
| Secret | `CF_ACCESS_CLIENT_ID` | client ID du service token Cloudflare Access |
| Secret | `CF_ACCESS_CLIENT_SECRET` | secret du service token Cloudflare Access |

Après une release : ouvrir `/`, ouvrir `/wiki/`, rechercher un terme, suivre un guide, confirmer qu'une
URL inconnue (dans et hors `/wiki/`) répond 404. Rollback : redéployer dans Coolify la dernière
révision saine (le site est statique, sans état).

En local : `npm ci --prefix docs-site`, puis `npm run dev:site --prefix editor`.

## API publique et Reposilite

- `.github/workflows/api-version-check.yml` + `deploy/api-version.mjs` : une PR qui touche l'API publique
  doit monter la version `Since` la plus haute de `docs/architecture/api-surface.md`.
- `.github/workflows/publish-api.yml` publie `artisan-core-api` sur `repo.artisanmc.net` ; déploiement
  et tokens Reposilite : [`reposilite/README.md`](reposilite/README.md).

## Retrait du cloud — checklist au passage de `main`

À faire une fois la branche sans cloud mergée dans `main` :

- [ ] Coolify : supprimer la ressource backend, la ressource PostgreSQL et le volume `/app/data`
      (après une dernière sauvegarde si besoin).
- [ ] Tunnel Cloudflare : retirer `api.artisanmc.net` et `editor.artisanmc.net`.
- [ ] Ressource vitrine : retirer le domaine `https://editor.artisanmc.net` et les anciens build args
      `VITE_*` ; ne garder que `https://artisanmc.net`.
- [ ] GitHub `production` : supprimer la variable `COOLIFY_BACKEND_UUID` et le secret `PLUGIN_SIGNING_KEY`.
- [ ] Supprimer les clients OAuth Google et Discord de l'app.
- [ ] Supprimer le webhook Stripe (et désactiver les produits/prix devenus inutiles).
