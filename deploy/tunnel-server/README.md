# Serveur de tunnel de l'éditeur

Prototype (ADR `editor-tunnel`). Un plugin Artisan avec `web.tunnel` ouvre un WebSocket sortant
vers ce serveur et reçoit l'adresse `https://<id>.<domaine>` ; chaque requête du navigateur vers
cette adresse est passée telle quelle au plugin. Le serveur ne stocke rien.

## Domaine et certificat

Les tunnels vivent sur un domaine **dédié**, `artisanmc.app`, jamais sur `artisanmc.net` : une page
servie par un tunnel est choisie par le serveur Minecraft, pas par Artisan. Sur un domaine à part, un
abus (hameçonnage) ne touche pas la réputation du site et du wiki, et une page de tunnel ne peut pas
poser de cookies sur `.artisanmc.net`. C'est le schéma de `github.io`, `vercel.app` ou
`cloudflareaccess.com`.

Chaque serveur Minecraft a son sous-domaine, il faut donc un certificat **générique** : le certificat
universel gratuit de Cloudflare couvre `*.artisanmc.app` (un niveau). Les tunnels répondent sur
`https://<id>.artisanmc.app` et les plugins se connectent sur `connect.artisanmc.app`. `.app` impose
HTTPS (HSTS préchargé), ce que Cloudflare fournit.

## Déploiement sur le VPS (Coolify + Cloudflare Tunnel)

1. Cloudflare : ajouter la zone `artisanmc.app` (nameservers chez le registraire), SSL/TLS en « Full ».
2. Coolify : ressource Docker Compose depuis ce dépôt, **Base Directory** `/deploy/tunnel-server` et
   **Docker Compose Location** `/docker-compose.yml`. Avec une base à `/`, Coolify résout le
   `context: ../..` depuis la racine du dépôt et le build échoue. Aucun domaine sur le service, et
   cocher « Connect To Predefined Network » pour que le conteneur rejoigne le réseau `coolify`.
   Variable `TUNNEL_DOMAIN=artisanmc.app` : Coolify la pré-remplit avec le message d'erreur du
   compose, il faut la remplacer. `TUNNEL_ACCESS_CODE` reste vide : le tunnel est ouvert à tous.
3. Tunnel Cloudflare existant : une route (« Published application route », ex-« Public Hostname »)
   `*.artisanmc.app` vers le conteneur, et une seconde `artisanmc.app` si la racine doit répondre.
   - `cloudflared` installé sur la machine (cas courant) : `http://localhost:18080`. Le compose
     publie le port sur `127.0.0.1` seulement, rien n'est ouvert vers l'extérieur.
   - `cloudflared` en conteneur sur le réseau `coolify` : `http://tunnel-server:8080`, le nom du
     service, stable d'un déploiement à l'autre (le nom du conteneur change à chaque fois).

   DNS : un CNAME `*` vers `<id-du-tunnel>.cfargotunnel.com`, proxifié, s'il n'est pas créé seul.
   Un 502 de Cloudflare sur `/health` veut dire que `cloudflared` ne joint pas l'URL de la route.
4. Vérifier : `curl https://connect.artisanmc.app/health` répond `ok`.

Cloudflare transmet les WebSockets et garde l'en-tête `Host` ; il coupe un WebSocket inactif après
100 s, le plugin envoie un ping toutes les 25 s. Corps limités à 100 Mo sur les offres Free et Pro,
comme le pack du hub.

## Côté serveur Minecraft

```yaml
# plugins/Artisan/environment.yml
web:
  tunnel: "connect.artisanmc.app"   # la valeur par défaut, sans web.url
```

Une feuille sans port vers son hub vise l'adresse du tunnel du hub :
`web.hub: "https://<id>.artisanmc.app"`.

Au redémarrage, la console écrit `Editor reachable through the tunnel server at https://<id>.artisanmc.app`,
et `/artisan editor` donne un lien vers cette adresse. Un code refusé s'écrit aussi dans la console.

## Variables

| Variable | Défaut | Rôle |
|---|---|---|
| `TUNNEL_DOMAIN` | requis | Domaine des tunnels. Les plugins se connectent sur `/tunnel` de tout nom qui n'est pas un tunnel connecté (le domaine, ou `connect.<domaine>`). |
| `TUNNEL_PORT` | `8080` | Port HTTP local (derrière le proxy TLS). |
| `TUNNEL_PUBLIC_SCHEME` | `https` | Schéma des adresses données aux plugins. |
| `TUNNEL_ACCESS_CODE` | vide | Code exigé des plugins ; vide : ouvert à tous. |
| `TUNNEL_MAX_BODY_MB` | `100` | Taille maximale d'une requête du navigateur. |
| `TUNNEL_MAX_STREAMS` | `64` | Requêtes et WebSockets simultanés par tunnel. |
| `TUNNEL_BLOCKED_PATHS` | vide | Préfixes de chemin jamais passés, séparés par des virgules. |
| `TUNNEL_REQUESTS_PER_MINUTE` | `600` | Requêtes du navigateur par tunnel et par minute (429 au-delà) ; 0 : sans limite. |
| `TUNNEL_BANDWIDTH_KBPS` | `2048` | Débit par tunnel, deux sens confondus, en Kio/s : ralenti, jamais coupé ; 0 : sans limite. |
| `TUNNEL_DAILY_MB` | `2048` | Volume par tunnel et par jour UTC (429 au-delà) ; 0 : sans limite. |
| `TUNNEL_PER_ADDRESS` | `3` | Tunnels ouverts en même temps depuis une même adresse ; 0 : sans limite. |
| `TUNNEL_CLIENT_IP_HEADER` | vide | En-tête de l'adresse du client posé par le proxy TLS : `CF-Connecting-IP` derrière Cloudflare. Jamais sans un tel proxy (falsifiable). |

## Avant une ouverture publique

Faits : limites par tunnel (variables ci-dessus) et cookie `__Host-` derrière le tunnel. Reste :
une page d'abus et de contact sur le domaine.
