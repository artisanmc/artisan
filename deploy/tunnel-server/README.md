# Serveur de tunnel de l'éditeur

Prototype (ADR `editor-tunnel`). Un plugin Artisan avec `web.tunnel` ouvre un WebSocket sortant
vers ce serveur et reçoit l'adresse `https://<id>.<domaine>` ; chaque requête du navigateur vers
cette adresse est passée telle quelle au plugin. Le serveur ne stocke rien.

## Domaine et certificat

Chaque serveur Minecraft a son sous-domaine, il faut donc un certificat **générique** `*.<domaine>`.
Le certificat universel gratuit de Cloudflare ne couvre qu'un niveau sous la zone :
`*.artisanmc.net` oui, `*.tunnel.artisanmc.net` non (il faut alors Advanced Certificate Manager,
payant). D'où le choix recommandé : **un domaine dédié** (ex. `artisan-tunnel.net`), qui sépare
aussi la réputation du site si un tunnel sert à de l'abus. `TUNNEL_DOMAIN` = ce domaine.

## Déploiement sur le VPS (Coolify + Cloudflare Tunnel)

1. Ajouter le domaine dédié à Cloudflare.
2. Coolify : ressource Docker Compose depuis ce dépôt, fichier `deploy/tunnel-server/docker-compose.yml`,
   variables `TUNNEL_DOMAIN=<domaine>` et, pour un essai privé, `TUNNEL_ACCESS_CODE=<code>`.
3. Tunnel Cloudflare existant : deux hostnames publics vers `http://tunnel-server:8080`
   (ou l'adresse que Coolify donne au service) : `<domaine>` et `*.<domaine>`. L'enregistrement
   DNS générique `*` en CNAME vers le tunnel se crée à la main s'il n'est pas créé seul.
4. Vérifier : `curl https://<domaine>/health` répond `ok`.

Cloudflare transmet les WebSockets et garde l'en-tête `Host` ; il coupe un WebSocket inactif après
100 s, le plugin envoie un ping toutes les 25 s. Corps limités à 100 Mo sur les offres Free et Pro,
comme le pack du hub.

## Côté serveur Minecraft

```yaml
# plugins/Artisan/environment.yml
web:
  bind: "127.0.0.1"
  tunnel: "<domaine>"
  tunnel-access: "<code>"
```

Au redémarrage, la console écrit `Editor reachable through the tunnel server at https://<id>.<domaine>`,
et `/artisan editor` donne un lien vers cette adresse. Un code refusé s'écrit aussi dans la console.

## Variables

| Variable | Défaut | Rôle |
|---|---|---|
| `TUNNEL_DOMAIN` | requis | Domaine des tunnels ; le serveur répond aussi `/health` dessus. |
| `TUNNEL_PORT` | `8080` | Port HTTP local (derrière le proxy TLS). |
| `TUNNEL_PUBLIC_SCHEME` | `https` | Schéma des adresses données aux plugins. |
| `TUNNEL_ACCESS_CODE` | vide | Code exigé des plugins ; vide : ouvert à tous. |
| `TUNNEL_MAX_BODY_MB` | `100` | Taille maximale d'une requête du navigateur. |
| `TUNNEL_MAX_STREAMS` | `64` | Requêtes et WebSockets simultanés par tunnel. |
| `TUNNEL_BLOCKED_PATHS` | `/resource-pack/` | Préfixes jamais passés (le pack va aux joueurs en direct). |

## Avant une ouverture publique

Limites de débit et de volume par tunnel, cookie `Secure` derrière le tunnel, page d'abus et
de contact sur le domaine. Voir les conséquences de l'ADR.
