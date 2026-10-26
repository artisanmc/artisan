# Serveur de tunnel en Cloudflare Worker

Essai (ADR `editor-tunnel`, décision 10). Le même tunnel que `deploy/tunnel-server/`, mêmes trames, mêmes
en-têtes et mêmes adresses, mais servi par Cloudflare au plus près du serveur Minecraft : un plugin
inchangé s'y connecte sans le savoir. Le serveur Kotlin reste la référence, et le secours du Worker.

## Pourquoi

Avec un seul serveur de tunnel en France, une requête fait navigateur → France → serveur Minecraft → France →
navigateur. Pour un admin et un serveur tous deux loin de la France (Vietnam, Amériques), c'est deux fois la
distance pour rien. Ici, chaque adresse est un Durable Object créé près du plugin à sa première connexion ;
le navigateur entre chez Cloudflare près de lui et ne traverse le réseau qu'une fois. Mesure du 2026-10-26,
plugin et « navigateur » aux US-Est : 135 ms médiane par le Worker, 285 ms par le serveur Kotlin en France.

## Comment ça marche

- `src/index.ts` (le Worker) : `/tunnel` sur `connect.<domaine>` vérifie le secret, la version et le code
  d'accès comme `TunnelServer.acceptTunnel`, puis passe la connexion à l'objet de l'adresse. Une requête
  vers `<id>.<domaine>` ou `<nom>.<domaine>` va à l'objet de l'adresse.
- `src/tunnel.ts` (`TunnelObject`, un par adresse) : garde les WebSockets des plugins (API d'hibernation)
  et rejoue chaque requête et chaque WebSocket du navigateur en trames `Frame`. Le dernier plugin connecté
  répond ; `X-Artisan-Tunnel-Member` en choisit un (ADR `peer-servers`).
- `src/names.ts` (`NamesObject`, un seul) : les noms d'adresse, règles de `NameRegistry` (filtre, quotas,
  expiration à 90 jours, bans, webhook Discord). Le Worker lit `name:<nom>` dans KV, jamais l'objet.
- KV `loc:<id>` = `{gen, continent}` : quel objet sert l'adresse. Un plugin qui se connecte depuis un
  autre continent, alors qu'aucun plugin ne tient l'ancien objet, en reçoit un nouveau (`gen + 1`) près de
  lui. L'adresse ne change pas. Les navigateurs le voient sous une minute (cache KV et cache du Worker).
- Une adresse jamais connectée ne crée pas d'objet : c'est le plugin, pas un navigateur, qui choisit où
  elle vit.

## Le serveur Kotlin en secours

Avec `TUNNEL_FALLBACK=origin`, ce que le Worker ne sert pas part vers l'origine de la zone (`cloudflared` →
`tunnel-server` sur le VPS) : une requête d'un Worker vers sa propre route va à l'origine, pas à lui-même.

- Quota du Worker épuisé : la route est en « fail open » (`request_limit_fail_open`), les requêtes vont
  directement à l'origine, et les plugins qui se reconnectent aussi.
- Objet injoignable (quota des Durable Objects) ou adresse sans plugin côté Worker : la requête est
  rejouée sur l'origine. Un corps de plus de 1 Mio ne l'est pas : ce cas a la page hors ligne.
- Origine éteinte (502 ou 530) : la page hors ligne du Worker.

## Limites connues (essai)

- `TUNNEL_PER_ADDRESS` (tunnels par IP, toutes adresses confondues) n'existe pas ici : il demanderait un
  état global. Le débit par tunnel (`TUNNEL_BANDWIDTH_KBPS`) n'est pas ralenti ; requêtes par minute et
  volume par jour le sont, en mémoire de l'objet.
- Une grosse réponse traverse l'objet sans contre-pression : plafonnée par sa mémoire (128 Mo).
- `/admin/names` ne dit pas si une adresse est connectée.

## Lancer en local et tester

```bash
npm ci
npm run dev:test        # http://127.0.0.1:8787, domaine tunnel.test, code d'accès letmein
cd ../../plugin
ARTISAN_TUNNEL_WORKER_URL=http://127.0.0.1:8787 ARTISAN_TUNNEL_WORKER_DOMAIN=tunnel.test \
  ARTISAN_TUNNEL_WORKER_SCHEME=http ARTISAN_TUNNEL_WORKER_ACCESS=letmein \
  ./gradlew :artisan-tunnel-server:test --rerun --tests '*TunnelWorkerTest*'
```

`TunnelWorkerTest` lance un vrai hub et le vrai `TunnelClient` contre le Worker : adresse, règles du hub,
corps de 3 Mio, WebSocket de l'éditeur, page hors ligne, serveurs d'un réseau, noms, et la latence d'une
petite requête. Contre l'essai déployé : `ARTISAN_TUNNEL_WORKER_DOMAIN=artisanmc.app ARTISAN_TUNNEL_WORKER_SUFFIX=-test`.

## Déploiement de l'essai

Compte Cloudflare d'Iban, zone `artisanmc.app` :

- Worker `artisan-tunnel-test`, route `*-test.artisanmc.app/*` en fail open, KV `artisan-tunnel-test`.
- `TUNNEL_LABEL_SUFFIX=-test` : les adresses sont `<id>-test.artisanmc.app` et `connect-test.artisanmc.app`,
  couvertes par le certificat universel (un seul niveau). Le `*` DNS existant vers le tunnel Cloudflare
  sert de route : rien d'autre à créer. La production (`*.artisanmc.app` sans `-test`) n'est pas touchée.
- Un serveur l'essaie avec `web.tunnel: "connect-test.artisanmc.app"` dans `environment.yml`.
- `npm run build` puis `wrangler deploy` (ou l'API Workers) ; secret `TUNNEL_ADMIN_TOKEN`
  (`wrangler secret put`), et `TUNNEL_NAMES_WEBHOOK` pour les noms.

## Production (depuis le 2026-10-26)

- Worker `artisan-tunnel`, route `*.artisanmc.app/*` en fail open, KV `artisan-tunnel`
  (`439f307bdb1f407abd709ac445103228`), `TUNNEL_LABEL_SUFFIX` vide. Le `*` DNS ne change pas. La route de
  l'essai (`*-test.artisanmc.app/*`), plus précise, garde la priorité.
- Les noms du serveur Kotlin ont été repris (`POST https://connect.artisanmc.app/admin/import` avec la sortie de
  son `GET /admin/names`). Le secret `TUNNEL_ADMIN_TOKEN` du Worker est propre au Worker. `TUNNEL_NAMES_WEBHOOK`
  n'est pas encore posé : ajouter le même que sur Coolify pour être prévenu des nouveaux noms.
- Les plugins connectés au serveur Kotlin y restent jusqu'à leur prochaine reconnexion ; d'ici là le Worker
  renvoie leurs requêtes à l'origine. Aucun jar à mettre à jour, aucune adresse ne change.
- Retour arrière : supprimer la route. Tout repart sur le serveur Kotlin, qui reste déployé en secours. Un nom
  pris sur le Worker entre-temps n'y est pas recopié.
