# Sync disque poll-first — le watcher devient une optimisation

**Statut :** **implémenté le 2026-07-30** — révise l'ADR
`files-first-source-of-truth` #6. `ProjectWatcher` supprimé, `SyncScanner`
(`plugin/.../sync/SyncScanner.kt`) le remplace ; suite plugin verte (786 tests).

## Problème

L'ADR `files-first-source-of-truth` #6 a fait du `ProjectWatcher` (WatchService
récursif, debounce 1,5 s, fenêtre de suppression) le mécanisme de détection des
éditions disque. C'est une **heuristique employée comme mécanisme de
correction**, et elle fuit par six endroits.

### 1. Perte silencieuse d'édition (bug livrable aujourd'hui)

`ProjectWatcher.handleEvent` refuse d'ajouter au set `dirty` quand le projet est
suppressé (`ProjectWatcher.kt:143`), et `flush` re-filtre puis **vide** le set
(l.180-182).

> Admin édite à T → un download de bundle démarre à T+0,5 s (`beginSuppress`) →
> flush à T+1,5 s : l'id est filtré **et effacé**. L'édition n'est pas retardée,
> elle est perdue jusqu'au prochain `hello_ack`.

C'est le chemin nominal d'une édition disque concurrente d'un push éditeur.

### 2. La fenêtre de suppression est une course temporelle

`endSuppress(graceMs = 2000)` (l.82) parie que l'OS a fini de délivrer ses
événements en 2 s. Trop court → boucle push/download (l'invariant anti-boucle de
`CLAUDE.md`). Trop long → défaut 1. Aucune valeur n'est correcte.

### 3. Debounce sans plafond → famine

`scheduleFlush` annule et replanifie à chaque événement (l.169). Un flux continu
d'écritures (upload FTP d'un gros projet, `unzip`, plugin tiers qui écrit
périodiquement) n'atteint jamais 1,5 s de silence : **le flush ne part jamais**.

### 4. Commit d'un arbre à moitié écrit

Symétriquement, un creux réseau au milieu d'un upload FTP crée un silence de
1,5 s et pousse un arbre partiel. Les événements FS ne portent aucun signal
d'atomicité.

### 5. `OVERFLOW` perd deux fois

La reprise sur débordement marque tout sale **sauf les suppressés** (l.118) :
les événements déjà perdus le sont une seconde fois.

### 6. Dépendance à inotify → dev ≠ prod

`FileSystems.getDefault().newWatchService()` (l.47) ne délivre rien sur les bind
mounts Docker Desktop, ni sur NFS/SMB (hébergeurs à panel FTP). Sans erreur ni
log. Le comportement diffère selon l'environnement — incident réel du
2026-07-25.

Les « filets » documentés (check au `hello_ack`, `/artisan pushLocal`) sont
l'aveu : la correction repose déjà, en pratique, sur la reconnexion et sur une
commande manuelle.

## Décision

**Inverser les rôles.** Le scan périodique par hash devient la vérité ; le
watcher devient une optimisation de latence, supprimable sans changer la
correction.

Formulé comme invariant :

> Aucun chemin de correction ne dépend d'un événement du système de fichiers.
> Toute divergence disque est détectée par comparaison de contenu, au pire au
> tick suivant.

### Pourquoi c'est peu coûteux ici

Toutes les pièces existent et sont déjà testées :

| Pièce | Où |
|---|---|
| Hash canonique de l'arbre | `BundleHasher.hash(projectDir)` |
| État de référence | `SyncMetadata` (`syncedHash` / `backendHash`) |
| Décision | `detectSyncAction(diskHash, syncedHash, backendHash)` — `SyncedMenuProvider.kt:43` |
| Dispatch | `onWatchedChange` (`SyncedMenuProvider.kt:289`) |

Le chemin `hello_ack` (`SyncedMenuProvider.kt:373`) **est déjà un poll** : il
exécute exactement cette comparaison à la reconnexion. « Poller toutes les N
secondes » = appeler du code existant sur un timer.

## Mécanisme

`SyncScanner` — un scheduler daemon, un tick toutes les `scanIntervalMs`
(défaut **15 s**), pour chaque racine de project :

1. **Court-circuit `stat`.** Walk de l'arbre en ne lisant que `mtime` + `size` +
   chemin ; agrège une *signature de scan*. Si elle est identique au tick
   précédent → rien à faire, aucun fichier lu. `stat` fonctionne partout, y
   compris sur les bind mounts.
2. **Quiescence.** Si la signature a bougé, ne rien faire ce tick — attendre
   qu'elle soit **stable sur deux ticks consécutifs**. C'est l'équivalent poll du
   debounce, mais borné (au plus 2 ticks) et sans famine possible. Traite le
   défaut 4 sans réintroduire le défaut 3.
3. **Hash + décision.** Signature stable et différente de la dernière hashée →
   `BundleHasher.hash(projectDir)` → `detectSyncAction(...)` → le dispatch actuel
   (`IN_SYNC`/`AUTO_SYNC` : rien ; `LOCAL_ONLY` : hot-reload + `local_push` ;
   `CONFLICT` : hot-reload + `sync_divergence`).

Exclusions `.artisan*` (premier segment) inchangées, au niveau du walk `stat`.

### La fenêtre de suppression disparaît

« Est-ce moi qui ai écrit ça ? » cesse d'être une question de *timing* et
redevient une question de *contenu*. `BundleDownloader.kt:102` fait déjà, après
écriture :

```kotlin
SyncMetadata.recordSync(projectDir, syncedHash = BundleHasher.hash(projectDir), backendHash = backendHash)
```

