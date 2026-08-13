# Invariants critiques

Règles qu'on ne peut pas casser sans casser l'édition plugin ↔ backend ↔ éditeur.
Chaque entrée dit **quoi**, **pourquoi**, et **ce qui la verrouille** (test / vecteur de conformance).

Résumé exécutable dans `CLAUDE.md` § Invariants — ce fichier est le détail.

---

## Le contenu d'un Project vit sur le disque du serveur, et nulle part ailleurs

ADR `server-disk-only-storage` (2026-08-13). Le backend ne stocke **aucun** contenu de Project :
ni `filesJson`, ni commits, ni branches. Ce qu'il garde d'un Project, c'est son **identité** (nom,
slug, serveur propriétaire, network) — de quoi le lister et le router dans l'éditeur.

- **Lecture** : `project_read` → l'arbre complet, relPath-keyed, lu à la demande sur le disque.
- **Écriture** : `project_write`, sur **geste explicite** de l'admin. Le **plugin est le seul
  écrivain** — le backend relaie, il n'arbitre jamais (il n'a aucune copie avec quoi arbitrer).
- **Serveur hors ligne** = Project inouvrable. Pas de repli sur une copie périmée : il n'y en a
  pas, et en inventer une ferait éditer un état qui n'existe nulle part.

Corollaire : il n'existe plus de divergence disque↔backend, donc plus de `detectSyncAction`, plus
de `sync_divergence`, plus de `bundle_available`. Le `SyncScanner` subsiste, mais **uniquement**
pour recharger à chaud une édition faite à la main ou par un agent : il ne décide plus de rien.

## Compare-and-swap par fichier, tout ou rien

Chaque entrée d'un `project_write` porte le `base_hash` du contenu que l'éditeur avait chargé
(`null` = « je m'attends à ce qu'il n'y ait pas de fichier ici », ce qui couvre d'un seul mécanisme
le fichier neuf et le fichier disparu).

- Un seul fichier périmé **annule l'écriture entière**. Une écriture à moitié appliquée laisserait
  un Project incohérent *en ligne*, et l'éditeur ne saurait plus de quel état repartir.
- Les conflits remontent **avec le contenu disque attaché** : l'éditeur affiche le diff sans second
  aller-retour.
- Un fichier réellement contesté **exige un choix explicite**, des deux côtés (plugin et éditeur).
  Un défaut silencieux sur une donnée contestée, c'est de la perte de données déguisée en ergonomie.

**Verrouillé par** `ProjectWriteChannelTest` (plugin) et `diskSave` / `resolveConflicts` (éditeur).

## Corbeille `.artisan/history/` — anneau par fichier

Avant tout écrasement ou suppression, le plugin recopie l'ancien contenu dans
`.artisan/history/<relPath>/<ms>`, en anneau des 20 dernières versions par fichier. Le nom est un
millis sur 13 chiffres : l'ordre lexicographique **est** l'ordre chronologique, donc la purge n'a
pas à parser de dates.

Un échec d'archivage **n'empêche pas** l'écriture : perdre le filet est regrettable, perdre
l'enregistrement de l'admin le serait plus.

C'est une corbeille **par fichier**, pas un point de restauration du Project entier. « Remets ce
menu comme il était » marche ; « remets tout le Project à hier soir » non — et c'est assumé.

## Exclusion `.artisan*` universelle (2026-07-23)

Tout relPath dont le **premier segment** commence par `.artisan` est une métadonnée : hors hash,
invisible au scan de contenu.

Une nuance est apparue avec la bascule disque-seul : l'éditeur **possède**
`.artisan/editor.yaml` (layout du board, `i18n_mode`) et doit pouvoir l'écrire. La règle de
`project_read` / `project_write` est donc plus fine que l'exclusion hash — et symétrique : **ce que
l'éditeur ne voit pas en lecture, il ne peut pas l'écrire**. Restent invisibles et interdits :
`.artisan/history/` (corbeille), `.artisan-trash/`, `.artisan-sync.yaml`.

## Le hash n'est plus un invariant inter-langage

Il l'a été : `BundleHasher` (plugin) et `hashUtils.computeBundleHash` (backend) devaient produire
le même hash d'arbre au byte près, sous peine d'inventer des divergences, et un vecteur partagé
(`testdata/project-hash-conformance.json`) le verrouillait. Le backend ne calcule plus rien : le
vecteur et son implémentation backend ont disparu.

Restent deux usages, tous deux locaux : le hash d'arbre (`BundleHasher.hash`) pour la détection de
changement du scanner, et `hashContent` — un **contenu de fichier**, jeton du compare-and-swap,
reproduit côté éditeur par `lib/contentHash.ts` (SHA-256 UTF-8, hex minuscule).

## OkHttp — pas d'I/O bloquant dans le callback WS

`SyncedMenuProvider.handleMessage` est appelé sur le thread WS callback d'OkHttp. Les lectures et
écritures de `project_read` / `project_write` sont dispatchées sur
`httpClient.dispatcher.executorService`. Ne jamais faire d'I/O bloquant dans le callback WS
directement.

## Reload atomique

`reloadFromDisk()` construit un nouveau `ConcurrentHashMap` **entier**, puis l'assigne à
`@Volatile var menus`. Ne jamais modifier le map en place.

## Détection = contenu, jamais événement

Spec `2026-07-30-poll-first-disk-sync-design`. `SyncScanner` remplace l'ancien `ProjectWatcher`
inotify, dont la correction dépendait d'événements OS jamais délivrés sur bind mount Docker / NFS /
SMB. Il ne sert plus qu'au hot-reload, mais la règle tient toujours : **aucun chemin de correction
ne dépend d'un événement de système de fichiers.**

Le tick fait : court-circuit `stat` (signature chemins/tailles/mtimes), quiescence sur 2 ticks
consécutifs avant dispatch (un upload FTP en cours n'est jamais rechargé à moitié), et un deep tick
tous les 10 ticks = vrai hash de contenu, filet pour les FS à granularité mtime grossière.

Le comportement est **identique en dev Docker et en prod Linux** — c'est le gain principal.

## DELETE project = soft-delete

`DELETE /api/v1/user/projects/:projectId` (cookie auth + membership) marque `deletedAt`
(`softDeleteProject`, la ligne reste en DB) et broadcast `project_deleted` au plugin (qui
move-to-trash) et aux autres connexions éditeur.

## `.artisan-trash/` is sacred

Répertoire au top de `projectsDir`, créé par `ProjectDeleter`. Ne jamais utiliser ce nom pour autre
chose.

## Custom items — hash inline

`CustomItemsManager.buildBundle()` calcule le hash **en inline** à partir des items / textures déjà
collectés (ne rappelle pas `computeHash()` séparément) pour garantir la cohérence hash ↔ data.
