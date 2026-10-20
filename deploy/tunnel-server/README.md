# Serveur de tunnel de l'éditeur

Prototype (ADR `editor-tunnel`). Un plugin Artisan avec `web.tunnel` ouvre un WebSocket sortant
vers ce serveur et reçoit l'adresse `https://<id>.<domaine>` ; chaque requête du navigateur vers
cette adresse est passée telle quelle au plugin. Le serveur ne stocke rien.

## Domaine et certificat

Chaque serveur Minecraft a son sous-domaine, il faut donc un certificat **générique**. Le certificat
universel gratuit de Cloudflare couvre `*.artisanmc.net` (un niveau), pas `*.tunnel.artisanmc.net`.

**Essai privé : `artisanmc.net` directement.** `TUNNEL_DOMAIN=artisanmc.net`, les tunnels répondent
sur `https://<id>.artisanmc.net` (16 caractères aléatoires) et les plugins se connectent sur
`connect.artisanmc.net`. Les enregistrements DNS explicites (`artisanmc.net`, `repo`, `coolify`)
gardent la priorité sur le générique : rien ne change pour eux.

**Ouverture publique : un domaine dédié.** Une page servie par un tunnel partage alors le domaine du
site : un abus (hameçonnage) toucherait la réputation d'`artisanmc.net`, et une page de tunnel peut
poser des cookies sur `.artisanmc.net`. Garder `TUNNEL_ACCESS_CODE` tant que le domaine est partagé.

## Déploiement sur le VPS (Coolify + Cloudflare Tunnel)

1. Coolify : ressource Docker Compose depuis ce dépôt, fichier `deploy/tunnel-server/docker-compose.yml`,
   variables `TUNNEL_DOMAIN=artisanmc.net` et `TUNNEL_ACCESS_CODE=<code>`.
2. Tunnel Cloudflare existant : un hostname public `*.artisanmc.net` vers le service du conteneur
   (port 8080). DNS : un CNAME `*` vers `<id-du-tunnel>.cfargotunnel.com`, proxifié, s'il n'est pas
   créé seul.
3. Vérifier : `curl https://connect.artisanmc.net/health` répond `ok`.

Cloudflare transmet les WebSockets et garde l'en-tête `Host` ; il coupe un WebSocket inactif après
100 s, le plugin envoie un ping toutes les 25 s. Corps limités à 100 Mo sur les offres Free et Pro,
comme le pack du hub.

## Côté serveur Minecraft

```yaml
# plugins/Artisan/environment.yml
web:
  bind: "127.0.0.1"
  tunnel: "connect.artisanmc.net"
  tunnel-access: "<code>"
```

Au redémarrage, la console écrit `Editor reachable through the tunnel server at https://<id>.artisanmc.net`,
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
| `TUNNEL_BLOCKED_PATHS` | `/resource-pack/` | Préfixes jamais passés (le pack va aux joueurs en direct). |
| `TUNNEL_REQUESTS_PER_MINUTE` | `600` | Requêtes du navigateur par tunnel et par minute (429 au-delà) ; 0 : sans limite. |
| `TUNNEL_BANDWIDTH_KBPS` | `2048` | Débit par tunnel, deux sens confondus, en Kio/s : ralenti, jamais coupé ; 0 : sans limite. |
| `TUNNEL_DAILY_MB` | `2048` | Volume par tunnel et par jour UTC (429 au-delà) ; 0 : sans limite. |
| `TUNNEL_PER_ADDRESS` | `3` | Tunnels ouverts en même temps depuis une même adresse ; 0 : sans limite. |
| `TUNNEL_CLIENT_IP_HEADER` | vide | En-tête de l'adresse du client posé par le proxy TLS : `CF-Connecting-IP` derrière Cloudflare. Jamais sans un tel proxy (falsifiable). |

## Avant une ouverture publique

Faits : limites par tunnel (variables ci-dessus) et cookie `__Host-` derrière le tunnel. Restent :
un domaine dédié (voir plus haut), une page d'abus et de contact sur le domaine, et
`TUNNEL_ACCESS_CODE` vide.