Le scan suivant recalcule le même hash → `IN_SYNC` (ou `AUTO_SYNC`) → aucun
push. Un self-write ne peut structurellement pas produire de push, quelle que
soit la latence.

**Supprimés** : `beginSuppress` / `endSuppress` / `suppressedUntil` et leurs 3
call sites (`SyncedMenuProvider.kt:496,736,829`), le debounce, l'invariant
anti-boucle de `CLAUDE.md`. Défauts 1, 2, 3, 5 éliminés par construction.

### La fenêtre d'écho après un `local_push` — résolu autrement

Après un `local_push`, `syncedHash` n'est rafraîchi qu'au retour du
`bundle_available` écho (« still download to refresh SyncMetadata »). Entre les
deux, plusieurs déclencheurs peuvent observer le même arbre `LOCAL_ONLY` (un
`config_write` puis le scan un tick plus tard) et re-pousser le même contenu.

La proposition initiale — écrire `recordSync(syncedHash = pushedHash)` à l'envoi
— **a été rejetée à l'implémentation** : si le push part mais n'est jamais
appliqué (connexion coupée en vol), le disque affirme « synchronisé », et au
reconnect `detectSyncAction` répond `AUTO_SYNC` → on attend un
`bundle_available` qui écrase l'édition locale. Perte de données.

Retenu : `lastPushedHash` (`ConcurrentHashMap`, **en mémoire uniquement**) —
« ce hash disque a déjà été auto-poussé dans cette session ». Vidé au
`hello_ack` et après chaque download, donc un push perdu en vol est reposté au
reconnect au lieu d'être oublié. Le pire cas après un restart est un push en
double, jamais une perte. Les trois déclencheurs automatiques (scan,
`bundle_available` LOCAL_ONLY, `config_write`) passent par `autoPush(...)` ;
`pushLocalProject` reste le chemin manuel/forcé, non dédoublonné.

### Le watcher

Supprimé (`ProjectWatcher.kt` + `ProjectWatcherTest.kt`), pas conservé en
fast path : la latence passe de ~1,5 s à ~3-6 s (intervalle 3 s × quiescence 2),
ce qui est sans conséquence pour de l'édition de config, et garder inotify
aurait signifié maintenir deux chemins dont un seul fonctionne selon l'hôte.
`SyncScanner.scanNow()` reste exposé (`internal`) — un fast path FS-event peut
revenir plus tard en s'y branchant, comme optimisation pure.

## Paramètres

| Nom | Défaut | Note |
|---|---|---|
| `scanIntervalMs` | 3 000 | Latence effective 3-6 s. Pas encore exposé dans `config.yml` — à faire si un serveur à très nombreux roots le demande |
| `quiescentTicks` | 2 | Un upload doit être calme sur 2 ticks avant d'être poussé |
| `deepTickEvery` | 10 | Un tick sur 10 compare le vrai hash de contenu (filet mtime grossier) |

## Ce que ça débloque

L'extension à des racines de plugins tiers (cf. discussion « géré ⇒ versionné »)
devient tenable : le scan passe à l'échelle sur N racines grâce au court-circuit
`stat`, et surtout « ce plugin réécrit son propre fichier » redevient une
question de **contenu** — comparaison au dernier hash synchronisé, plus règles
d'`ignore`/normalisation par racine appliquées au moment du hash — au lieu d'une
question d'événement impossible à attribuer.

## Implémentation livrée

- `plugin/.../sync/SyncScanner.kt` — nouveau. `plugin/.../sync/ProjectWatcher.kt`
  — supprimé.
- `SyncedMenuProvider` : `watchDebounceMs` → `scanIntervalMs` (3 000),
  `startWatcher()` → `startScanner()`, `onWatchedChange` → `onScanChanged`
  (corps inchangé), `autoPush(...)` + `lastPushedHash`, et les **trois** call
  sites `beginSuppress`/`endSuppress` retirés (download de bundle,
  `config_write`, move-to-trash).
- `SyncScannerTest` (8 tests) remplace `ProjectWatcherTest`.
  `WatcherAutoPushIntegrationTest` → `ScanAutoPushIntegrationTest`.
- Suite plugin complète : **786 tests, 0 échec**.

Les tests du scanner pilotent les ticks à la main (intervalle du scheduler placé
hors de la durée du test) : aucune dépendance à inotify, aucun `sleep`, aucun
comportement dépendant de l'hôte. C'était l'un des buts — les bugs de sync se
reproduisent désormais en test sur n'importe quelle plateforme.

### Reste à faire

- Exposer `scanIntervalMs` dans `config.yml` si le besoin apparaît.
- Mesurer le coût du walk `stat` sur un serveur à nombreuses racines avant
  d'étendre le scan à des dossiers de plugins tiers.

## Docs à mettre à jour à l'implémentation

- ADR `files-first-source-of-truth` #6 — révision (watcher → poll-first).
- `CLAUDE.md` : section « Watcher disque + auto-push (P3b) » — retirer
  l'invariant anti-boucle et la note « bind mounts Docker Desktop », qui
  cessent d'exister.
- `docs/architecture/ws-protocol.md` si la cadence de `local_push` change.

## Rejetés

- **Garder le watcher et allonger la grâce.** Déplace le curseur entre défaut 1
  et défaut 2 sans en supprimer aucun.
- **Watcher + poll en filet long (5 min).** C'est l'état actuel déguisé : la
  correction dépend toujours d'inotify sur le chemin rapide, donc dev ≠ prod
  persiste et les bugs ne se reproduisent pas en test.
- **Détection uniquement sur événements explicites** (boot, `/artisan reload`,
  connexion éditeur). Plus simple, mais rate l'édition FTP jamais suivie d'un
  reload — précisément le cas d'usage « les fichiers sont la surface d'édition ».
