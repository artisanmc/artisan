# Invariants critiques

Règles qu'on ne peut pas casser sans casser la synchro plugin ↔ backend ↔ éditeur.
Chaque entrée dit **quoi**, **pourquoi**, et **ce qui la verrouille** (test / vecteur de conformance).

Résumé exécutable dans `CLAUDE.md` § Invariants — ce fichier est le détail.

---

## Hash de project — byte-order sort + une seule implémentation par langage

Le hash de project a **une seule implémentation par langage** : `BundleHasher` (plugin) et
`hashUtils.computeBundleHash` (backend). Tous deux hashent une map **relPath-keyed** triée par
ordre byte natif (`<`/`>` Kotlin/JS — **jamais** `localeCompare` / `compareToIgnoreCase`, sinon
divergence plugin↔backend).

Côté plugin, disque (`hash`), `local_push` (`hashCanonical`) et upload passent **tous** par
`BundleHasher` — pas de second SHA-256 ad-hoc. Un hash dupliqué dans `LocalPushSender` avait
silencieusement divergé en keyant sur le chemin complet (corrigé 2026-06-17).

**Verrouillé par** le vecteur partagé `testdata/project-hash-conformance.json`, asservi par
`BundleHashConformanceTest` (plugin) **et** `hashUtils.test.ts` (backend). Changer l'algo = mettre
à jour les deux + régénérer le vecteur.

## Exclusion `.artisan*` universelle (2026-07-23)

Tout relPath dont le **premier segment** commence par `.artisan` (`.artisan-sync.yaml`,
`.artisan/editor.yaml`) est une métadonnée :

- **hors hash** des deux côtés ;
- **jamais uploadée** par le plugin (`ProjectFilesReader`) ;
- **préservée** par le backend aux deux points d'ingestion (`local_push` dans `hub.ts` et
  `POST /bundles`) — il garde ses copies `.artisan/*` ;
