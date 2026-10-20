# Le tunnel de l'éditeur : un serveur sans port ouvert

**Statut :** proposé (2026-10-20), prototype. Suite de `editor-web-server`.

## Contexte

Le hub sert l'éditeur sur `web.port`. Beaucoup d'hébergeurs ne donnent qu'un port, ou le font
payer, et sans HTTPS le navigateur n'expose pas `crypto.subtle`. Un éditeur hébergé en cloud
réglerait l'accès, mais rouvrirait ce que l'auto-hébergement a fermé : un éditeur d'une
version face aux moteurs de toutes les versions installées (`content-version-negotiation`),
du stockage, des comptes. Analyse : `cloud-ou-auto-hebergement.md` (fichiers du projet).

## Décisions

1. **Un tunnel opt-in, rien de plus.** `web.tunnel: "tunnel.example.net"` sur le hub : le plugin
   ouvre un WebSocket **sortant** vers `/tunnel` sur ce serveur, qui lui donne une adresse
   `https://<id>.tunnel.example.net`. Chaque requête HTTP et chaque WebSocket du navigateur
   passent par ce WebSocket et sont rejoués tels quels sur le port web local du hub
   (`TunnelClient`, module `hub`). Une feuille ignore `web.tunnel`.
2. **Le serveur de tunnel ne comprend rien.** Il ne sert pas l'éditeur, ne stocke rien et ne
   lit ni le protocole de l'éditeur ni ses formats. Il passe les en-têtes du navigateur,
   `Host` et `Origin` compris : le contrôle de même origine et les cookies du hub
   s'appliquent sans changement. L'éditeur servi reste celui du jar : aucun nouvel axe de
   version entre l'éditeur et le moteur. Seul le fil du tunnel est versionné
   (`X-Artisan-Tunnel-Version`, majeure différente = refus).
3. **Fil binaire minimal** (`plugin/tunnel`, `Frame`) : `[type][flux][charge]`, un flux par
   requête ou par WebSocket du navigateur, corps découpés en morceaux de 256 Kio. Le corps
   d'une requête est gardé en entier côté plugin avant d'être rejoué (100 Mio au plus, la
   limite du pack du hub) ; la réponse revient en flux.
4. **L'identité vient d'un secret.** Le plugin génère `plugins/Artisan/tunnel-secret` une fois ;
   `<id>` en est dérivé (SHA-256, base32, 16 caractères). L'adresse est stable d'un redémarrage
   à l'autre, personne ne peut la prendre sans le secret, et le serveur de tunnel n'a besoin
   d'aucune base. Une nouvelle connexion du même secret remplace l'ancienne.
5. **Le pack ne passe jamais par le tunnel.** Le serveur refuse `/resource-pack/` (403) et le
   hub donne aux joueurs l'adresse directe (`web.url`, sinon IP et port) : sa bande passante
   croît avec les sessions d'édition, jamais avec les connexions de joueurs.
6. **Serveur privé possible.** `TUNNEL_ACCESS_CODE` côté serveur, `web.tunnel-access` côté plugin :
   un code refusé ferme le tunnel avec la raison (code 4003), que le plugin écrit dans sa console.
7. **Serveur autonome** dans le dépôt (`plugin/tunnel-server`, Jetty, `deploy/tunnel-server/`), déployé
   comme un conteneur derrière un proxy TLS qui couvre `*.<domaine>`.

*Rejeté :* éditeur hébergé appelant le plugin (contenu mixte HTTPS → HTTP bloqué, et retour de
l'axe éditeur ↔ moteur) ; hub hébergé (multi-tenant avec état, une version de hub face à toutes
les feuilles) ; stockage en ligne et récupération par commande, à la NxMenu (comptes, stockage,
éditeur central) ; routage par chemin `/t/<id>/` (tous les serveurs partageraient une origine,
donc leurs cookies).

## Conséquences

- Le serveur de tunnel voit le trafic en clair (TLS terminé chez lui) : cookies de session et
  contenu des projets. À dire aux utilisateurs ; le mode direct reste le défaut.
- Un plugin modifié peut servir n'importe quelle page sous `*.<domaine>`. Avec des identifiants
  aléatoires l'hameçonnage est peu crédible. Les tunnels vivent donc sur un domaine dédié,
  `artisanmc.app`, séparé du site `artisanmc.net` : un abus ne touche pas sa réputation et une page
  de tunnel ne peut pas poser de cookies sur le site.
- Limites par tunnel, en mémoire (`TunnelLimits`) : requêtes par minute et volume par jour
  (429 au-delà), débit ralenti, tunnels simultanés par adresse.
- Derrière le tunnel le hub voit `X-Forwarded-Proto: https` et pose `__Host-artisan_session`
  (`Secure`) : une page d'un autre sous-domaine ne peut ni le lire ni l'écraser. Le hub lit ce
  cookie avant `artisan_session`.
- `web.url` garde la priorité : un admin avec son propre proxy n'est pas concerné.
