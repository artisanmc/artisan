# Identité des serveurs et des projets, Versions et brouillons dans la base de la suite

**Status :** accepted (2026-10-13). Rien n'est implémenté. Révise
[editor-web-server](editor-web-server.md) (« Versions (vides) », brouillons sur disque) et
[suite-foundation-database](suite-foundation-database.md) (réseau toléré en H2).

## Contexte

Avec la phase F, le backend cloud et ses Versions ont disparu
([snapshot-mirror-and-backend-history](snapshot-mirror-and-backend-history.md)) : le hub
renvoie une liste de Versions vide, `.artisan/history/` n'est plus alimenté, et rien
n'enregistre qui a publié quoi. Le hub ne garde ses serveurs qu'en mémoire : un serveur
éteint pendant un redémarrage du hub disparaît de l'éditeur, et ses projets répondent
`503 server_offline`. Un serveur n'est identifié que par son nom, un projet que par son
dossier : un renommage casse tout ce qui s'y rattache. La suite va stocker des données
liées à un serveur (lieux de MSCore, analytics), comme Plan le fait avec une table de
serveurs et un fichier d'UUID.

## Décisions

1. **Une Version par Snapshot qui diffère du précédent.** Une publication depuis
   l'éditeur donne une Version signée par le joueur ; une édition à la main chargée
   au démarrage ou par `/artisan reload` donne une Version sans auteur, marquée « modifié
   sur le disque ». Un reload sans changement n'enregistre rien.
2. **Contenus adressés par hash en base, texte et binaires.** Une Version porte un
   manifeste chemin → hash ; chaque contenu, texte ou binaire, est stocké une fois dans une
   table de contenus partagée par Versions et brouillons, quel que soit le nombre de
   Versions qui le référencent. Le disque reste l'autorité de ce que le serveur exécute ;
   la base en garde une copie durable, alimentée à chaque Snapshot par les seuls hashes
   nouveaux. Le hub sert ainsi les assets de n'importe quel serveur sans relais WebSocket,
   serveur éteint compris. Modèle repris du backend (`project_versions` + `snapshot_blobs`,
   migration 0058), étendu aux binaires comme le cache d'assets du backend
   ([assets-on-server-disk](assets-on-server-disk.md)), mais durable.
3. **Réseau = MySQL ou MariaDB.** Dès qu'un serveur se relie à un hub, la base de la suite
   est partagée : un serveur relié en H2 refuse de démarrer son lien, un hub en H2 refuse
   les serveurs qui se relient. Une ligne `artisan_meta` porte un identifiant de base
   généré une fois ; chaque serveur l'annonce au hub, qui refuse une base différente.
   Chaque serveur écrit ses propres Versions. Changer de hub ne déplace aucune donnée. Un
   serveur seul garde H2.
4. **Server id.** Un UUID généré au premier démarrage dans `plugins/Artisan/server-id`
   identifie le serveur ; `artisan_servers (id, uuid UNIQUE, name UNIQUE, last_seen, …)`
   est mis à jour au démarrage et les autres tables référencent `artisan_servers.id`. Le
   `name` (le nom Velocity) est un attribut : un serveur renommé, y compris quand son nom
   par défaut change avec son dossier, garde sa ligne.
5. **`server-id` copié.** Chaque serveur rafraîchit `last_seen` chaque minute. Au
   démarrage, une ligne de même UUID sous un autre nom vue il y a moins de deux minutes
   signale une copie : refus, avec le nom du serveur en cours et la marche à suivre
   (supprimer `server-id`). Sinon c'est un renommage, journalisé.
6. **Les binaires d'une ancienne Version sont en base** (décision 2) : une Version se
   restaure entière, même après une suppression à la main. Aucun stockage sur le disque.
7. **Rétention illimitée** pour commencer, sans purge.
8. **Restaurer charge une Version dans un brouillon**, publié ensuite normalement : la
   publication reste l'unique chemin d'écriture. Un bouton « Restaurer et publier »
   enchaîne les deux. La Version créée note la Version restaurée.
