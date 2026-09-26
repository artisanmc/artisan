# Plan — Étape 1 : miroir du Snapshot côté backend

ADR : [snapshot-mirror-and-backend-history](../../decisions/snapshot-mirror-and-backend-history.md),
décisions 1 à 3. Étapes suivantes (Versions, brouillons backend, ouverture serveur
éteint) : plans séparés.

## Périmètre

**Dedans** : le backend garde le dernier Snapshot de chaque Project serveur et le
sert tant que son hash égale le dernier hash annoncé par le plugin.

**Dehors** : Versions (étape 2 — mais le stockage est déjà adressé par contenu pour
ne pas migrer deux fois), brouillons (étape 3), serveur éteint (étape 4 : ici, un
serveur déconnecté invalide le miroir, comportement actuel inchangé), projets
hébergés, retrait de `projectCacheStore` (étape 4).

## Choix d'implémentation

- **Pas de nouveau message de transfert.** Le remplissage réutilise `project_read`
  avec `if_hash` = hash du miroir : `unchanged` confirme le miroir, sinon l'arbre
  complet le remplace. Pas de diff par fichier : la performance n'est pas le moteur
  (ADR, contexte), et les arbres font quelques dizaines de Ko.
- **Seul changement plugin** : le `hello` porte `snapshot_hashes: [{id, hash}]` et
  la capacité `snapshot_mirror_v1`. Nom distinct de `project_hashes` (champ retiré
  de `hello_ack`, backend → plugin) pour éviter la confusion.
- **Hash annoncé en mémoire** (`Map<serverKeyId, Map<diskId, hash>>` dans le hub),
  effacé à la déconnexion et au `session_replaced`. Le backend est mono-instance
  (audit prod-readiness) ; l'étape 4 persistera si besoin.
- **Écriture** : après un `project_write` / `asset_write` / publication de
  brouillon réussi, le hash annoncé du Project passe à « inconnu ». La lecture
  suivante passe par le plugin et remet tout d'aplomb. Aucun changement de
  `*_write_result`.
- **Remplissage eager au `hello`** et à `projects_reloaded`, en tâche de fond,
  séquentiel par serveur. L'étape 2 en a besoin : une édition à la main doit
  devenir une Version même si personne n'ouvre le Project.

## Modèle de données (migration à générer)

```
snapshot_blobs(hash text PK, content text not null)            -- sha256 du contenu
project_snapshots(
  project_id  text PK → projects.id ON DELETE CASCADE,
  hash        text not null,          -- empreinte plugin (snapshotHash), opaque
  files       jsonb not null,         -- { path: blobHash }
  binaries    jsonb not null,         -- [{ path, hash, size }] — annoncés, pas portés
  failed      jsonb not null,         -- [{ path, reason }]
  received_at timestamptz not null
)
```

Clé = id **interne** du Project, résolu par `getProjectForServer(serverKeyId, diskId)`
(jamais `getProject(diskId)` — incident cross-tenant 2026-08-12). Les corps des
binaires restent dans `assetCache` (déjà adressé par hash). Pas de GC des blobs à
cette étape : l'étape 2 les garde tous.

Piège migrations : partir d'`origin/main` à jour, `db:generate`, vérifier que le
numéro suit le dernier appliqué en prod (cf. mémoire renumérotation 0048/0049).

## Tâches (TDD : test rouge d'abord à chaque fois)

### 1. Plugin — annoncer les hashes au `hello`
- Test (`WsClientTest` / `SyncedMenuProviderTest`) : le `hello` contient
  `snapshot_mirror_v1` et `snapshot_hashes` ; le hash d'un Project y est **égal**
  à celui de `project_read_result` pour ce même Project.
- Impl : `refreshProjectPresence()` calcule `snapshotHash` par Project (factoriser
  avec `announceReload()` pour qu'il n'y ait qu'un calcul).

### 2. Backend — `lib/snapshotMirror.ts` (store)
- Tests : `put` puis `get` rend fichiers, binaires, failed et hash ; deux Projects
  au contenu commun partagent les blobs ; `put` remplace ; suppression du Project
  → cascade.
- Impl : `put(projectId, readResult)`, `get(projectId)`, en transaction.

### 3. Backend — validité (hub)
- Tests : `hello` avec capacité → hashes enregistrés ; sans capacité → rien
  (miroir jamais servi) ; `projects_reloaded` met à jour ; écriture réussie →
  inconnu ; déconnexion / `session_replaced` → tout effacé pour ce serveur.
- Impl : `announcedSnapshotHash(serverKeyId, diskId)`, `markUnknown(...)`,
  `forgetServer(...)`, câblés dans les handlers existants.

### 4. Backend — lecture via le miroir (`ServerProjectStorage.read` + `readAssetTree`)
- Tests avec transport factice :
  - miroir valide → **aucun** appel plugin, résultat identique à `project_read`,
    `if_hash` de l'appelant respecté (`unchanged: true` si égal) ;
  - miroir absent / périmé → appel plugin avec `if_hash` = hash du miroir ;
    `unchanged` → miroir confirmé ; arbre complet → miroir remplacé ;
  - plugin hors ligne ou timeout → même résultat qu'aujourd'hui, miroir intact ;
  - plugin sans capacité → comportement actuel exact.
- Impl : `projectTreeReads` et le cache 5 s disparaissent au profit du miroir
  (même rôle, fraîcheur garantie par le hash).

### 5. Backend — remplissage eager
- Tests : `hello` avec un hash ≠ miroir → un `project_read` part pour ce Project
  seulement ; hash égal → aucun ; `projects_reloaded` idem ; erreurs avalées et
  loguées une fois.
- Impl : file séquentielle par serveur, non bloquante pour le `hello`.

### 6. Vérification bout en bout (stack locale)
- `./gradlew deploy`, ouvrir `projet_test` : l'ouverture ne déclenche plus de
  `project_read` côté plugin (log debug) ; `/artisan reload` après édition à la
  main → le miroir suit ; publication → l'éditeur relit la nouvelle version ;
  ancien JAR → comportement actuel.

## Docs (même commit que le code, cf. `doc-impact-map.yaml`)

`ws-protocol.md` (champ `snapshot_hashes`, capacité), `entities.md` (deux tables),
`invariants.md` (miroir jamais autorité ni base de CAS), `testing.md`, `CHANGELOG.md`.

## Livraison

Worktree sur `origin/main` (l'arbre principal porte du WIP d'autres sessions),
suites plugin + backend + éditeur vertes en clone vierge avant push, puis CI.