- **invisible au scan disque** (miroir de l'exclusion hash).

**Verrouillé par** le vecteur de conformance (entrées `.artisan*` présentes, `expectedHash`
inchangé).

## Sentinel `""` = jamais synchronisé / pas de contenu

Chaîne vide dans tous les contextes hash. `BundleHasher.hash()` (plugin),
`hashUtils.computeBundleHash` **et** `commitStorage.computeContentHash` (backend) renvoient `""`
pour un contenu vide. `SyncMetadata.syncedHash` vaut `""` par défaut.

**`computeContentHash` = même hash canonique (2026-07-26)** : le contentHash d'un commit strippe le
préfixe `plugins/Artisan/projects/<id>/` et exclut `.artisan*`. Il keyait avant sur les chemins
complets avec `.artisan*` inclus, donc `hello_ack.project_hashes` ne matchait **jamais** le hash
disque du plugin — `detectSyncAction` ne voyait jamais IN_SYNC / LOCAL_ONLY, et l'auto-push P3b
était mort en prod. Le `hello_ack` recalcule canoniquement depuis le `filesJson` du head pour
self-heal les commits legacy.

Conséquence voulue : un commit initial vide hashe `""`, ce qui rend la branche auto-push du plugin
(`backendHash.isEmpty()` → `local_push`) atteignable pour un stub fraîchement créé, au lieu de la
traiter comme un conflit.

## `BUNDLE_BASE_URL` vs `API_BASE_URL`

En Docker, le plugin (container `minecraft`) accède au backend via `http://backend:3001`, mais le
browser via `http://localhost:3001`. Les deux env vars sont **distinctes**. Par défaut
`BUNDLE_BASE_URL` = `API_BASE_URL` (hors Docker, c'est identique). Détail des variables :
`.env.example`.

## OkHttp — pas d'I/O bloquant dans le callback WS

`SyncedMenuProvider.handleMessage` est appelé sur le thread WS callback d'OkHttp. Le download de
bundle est dispatché sur `httpClient.dispatcher.executorService`. Ne jamais faire d'I/O bloquant
dans le callback WS directement.

## Reload atomique

`reloadFromDisk()` construit un nouveau `ConcurrentHashMap` **entier**, puis l'assigne à
`@Volatile var menus`. Ne jamais modifier le map en place.

## Scan disque + auto-push (P3b 2026-07-24, poll-first depuis 2026-07-30)

`SyncScanner` — tick périodique par project root, `scanIntervalMs` = 3 s, toujours actif y compris
offline. Une édition disque hot-reload localement puis auto-pushe (`local_push`) si
`detectSyncAction` = LOCAL_ONLY. CONFLICT (les deux côtés ont bougé) = hot-reload **sans** push +
un WARN.

Même logique au `hello_ack` (plus d'écrasement backend silencieux — le WARN « backend will
overwrite » est mort), et même gate dans le handler `bundle_available` lui-même (2026-07-26) : un
download annoncé ne s'applique que si `detectSyncAction` = IN_SYNC / AUTO_SYNC ; LOCAL_ONLY → push,
CONFLICT → `sync_divergence`. Seul `force: true` — émis par `resolve-divergence` — bypasse.

**Divergence vraie (P3c)** : CONFLICT → le plugin émet `sync_divergence` (arbre disque complet,
ré-émis à chaque `hello_ack` tant que non résolu) ; le backend le garde **en mémoire**
(`pendingDivergences` dans `hub.ts` — perdu au restart = self-healing au prochain reconnect) ;
l'éditeur affiche `DivergenceBanner` (choix disk/web par fichier, défaut disk) →
`POST …/resolve-divergence` → merge (`lib/divergence.ts`) + commit + `bundle_available` + clear.
Un `pushLocal` manuel clear aussi (force-disk).

## Détection = contenu, jamais événement

Spec `2026-07-30-poll-first-disk-sync-design`. `SyncScanner` remplace l'ancien `ProjectWatcher`
inotify, dont la correction dépendait d'événements OS jamais délivrés sur bind mount Docker / NFS /
SMB, et dont la fenêtre de suppression perdait silencieusement une édition qui atterrissait pendant
une écriture du plugin.

Le tick fait :

1. **court-circuit `stat`** — chemins / tailles / mtimes ; signature inchangée depuis le dernier
   dispatch ⇒ rien n'est lu ;
2. **quiescence sur 2 ticks consécutifs** avant dispatch, donc un upload FTP en cours n'est jamais
   poussé à moitié (borné, contrairement à un debounce qui se replanifie indéfiniment) ;
3. **deep tick tous les 10 ticks** = vrai hash de contenu, filet pour les FS à granularité mtime
   grossière.

**Plus de fenêtre de suppression** : une auto-écriture (download de bundle, move-to-trash) n'a rien
à supprimer puisque `BundleDownloader` enregistre le hash qu'il vient d'écrire
(`SyncMetadata.recordSync`) — le tick suivant résout IN_SYNC. « Est-ce moi qui ai écrit ça ? » est
une question de **contenu**, pas de timing.

La fenêtre d'écho entre un `local_push` et le `bundle_available` qui l'acquitte est fermée par
`lastPushedHash` (en mémoire seulement, vidé au `hello_ack` et après download : un push perdu en vol
est reposté, jamais oublié). `BundleDownloader` écrit toujours en atomique (`.artisan-tmp` +
rename) et skippe les fichiers au contenu identique.

Le comportement est **identique en dev Docker et en prod Linux** — c'est le gain principal.
L'incident du 2026-07-25 (`module: boutique` ajouté à la main → aucun auto-push) ne peut plus se
produire.

## Verrou optimiste (plus de freeze de conflit)

La table `project_conflicts` n'existe plus (cutover accounts-only) : `pushBundleAvailable`
(`hub.ts`) broadcast `bundle_available` sans condition dès qu'un commit est publié. La protection
contre l'écrasement concurrent est le **verrou optimiste** sur
`PUT /api/v1/user/projects/:projectId` (`baseVersion` requis, `409 version_conflict` +
`currentVersion` sinon) — cf. `entities.md` § Concurrence optimiste.

## DELETE project = soft-delete

`DELETE /api/v1/user/projects/:projectId` (cookie auth + membership) marque `deletedAt`
(`softDeleteProject`, la ligne reste en DB) et broadcast `project_deleted` au plugin (qui
move-to-trash) et aux autres connexions éditeur.

## `.artisan-trash/` is sacred

Répertoire au top de `projectsDir`, créé par `ProjectDeleter`. Exclu du hash (filtre `.` au
top-level dans `BundleHasher.hashAll`) et du sweep de `BundleDownloader` (filtre `.artisan*` sur les
filenames). Ne jamais utiliser ce nom pour autre chose.

## Suppressions propagées

`BundleDownloader.download` walk le projectDir après écriture et supprime les fichiers locaux
absents du bundle (filtre `.artisan*` préservé). Le sweep résout le bug historique où supprimer un
menu dans l'éditeur ne le retirait pas du disque serveur.

## Custom items — hash inline

`CustomItemsManager.buildBundle()` calcule le hash **en inline** à partir des items / textures déjà
collectés (ne rappelle pas `computeHash()` séparément) pour garantir la cohérence hash ↔ data.