9. **Auteur = UUID du joueur + pseudo au moment de la publication**, recopié dans la
   Version.
10. **Migrations de schéma maison, forward-only**, sur le modèle de MSQuests : migrations
    numérotées, table `artisan_schema_version`. Chaque migration reçoit la connexion de
    la transaction ; une instruction DDL idempotente par migration (MySQL auto-commite
    le DDL) ; `GET_LOCK('artisan_schema')` autour de l'application en MySQL/MariaDB.
11. **Passage de H2 à MySQL.** Au premier démarrage sur MySQL, Artisan importe ses propres
    tables depuis le fichier H2 de la suite, en réattribuant les id par UUID. Rien n'est
    importé si MySQL a déjà des Versions pour ce server id ; le fichier H2, partagé avec
    les autres plugins, n'est ni renommé ni supprimé. Les autres plugins migrent leurs
    tables eux-mêmes.
12. **Brouillons en base, édition serveur éteint.** Un brouillon référence la même table
    de contenus (texte et binaires ajoutés). Un projet d'un serveur éteint s'ouvre depuis
    sa dernière Version, assets compris, et son brouillon reste éditable ; publier, les
    données live et la capture en jeu attendent le serveur. La publication garde son compare-and-swap sur
    les fichiers ; le brouillon est marqué publié ensuite, et une publication interrompue
    se résout au démarrage par les reçus de `.artisan/transactions/`.
13. **Aucun import des brouillons de `.artisan/drafts/`** : seul un serveur de dev en a.
14. **Project id.** Un UUID généré une fois dans `.artisan/editor.yaml` identifie un
    projet ; Versions et brouillons le référencent, un dossier renommé (éditeur ou main)
    les garde. Un dossier copié qui arrive avec un id déjà présent sur le même serveur en
    reçoit un nouveau, avec un avertissement. Un projet d'Add-on garde l'identité de son
    manifeste.

Les données futures liées à un serveur (lieux, analytics) vivent dans leurs propres
tables, possédées par leur module, qui référencent `artisan_servers.id` ;
`artisan_servers` reste un pivot étroit.

## Options rejetées

- **Binaires seulement sur le disque** (copie dans `.artisan/blobs/` au remplacement) :
  chaque aperçu d'un serveur relié traverse le WebSocket, un serveur éteint n'a plus
  d'assets, un binaire supprimé à la main est perdu pour l'historique. Le poids en base
  craint au départ n'existe pas : adressé par hash, chaque asset n'est stocké qu'une fois.
- **Tout sur le disque** : pas d'historique d'un serveur éteint, pas de vue réseau.
- **Le hub écrit toutes les Versions dans sa base** : marche en H2, mais l'historique de
  tout le réseau vit sur la machine du hub ; en changer ou la perdre perd tout.
- **Nom comme identité, renommage par commande** : un `name` édité à la main ou un nom de
  dossier qui change crée en silence un nouveau serveur et orpheline ses données.
- **Flyway** : plusieurs centaines de Ko à embarquer et relocaliser pour trois tables.

## Conséquences

- Un serveur seul qui passe en réseau doit installer MySQL ou MariaDB ; c'est désormais
  une erreur au démarrage, plus un avertissement.
- Les sauvegardes de la base portent la valeur utilisateur (historique, travail en
  cours), plus seulement les données de jeu.
- L'éditeur doit ouvrir un projet sans son serveur : canvas depuis la base, sans données
  live.
- La base porte une copie de chaque asset jamais chargé : quelques Mo à quelques dizaines
  de Mo par projet, croissant avec les assets distincts, pas avec les Versions.
- `SLocation` de MSCore garde le nom en clair : Velocity route par nom. MSCore pourra lire
  ce nom depuis `artisan_servers` via l'API au lieu de sa clé `servername`.
