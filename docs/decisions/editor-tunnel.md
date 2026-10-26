# Le tunnel de l'éditeur : un serveur sans port ouvert

**Statut :** proposé (2026-10-20), prototype. Suite de `editor-web-server`.

## Contexte

Le hub sert l'éditeur sur `web.port`. Beaucoup d'hébergeurs ne donnent qu'un port, ou le font
payer, et sans HTTPS le navigateur n'expose pas `crypto.subtle`. Un éditeur hébergé en cloud
réglerait l'accès, mais rouvrirait ce que l'auto-hébergement a fermé : un éditeur d'une
version face aux moteurs de toutes les versions installées (`content-version-negotiation`),
du stockage, des comptes. Analyse : `cloud-ou-auto-hebergement.md` (fichiers du projet).

## Décisions

1. **Le tunnel par défaut, rien de plus.** Sans `web.url`, le hub ouvre un WebSocket **sortant**
   vers `/tunnel` sur `web.tunnel` (défaut `connect.artisanmc.app`, `""` pour s'en passer), qui
   lui donne une adresse `https://<id>.artisanmc.app`. Aucun port à ouvrir pour une installation
   sans configuration. Chaque requête HTTP et chaque WebSocket du navigateur
   passent par ce WebSocket et sont rejoués tels quels sur le port web local du hub
   (`TunnelClient`, module `hub`). Une feuille ignore `web.tunnel`.
2. **Le serveur de tunnel ne comprend rien.** Il ne sert pas l'éditeur, ne stocke que les noms
   d'adresse (décision 8) et ne
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
   d'aucune base. Plusieurs connexions du même secret coexistent : la dernière répond, la
   précédente reprend si elle part (serveurs d'un réseau, ADR `peer-servers`).
5. **Les joueurs ne passent jamais par le tunnel.** Ils reçoivent le pack d'un plugin de pack
   (Nexo, Oraxen, ItemsAdder), jamais du serveur web de l'éditeur : la bande passante croît avec
   les sessions d'édition et les mises à jour du pack, jamais avec les connexions de joueurs.
   Rien n'est bloqué par défaut (`TUNNEL_BLOCKED_PATHS` reste disponible).
6. **Une feuille sans port joint son hub par le tunnel.** `web.hub: "https://<id>.artisanmc.app"` :
   `/ws/plugin` et le téléchargement du pack passent par le tunnel du hub, aucun des deux
   serveurs n'écoute. Le réseau reste porté par le hub et la base de la suite ; le serveur de
   tunnel ne connaît pas les réseaux.
7. **Serveur privé possible.** `TUNNEL_ACCESS_CODE` côté serveur, `web.tunnel-access` côté plugin :
   un code refusé ferme le tunnel avec la raison (code 4003), que le plugin écrit dans sa console.
8. **Un nom pour l'adresse** (2026-10-21). Le serveur de tunnel garde, dans un fichier JSON
   (`NameRegistry`, `TUNNEL_NAMES_FILE`), des noms que des adresses ont pris :
   `survie.artisanmc.app` répond comme `<id>.artisanmc.app`, qui reste valable. Un admin le
   choisit dans les réglages de l'éditeur ; le plugin le demande par sa connexion de tunnel
   (trames `NAME`/`NAME_RESULT`), déjà signée de son secret : aucune page ni aucun compte à part
   pour prouver qui détient l'adresse. Le serveur de tunnel renvoie `HELLO` à chaque tunnel de
   l'adresse avec le nouveau nom, donc à tous les serveurs d'un réseau ; la base du plugin ne
   garde rien. Un nom par adresse, premier arrivé premier servi, rendu après 90 jours sans
   connexion, au plus 3 changements par adresse et 10 par IP de plugin et par jour. Refusés :
   les noms du serveur de tunnel et du projet, ceux qui contiennent une marque où l'on se
   connecte ou un mot d'hameçonnage, et ceux qui ont la forme d'un `<id>`. Chaque nom pris part
   à un webhook Discord (`TUNNEL_NAMES_WEBHOOK`) ; `/admin/names` (jeton `TUNNEL_ADMIN_TOKEN`)
   libère ou bannit un nom. La session reste sur l'ancienne adresse (cookie `__Host-`) : le hub
   rend un lien de connexion pour la nouvelle (`Sessions.handOff`).
9. **Serveur autonome** dans le dépôt (`plugin/tunnel-server`, Jetty, `deploy/tunnel-server/`), déployé
   comme un conteneur derrière un proxy TLS qui couvre `*.<domaine>`.
10. **Un relais près du serveur Minecraft** (2026-10-26). Un seul serveur de tunnel en France
    fait faire deux fois la distance à un admin et un serveur loin de la France (Vietnam : ~400-500 ms
    par requête). Le même fil est servi par un Cloudflare Worker (`deploy/tunnel-worker/`) : un Durable
    Object par adresse, créé près du premier plugin qui s'y connecte, les noms dans un Durable Object
    unique et lus depuis KV. Le plugin ne change pas, les adresses non plus. Le serveur Kotlin reste la
    référence et le secours : route en « fail open » et requêtes rejouées sur l'origine quand le Worker
    ne peut pas servir. En production sur `*.artisanmc.app` depuis le 2026-10-26 (route retirable pour
    revenir au serveur Kotlin), essai sur `*-test.artisanmc.app`. Étude : `tunnel-latence-regions-2026-10-26.md` (fichiers du projet).

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
- Un nom lisible rend l'hameçonnage plus crédible qu'un `<id>` : d'où le filtre de mots, le
  webhook et la révocation. Une adresse `<id>` ne se coupe pas encore ; à faire avant une
  ouverture large, avec une page d'abus.
- Le fichier des noms est le seul état du serveur de tunnel : il vit sur un volume
  (`tunnel-data`). Le perdre rend tous les noms, les adresses `<id>` restent.
