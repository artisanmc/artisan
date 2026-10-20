# Serveurs égaux sur une même base : un réseau sans hub désigné

**Statut :** proposé (2026-10-20). Suite de `editor-web-server` et `editor-tunnel`.

## Contexte

Un réseau a un hub (`web.hub` vide) et des feuilles (`web.hub` renseigné) reliées à
son `/ws/plugin`. Il faut donc configurer chaque feuille, garder un chemin réseau feuille → hub,
et le hub est le seul accès à l'éditeur : s'il tombe, plus personne n'édite. Avec le tunnel par
défaut (`editor-tunnel`), chaque serveur a déjà son propre lien `https://<id>.artisanmc.app`, et
les serveurs d'un réseau partagent déjà une base MySQL/MariaDB (`server-identity-and-versions`).

## Décisions

1. **La base partagée fait le réseau.** Deux serveurs sur la même base (même `database_id`) sont
   pairs ; aucun `web.hub`. Chaque serveur qui sert son éditeur annonce dans `artisan_servers`
   où répond son `/ws/plugin` : `editor_url` (son adresse publique, tunnel ou `web.url`) et
   `internal_url` (`ws://<web.bind ou adresse de la machine>:<port>/ws/plugin`).
2. **Chacun est hub pour son lien, feuille pour les autres.** Toutes les 30 s, un serveur relit
   les pairs en marche vus depuis moins de 3 minutes (`ServerRegistry.peers`) et rejoint chacun
   comme une feuille, avec le protocole `/ws/plugin` existant : d'abord l'adresse interne, puis
   l'adresse publique (`HubLink.alternates`). Depuis n'importe quel lien on voit et publie sur
   tous les serveurs ; un serveur arrêté ne coupe que son propre lien.
3. **Le secret vient de la base.** `network_secret` dans `artisan_meta`, généré par le premier
   serveur qui le demande. Qui lit la base contrôle déjà le réseau ; le secret écarte seulement
   les inconnus de `/ws/plugin`. Le hub l'accepte en plus de son secret configuré.
4. **Les réponses reviennent à qui a demandé.** Un serveur garde l'origine de chaque requête
   (`request_id`) et y répond ; ses annonces (`modules_changed`, `projects_reloaded`…) vont à
   tous ses hubs. Un pair ne lui impose pas le pack qu'il a en mémoire à la connexion : seul un
   `resource_pack_updated` le change, téléchargé chez le pair qui l'envoie.
5. **Le hub configuré reste.** `web.hub` garde son sens (feuille d'un hub choisi) ; une feuille
   n'a pas de lien propre et ne s'annonce pas comme pair. H2 n'a pas de pairs.

## Conséquences

- Aucun port à ouvrir : tunnel sortant, connexion sortante vers le tunnel du pair, base sortante.
- N serveurs font N×(N-1) liens. Négligeable jusqu'à une vingtaine ; non mesuré au-delà.
- Pas de présence entre liens : un admin sur A ne voit pas en direct celui qui édite sur B. Le
  compare-and-swap de publication refuse le second publish au lieu d'écraser.
- Chaque lien sert son propre éditeur : des serveurs de versions différentes montrent chacun le
  leur, comme un hub face à des feuilles d'autres versions aujourd'hui.
- Une adresse interne fausse (machines différentes) est essayée puis abandonnée pour l'adresse
  publique ; une adresse qui répond mais mène à un autre serveur est refusée par `/ws/plugin`
  (server id, `database_id`, secret).
