# Déploiement production Artisan

La production tourne sur un VPS OVH 4 vCPU / 8 Go sous Ubuntu 26.04, avec Coolify. Le serveur Minecraft reste externe : le plugin ouvre uniquement une connexion sortante vers `wss://api.artisanmc.net/ws/plugin`.

## Réseau et Cloudflare

Cloudflare gère les nameservers de `artisanmc.net`. Créer un Tunnel nommé et y publier :

| Hostname public | Service Coolify |
|---|---|
| `api.artisanmc.net` | backend, port 3001 |
| `editor.artisanmc.net` | éditeur nginx, port 80 |
| `coolify.artisanmc.net` | interface Coolify |

Ne créer aucun enregistrement A/AAAA vers l'origine. Le firewall du VPS n'expose directement aucun port entrant 80, 443 ou 8000 ; l'accès web passe par le Tunnel. Protéger `coolify.artisanmc.net` avec Cloudflare Access. Créer un service token Access dédié à GitHub Actions, sans réutiliser un jeton utilisateur.

La limite du plan Cloudflare actif s'applique au corps de chaque requête HTTP d'upload entrante. Chaque upload de bundle ou custom item doit rester sous cette limite. Elle ne régit pas les téléchargements de resource packs.

## Ressources Coolify

Créer un projet Artisan contenant :

- PostgreSQL 16, privé sur le réseau Coolify, sans port public ;
- le backend depuis le contexte `/` et `backend/Dockerfile`, domaine `https://api.artisanmc.net`, health check `/health`, stockage persistant monté sur `/app/data` ;
- l'éditeur depuis le contexte `/` et `editor/Dockerfile`, domaine `https://editor.artisanmc.net`, avec les build args `VITE_API_URL=https://api.artisanmc.net` et `VITE_PLUGIN_WS_URL=wss://api.artisanmc.net/ws/plugin`.

Copier les variables backend de [`.env.production.example`](.env.production.example), remplacer seulement les exemples/secrets dans Coolify, et conserver les valeurs publiques canoniques. `DATABASE_URL` doit utiliser la connection string interne de PostgreSQL. Générer et conserver durablement `CONFIG_ENC_KEY`; ne jamais le committer.

Le volume `/app/data` contient les données runtime et les assets. Après sa création, le seed initial peut être envoyé depuis la racine du repo :

```bash
VPS_HOST=root@<VPS_HOST> \
VOLUME_PATH=<COOLIFY_BACKEND_VOLUME_PATH> \
./deploy/seed-data.sh
```

Les placeholders doivent être remplacés par les valeurs réelles affichées dans les dashboards ; aucun UUID ou token fictif n'est une valeur déployable.

Ce seed manuel n'est plus requis pour faire marcher la bibliothèque de l'éditeur : les textures vanilla se retéléchargent seules depuis Mojang (`lib/mcAssets.ensureAssets`), et les icônes 3D pré-rendues + les `items/<version>.json` correspondants voyagent dans l'image (`backend/assets-seed/icons-<version>.zip`), déposés dans le volume au boot par `lib/assetSeed.ts` s'ils y manquent — un fichier déjà présent n'est jamais écrasé. À chaque nouvelle version de Minecraft : `gen-items.ts`, `gen-icons.ts`, puis `pack-icons.ts` et **committer l'archive**. `seed-data.sh` reste utile pour transférer le reste du volume (assets uploadés, resource packs).

## Livraison GitHub Actions

Désactiver l'auto-deploy Coolify sur push. Les seules releases automatiques passent par `.github/workflows/ci.yml`, puis `.github/workflows/deploy.yml` sur la révision courante validée de `main`.

Dans l'environnement GitHub `production`, définir exactement :

| Type | Nom | Valeur attendue |
|---|---|---|
| Variable | `COOLIFY_BASE_URL` | `https://coolify.artisanmc.net` |
| Variable | `COOLIFY_BACKEND_UUID` | UUID réel de la ressource backend Coolify |
| Variable | `COOLIFY_EDITOR_UUID` | UUID réel de la ressource éditeur Coolify |
| Secret | `COOLIFY_API_TOKEN` | token API Coolify dédié au déploiement |
| Secret | `CF_ACCESS_CLIENT_ID` | client ID du service token Cloudflare Access |
| Secret | `CF_ACCESS_CLIENT_SECRET` | secret du service token Cloudflare Access |

Le workflow reçoit le SHA validé par CI, épingle `git_commit_sha` sur chaque application Coolify avant son déploiement, puis vérifie que Coolify rapporte exactement ce commit. Il déploie le backend en premier, attend `https://api.artisanmc.net/health`, puis déploie et vérifie `https://editor.artisanmc.net/`. Chaque requête réseau et le job complet ont un délai maximal. Les WebSockets sont vérifiés séparément après la release. Ne dupliquer aucune de ces valeurs dans le dépôt.

## Vérification et rollback

Après une release :

1. vérifier que `/health` répond correctement sur l'API ;
2. vérifier l'ouverture des WebSockets éditeur et plugin via `wss://api.artisanmc.net` ;
3. charger l'éditeur et confirmer que ses requêtes ciblent `api.artisanmc.net`, jamais `localhost:3001` ;
4. confirmer qu'un plugin externe se reconnecte et reçoit les événements attendus.

En cas d'échec, consulter les logs de la ressource concernée puis utiliser le rollback du workflow/Coolify vers la dernière image saine. Les migrations DB sont forward-only et s'exécutent au démarrage du backend : ne jamais supposer qu'un rollback applicatif annule le schéma. Si une migration rend l'ancienne image incompatible, corriger en avant avec une nouvelle migration et une nouvelle release.

## Sauvegardes

- Exécuter chaque jour un backup PostgreSQL vers un stockage hors VPS.
- Sauvegarder chaque jour `/app/data` hors VPS ; `mc-assets/` reste re-seedable, les données runtime ne le sont pas toutes.
- Documenter la rétention et les alertes avec les valeurs du fournisseur réellement choisi.
- Effectuer régulièrement un exercice de restauration PostgreSQL et `/app/data` dans un environnement isolé, puis consigner durée et résultat.

Garder Ubuntu et Coolify patchés. Un backup n'est considéré fiable qu'après une restauration réussie.
