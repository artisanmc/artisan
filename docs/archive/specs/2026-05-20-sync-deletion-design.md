# Sync model — propagation des suppressions et résolution des divergences

**Status:** Design accepté, prêt pour plan d'implémentation
**Date:** 2026-05-20
**Scope:** plugin + backend + editor

---

## 1. Contexte et problèmes

Le modèle de sync actuel entre éditeur web, backend et plugin Minecraft est **additif uniquement** côté disque serveur. Deux bugs en découlent.

### Bug A — Suppressions éditeur ne propagent pas

`plugin/src/main/kotlin/net/artisanmc/plugin/sync/BundleDownloader.kt:48-54` boucle sur les fichiers reçus du backend et écrit chacun sur disque, **sans supprimer les fichiers locaux absents du bundle**. Conséquence : supprimer un menu dans l'éditeur met à jour le snapshot backend, mais le fichier YAML reste fantôme sur le disque serveur et est rechargé par `reloadFromDisk()` au prochain `bundle_available`.

### Bug B — Divergence disque ↔ backend silencieusement écrasée

`SyncedMenuProvider.detectSyncAction` (plugin/.../SyncedMenuProvider.kt:43-48) compare trois hashes (disque, dernier sync, backend) et logge un warning en cas de `LOCAL_ONLY` ou `CONFLICT`, mais ne fait rien d'autre. La commande `/artisan sync accept|reject` mentionnée dans les warnings n'est pas implémentée. Conséquence : toute modif faite directement sur les fichiers serveur (SSH d'un admin, édition manuelle) est silencieusement écrasée au prochain `bundle_available`.

### Décisions de design retenues

1. **Source de vérité hybride** : éditeur autoritaire en régime normal ; divergence détectée au boot du plugin et à `/artisan reload` doit produire une alerte interactive dans l'éditeur.
2. **Trigger de détection** : boot du plugin et `/artisan reload` uniquement. Pas de file watcher runtime.
3. **Granularité de résolution** : par pack.
4. **Cas "aucun éditeur ouvert"** : conflit persistant en DB, surfacé à la prochaine ouverture d'éditeur.
5. **Approche détection** : pre-fetch upfront — le plugin envoie le contenu disque complet au moment où il détecte la divergence, le backend stocke et résout en un seul round-trip.

---

## 2. Architecture & data flow

### Flux normal corrigé (bug A)

```
Editor → POST /api/bundles/:packId { files }
       → Backend stocke filesJson + recompute hash
       → WS broadcast bundle_available { pack_id, url, hash }
Plugin → GET /api/bundles/:packId → { files, hash }
       → BundleDownloader écrit chaque fichier
       → 🆕 BundleDownloader supprime fichiers locaux absents du bundle
       → SyncMetadata.recordSync(syncedHash, backendHash)
       → reloadFromDisk → onReload
```

### Flux conflit (bug B)

```
Plugin boot (ou /artisan reload)
  → BundleHasher.hash(packDir) pour chaque pack
  → detectSyncAction(disk, synced, backend)
  → si LOCAL_ONLY ou CONFLICT :
      lire disk_files (walk du packDir + readText)
      WS send pack_divergence_detected { pack_id, disk_files, disk_hash, last_synced_hash }

Backend
  → upsert pack_conflicts row { server_id, pack_id, disk_files_json, disk_hash, detected_at, resolved_at=NULL }
  → si éditeur(s) actif(s) pour ce server_key : WS push pack_conflict_detected { conflict_id, pack_id, detected_at }
  → sinon : éditeur le verra à l'ouverture via GET /api/editor-session/:token/conflicts

Editor (banner + modal)
  → "Keep editor" → POST /api/editor-session/:token/conflicts/:id/resolve { choice: "editor" }
        backend marque resolved, re-broadcast bundle_available (plugin pull la version backend, supprime les diffs via fix bug A)
  → "Use server" → POST .../resolve { choice: "server" }
        backend remplace filesJson par disk_files_json, recompute hash, marque resolved
        broadcast bundle_available (autres plugins se mettent en phase), refresh éditeur
```

### Flux suppression de pack entier

```
Editor → modal type-to-confirm (le user tape le nom du pack pour activer le bouton "Supprimer")
       → DELETE /api/editor-session/:token/packs/:packId
Backend → UPDATE pack_bundles SET deleted_at = NOW() WHERE serverId=? AND packId=?
       → UPDATE pack_conflicts SET resolved_at = NOW(), resolution = "editor" WHERE serverId=? AND packId=? AND resolved_at IS NULL
       → WS broadcast pack_deleted { pack_id } aux plugins connectés
       → WS broadcast pack_deleted { pack_id } aux autres éditeurs (multi-onglets)
Plugin → atomic switch sur bundles map (retire l'entrée)
       → move packsDir/<packId> → packsDir/.artisan-trash/<packId>-<timestamp>/
```

### Invariant fondamental

**Tant qu'un conflit ouvert existe pour `(server_id, pack_id)`, aucun `bundle_available` n'est broadcast pour ce pack.** Implémenté côté backend : la fonction de broadcast vérifie l'absence de conflit ouvert avant d'émettre. Empêche tout écrasement silencieux pendant qu'une décision est en attente.

---

## 3. Fix mécanique du bug A

**Cible** : `plugin/src/main/kotlin/net/artisanmc/plugin/sync/BundleDownloader.kt`.

**Mécanique** :

1. Construire `expectedRelPaths: Set<String>` à partir des clés du `files` map du bundle (chemins relatifs au `packDir`, normalisés en `/`).
2. Écrire les fichiers comme aujourd'hui (boucle existante L48-54).
3. Après écriture, walk `packDir` :
   - Pour chaque fichier rencontré, calculer son `relPath` (séparateur `/`).
   - **Skip** tout fichier dont le nom de base commence par `.artisan` (préfixe sentinel de SyncMetadata, déjà exclu du hash).
   - **Skip** tout fichier dont le chemin top-level commence par `.` (défense contre `.git`, `.DS_Store`, etc.).
   - Si `relPath ∉ expectedRelPaths` → supprimer.
4. Après le sweep, supprimer les répertoires devenus vides (`packDir.walkBottomUp().filter { it.isDirectory && it.list()?.isEmpty() == true && it != packDir }.forEach { it.delete() }`).
5. `SyncMetadata.recordSync(...)` comme aujourd'hui.

**Atomicité** — pas de besoin de transactionnalité forte. Si le plugin crashe entre l'écriture et le sweep, le prochain boot détectera la divergence (fichier fantôme présent sur disque alors que backend ne l'a plus) et le flux conflit prendra le relais.

---

## 4. Modèle de données

### Nouvelle table `pack_conflicts`

```ts
export const packConflicts = pgTable("pack_conflicts", {
  id: text("id").primaryKey(),                          // uuid
  serverId: text("server_id").notNull()
    .references(() => serverKeys.id, { onDelete: "cascade" }),
  packId: text("pack_id").notNull(),
  diskFilesJson: text("disk_files_json").notNull(),     // JSON.stringify(Record<path, content>)
  diskHash: text("disk_hash").notNull(),
  lastSyncedHash: text("last_synced_hash").notNull(),   // "" sentinel autorisé
  backendHashAtDetection: text("backend_hash_at_detection").notNull(),
  detectedAt: timestamp("detected_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),                 // NULL = ouvert
  resolution: text("resolution"),                       // NULL | "editor" | "server"
}, (t) => ({
  uniqOpen: uniqueIndex("pack_conflicts_open_uniq")
    .on(t.serverId, t.packId)
    .where(sql`${t.resolvedAt} IS NULL`),
}));
```

L'index unique partiel `WHERE resolved_at IS NULL` matérialise au niveau DB la règle "un pack peut avoir au plus UN conflit ouvert". Toute tentative d'en ouvrir un deuxième échoue, ce qui force le code à utiliser ON CONFLICT DO UPDATE.

### Nouvelle colonne sur `pack_bundles`

```ts
deletedAt: timestamp("deleted_at"),     // NULL = actif, sinon tombstone
```

Soft-delete. `pack_hashes` dans `hello_ack` exclut les rows `deletedAt IS NOT NULL`. Pas de purge auto en v1.

### Cycle de vie d'une row `pack_conflicts`

```
[plugin détecte divergence]
  → INSERT (ou UPDATE si conflit ouvert existe : on met à jour disk_files_json + disk_hash, garde detected_at)
  → resolvedAt = NULL

[admin clique dans l'éditeur]
  → UPDATE: resolvedAt = NOW(), resolution = "editor" | "server"

[résolution "server"] backend met à jour packBundles.filesJson depuis disk_files_json
[résolution "editor"] backend laisse packBundles.filesJson tel quel
[dans les deux cas]   backend broadcast bundle_available pour repush
[plugin reçoit bundle_available, applique le flux normal corrigé du bug A]
```

Les rows résolues restent en DB (audit trail). Pas de purge auto, pas une priorité v1.

---

## 5. Protocole WS étendu

### Messages plugin → backend (nouveaux)

| Type | Payload | Quand |
|---|---|---|
| `pack_divergence_detected` | `{ pack_id: string, disk_files: Record<string, string>, disk_hash: string, last_synced_hash: string }` | Au boot et à `/artisan reload`, une fois par pack divergent |

### Messages backend → plugin (nouveaux + modifiés)

| Type | Payload | Quand |
|---|---|---|
| `pack_deleted` | `{ pack_id: string }` | Quand un pack est supprimé via DELETE éditeur |
| `hello_ack` (étendu) | ajout du champ `deleted_pack_ids: string[]` | Pour réconcilier les suppressions ratées pendant que le plugin était offline |

### Messages backend → éditeur (nouveaux)

| Type | Payload | Quand |
|---|---|---|
| `pack_conflict_detected` | `{ conflict_id: string, pack_id: string, detected_at: string }` | Quand un row est inséré/updaté en DB et qu'un éditeur est connecté pour ce server_key |
| `pack_conflict_resolved` | `{ conflict_id: string, pack_id: string, resolution: "editor" \| "server" }` | Quand un autre éditeur résout (multi-onglets, multi-utilisateurs) |
| `pack_deleted` | `{ pack_id: string }` | Idem, propagé aux autres éditeurs ouverts |

Aucun message existant n'est breaking change.

### Format des chemins dans `disk_files`

Préfixé comme aujourd'hui dans `BundleUploader.kt:25` :
```
"plugins/Artisan/packs/<packId>/<relPath>" → "<content>"
```
Symétrie avec `BundleUploader` (le code de walk + read peut être factorisé). Les fichiers `.artisan*` sont exclus du payload.

### Hello flow modifié

```
plugin → hello { current_bundle_hash, ... }
backend → hello_ack { pack_hashes, deleted_pack_ids, ... }
plugin: pour chaque deleted_pack_id
  → si dossier présent sur disque → deletePackDirectory(packId)
plugin: pour chaque pack actif sur disque
  → calcule diskHash, lit syncedHash
  → si detectSyncAction == IN_SYNC          → rien
  → si detectSyncAction == AUTO_SYNC        → comme aujourd'hui (attend bundle_available)
  → si detectSyncAction == LOCAL_ONLY/CONFLICT
       → walk packDir, lit disk_files
       → WS send pack_divergence_detected
```

Côté backend, sur réception de `pack_divergence_detected` :
1. Validate auth (server_key déjà validé par WS hub).
2. Vérifie que le pack existe et n'est pas supprimé. Si supprimé → skip (le plugin recevra `pack_deleted` via `hello_ack.deleted_pack_ids`).
3. UPSERT `pack_conflicts` (insert si pas de row ouverte, update sinon).
4. Pour chaque éditeur ouvert pour ce server_key → WS send `pack_conflict_detected`.

Côté plugin, après envoi de `pack_divergence_detected` : ne réécrit rien sur disque pour ce pack jusqu'à un futur `bundle_available` (qui arrivera après résolution). Le pack continue de tourner sur l'état disque actuel (les menus déjà chargés en mémoire restent valides).

---

## 6. API HTTP éditeur

### Endpoints conflits

| Méthode | Endpoint | Réponse / Body | Sémantique |
|---|---|---|---|
| `GET` | `/api/editor-session/:token/conflicts` | `{ conflicts: ConflictSummary[] }` | Liste les conflits ouverts. Appelé à l'ouverture de l'éditeur. |
| `GET` | `/api/editor-session/:token/conflicts/:id` | `{ conflict: ConflictDetail }` | Détail incluant `diskFiles`. Permet (futur) un viewer de diff file-level. |
| `POST` | `/api/editor-session/:token/conflicts/:id/resolve` | body `{ choice: "editor" \| "server" }` → 200 `{ resolved: true, newHash: string }` ou 409 si déjà résolu | Résolution. |

### Endpoint suppression pack

| Méthode | Endpoint | Réponse | Sémantique |
|---|---|---|---|
| `DELETE` | `/api/editor-session/:token/packs/:packId` | 200 `{ deleted: true }` ou 404 | Soft-delete. Marque tout conflit ouvert pour ce pack comme `resolution: "editor"`. Broadcast `pack_deleted` aux plugins et autres éditeurs. |

### Types

```ts
type ConflictSummary = {
  id: string;
  packId: string;
  detectedAt: string;            // ISO
  diskHash: string;
  backendHashAtDetection: string;
  fileCount: number;
  diff: {
    addedOnDisk: string[];       // chemins relatifs présents sur disque, absents du backend
    removedOnDisk: string[];     // chemins absents du disque, présents dans le backend
    modifiedOnDisk: string[];    // chemins présents des deux côtés mais contenu différent
  };
};

type ConflictDetail = ConflictSummary & {
  diskFiles: Record<string, string>;
};
```

Le champ `diff` est **calculé à la demande** en comparant `pack_conflicts.disk_files_json` au `pack_bundles.files_json` actuel. Pas stocké, pas de risque de désynchro.

### Comportement de `POST resolve`

```ts
// pseudo-code
async function resolve(conflictId, choice) {
  return db.transaction(async (tx) => {
    const conflict = await tx.select().from(packConflicts)
      .where(and(eq(packConflicts.id, conflictId), isNull(packConflicts.resolvedAt)))
      .for("update");
    if (!conflict) throw 409; // déjà résolu (autre onglet)

    if (choice === "server") {
      // Suit la convention de POST /api/bundles/:packId (bundles.ts) :
      // - preserve l'editorJson existant (canvasLayout, etc.) si présent et non-stub
      // - sinon importPackFromFiles depuis les fichiers disque
      // - dans tous les cas, canvasLayout vient des fichiers disque (readEditorLayoutFromFiles)
      const diskFiles = JSON.parse(conflict.diskFilesJson) as Record<string, string>;
      const newHash = await computeBundleHash(diskFiles, conflict.packId);
      const existing = await tx.select({ editorJson: packBundles.editorJson }).from(packBundles)
        .where(and(eq(packBundles.serverId, conflict.serverId), eq(packBundles.packId, conflict.packId)));
      const incomingLayout = readEditorLayoutFromFiles(diskFiles, conflict.packId);
      let editorJsonObj: Record<string, unknown>;
      if (existing.length > 0 && !isEmptyStub(existing[0].editorJson)) {
        editorJsonObj = JSON.parse(existing[0].editorJson!) as Record<string, unknown>;
      } else {
        editorJsonObj = importPackFromFiles(conflict.packId, diskFiles) as Record<string, unknown>;
      }
      editorJsonObj.canvasLayout = incomingLayout;
      await tx.update(packBundles)
        .set({ filesJson: conflict.diskFilesJson, hash: newHash, editorJson: JSON.stringify(editorJsonObj) })
        .where(and(eq(packBundles.serverId, conflict.serverId), eq(packBundles.packId, conflict.packId)));
    }
    // pour "editor" : on ne touche pas packBundles

    await tx.update(packConflicts).set({ resolvedAt: now, resolution: choice }).where(eq(packConflicts.id, conflictId));
  });

  // hors transaction :
  // 1. broadcast bundle_available au plugin (pack n'est plus gelé)
  // 2. broadcast pack_conflict_resolved aux autres éditeurs ouverts pour ce server_key
  // 3. si choice === "server" : push aux éditeurs ouverts pour qu'ils refetch le pack
}
```

### Défense côté POST /api/bundles

`POST /api/bundles/:packId` doit refuser de publier si un conflit ouvert existe pour ce pack : 409 `{ error: "pack_locked", conflictId: "..." }`. Évite qu'un éditeur compromis force une publish pendant un conflit en attente. L'éditeur attrape ce code et affiche le banner conflit.

### Auth

`editorSession.ts` valide déjà le `token` et renvoie le `serverId`. On filtre les conflits sur `serverId`. Path traversal sur `:id` non possible (UUID strict).

---

## 7. UX éditeur

### Banner conflits

Banner persistant en haut de la zone canvas (route `pack.$packId.tsx`) tant qu'au moins un conflit non résolu existe pour le server_key actif.

```
┌─────────────────────────────────────────────────────────┐
│  ⚠  2 conflits détectés sur le serveur Minecraft       │
│     Les fichiers ont été modifiés en dehors de         │
│     l'éditeur.                          [Voir détails] │
└─────────────────────────────────────────────────────────┘
```

Hydration : au load de l'éditeur, `useEffect` fait `GET /api/editor-session/:token/conflicts` et peuple un slice `conflictsStore` (Zustand). Le WS éditeur écoute `pack_conflict_detected` / `pack_conflict_resolved` → upsert/remove dans le store en runtime.

### Modal de résolution

Clic "Voir détails" → modal listant les packs en conflit. Pour chacun :

```
my_pack
  Modifié sur le serveur Minecraft le 20 mai 2026 à 14:32
  
  Changements détectés :
   + 1 fichier ajouté          (dialogs/welcome.yaml)
   ~ 2 fichiers modifiés        (menus/main.yaml, lang/fr.yaml)
   - 1 fichier supprimé        (menus/old.yaml)
  
  ┌─────────────────────────┐   ┌─────────────────────────┐
  │  Garder l'éditeur       │   │  Utiliser le serveur    │
  │  Repousser cette version│   │  Adopter les fichiers   │
  │  vers le serveur.       │   │  du serveur ici.        │
  └─────────────────────────┘   └─────────────────────────┘
```

Les boutons décrivent l'action, pas le côté ("Repousser" / "Adopter") pour éviter l'ambiguïté.

**i18n** : toutes les chaînes via react-i18next, clés ajoutées dans `en.ts` + `fr.ts` simultanément.

### Comportements implicites

- L'édition d'un pack en conflit reste possible — on ne bloque pas le travail. L'admin peut éditer puis cliquer "Garder l'éditeur" pour pousser sa nouvelle version.
- Le **bouton "Publier" et l'auto-publish sont désactivés** pour les packs en conflit ouvert. La résolution "Garder l'éditeur" est ce qui débloque la publication.
- Si un autre admin résout pendant qu'on est dans le modal : on reçoit `pack_conflict_resolved` → toast "Conflit résolu par un autre admin" → modal se ferme, refresh.

### Modal de suppression pack

Pattern GitHub type-to-confirm :

```
Supprimer le pack «my_pack» ?

Cette action supprimera tous les menus, dialogs et traductions du pack sur tous
les serveurs Minecraft connectés. Les fichiers seront déplacés dans
`plugins/Artisan/.artisan-trash/` côté serveur en cas de récupération nécessaire.

Si un conflit existe pour ce pack, il sera ignoré et l'éditeur deviendra autoritaire.

Pour confirmer, tape le nom du pack :  [_______________]

[Annuler]   [Supprimer (désactivé jusqu'à match exact)]
```

---

## 8. Edge cases & invariants

### Invariant central

Un pack avec un conflit ouvert est gelé côté plugin — aucun `bundle_available` n'est broadcast tant que le conflit n'est pas résolu. Implémentation : la fonction de broadcast (dans `hub.ts` après publish ou reconnect) fait un `SELECT 1 FROM pack_conflicts WHERE server_id=? AND pack_id=? AND resolved_at IS NULL` et skip si match.

### Cas couverts

| # | Scénario | Comportement attendu |
|---|---|---|
| 1 | Plugin offline pendant que l'admin résout "use server" | À la reconnexion, plugin envoie `hello` avec son `disk_hash` (inchangé). Backend voit `packBundles.hash == disk_hash` → IN_SYNC → aucun bundle_available. |
| 2 | Plugin offline pendant que l'admin résout "keep editor" | Plugin reconnecte avec son `disk_hash` (toujours divergent). Backend voit conflit résolu → re-broadcast `bundle_available` immédiatement. Plugin télécharge, applique avec suppressions, divergence éliminée. |
| 3 | Race : admin résout pendant que plugin envoie nouveau `pack_divergence_detected` | UPDATE de résolution `WHERE resolved_at IS NULL` garantit qu'une seule transaction gagne. Si insert arrive après, c'est un nouveau conflit légitime (disque a re-changé). |
| 4 | Deux admins ouvrent l'éditeur, un résout, l'autre reçoit `pack_conflict_resolved` | Modal close + toast + refresh. |
| 5 | Plugin re-détecte pendant qu'un conflit est déjà ouvert (admin re-édite SSH puis /artisan reload) | UPSERT : UPDATE `disk_files_json` + `disk_hash` du conflit existant. `detected_at` garde sa valeur originale. |
| 6 | Admin publie depuis l'éditeur pendant qu'un conflit est ouvert pour le même pack | Bouton désactivé côté UI. Défense backend : POST /api/bundles renvoie 409 `pack_locked`. |
| 7 | "Use server" mais `diskFilesJson` est vide (admin a `rm -rf` le pack) | Warning supplémentaire dans le modal : "⚠ Adopter la version du serveur va vider ce pack (aucun fichier détecté sur disque). Confirmer ?". Si confirmé, `packBundles.filesJson = "{}"`. |
| 8 | Pack supprimé côté éditeur ET un conflit était en cours | DELETE marque le conflit `resolution: "editor"` automatiquement et envoie `pack_deleted` au plugin. Documenté dans la copy du modal de suppression. |
| 9 | Plugin envoie `pack_divergence_detected` pour un pack supprimé entre temps côté backend | Backend vérifie `packBundles` : si `deletedAt IS NOT NULL` ou row absente → skip l'upsert. Plugin recevra `pack_deleted` au prochain reconnect. |
| 10 | Path traversal via `disk_files` keys malicieuses | Côté plugin lors de la lecture initiale : `BundleUploader` walk depuis `packDir`, chemins safe by construction. Côté plugin lors du `bundle_available` qui suit : `BundleDownloader.kt:51` garde la défense `canonicalPath.startsWith(packDir.canonicalPath + File.separator)`. |
| 11 | Pack n'existe pas dans `pack_bundles` mais sur disque, et l'admin résout "keep editor" | Impossible en pratique : `pack_hashes` doit avoir été envoyé pour ce pack pour qu'un conflit s'ouvre. Le code d'auto-upload des empty-stubs (SyncedMenuProvider.kt:230-247) opère AVANT toute détection de conflit. |
| 12 | `/artisan reload` pendant que le pack est gelé en conflit | Plugin re-walk, re-détecte, ré-upsert (update `disk_files_json` si re-touché). Pas de boucle : aucun `bundle_available` n'arrive (gelé). Serveur tourne sur l'état disque. |
| 13 | Pack vide des deux côtés (`disk_hash == "" && backend_hash == ""`) | `detectSyncAction("", "", "")` → IN_SYNC. Pas de conflit. Sentinel `""` respecté. |

### Invariants à documenter dans CLAUDE.md

- **Conflit = freeze** : tant que `pack_conflicts.resolved_at IS NULL`, aucun `bundle_available` n'est émis pour `(server_id, pack_id)`.
- **Auto-resolution sur DELETE pack** : supprimer un pack côté éditeur résout implicitement tout conflit ouvert en `resolution: "editor"`.
- **Path safety** : la défense `canonicalPath.startsWith` dans `BundleDownloader` est essentielle — defense in depth, ne jamais retirer.
- **`.artisan*` est sacré** : préfixe exclu du hash, du sweep de suppression (bug A), et utilisé pour `.artisan-trash/`. Ne jamais utiliser pour autre chose.

---

## 9. Tests

### Backend (Bun + Vitest)

**Nouveaux fichiers** :
- `backend/src/lib/conflictDetection.test.ts` — calcul du `diff` (added/modified/removed). Cas : identiques, ajouts purs, suppressions pures, modifs, mix.
- `backend/src/routes/conflicts.test.ts` — endpoints `/api/editor-session/:token/conflicts*`. Cas : GET vide / non vide, GET détail, GET détail autre server_key → 404, POST resolve "editor" / "server", POST resolve déjà résolu → 409, POST resolve mauvais token → 401, POST resolve race (double click) → second appel 409.
- `backend/src/routes/packs.test.ts` (ou extension de `bundles.test.ts`) — DELETE pack. Cas : DELETE success → `deletedAt` set + WS `pack_deleted` émis aux plugins + autres éditeurs, DELETE pack avec conflit ouvert → conflit auto-résolu "editor", DELETE pack inexistant → 404, DELETE autre server_key → 404.

**Fichiers modifiés** :
- `backend/src/routes/bundles.test.ts` — POST /api/bundles/:packId rejeté avec 409 si conflit ouvert.
- `backend/src/lib/hub.test.ts` — réception `pack_divergence_detected` → upsert conflit + broadcast `pack_conflict_detected`. Re-réception → UPDATE. Pour pack supprimé → skip. `hello_ack` enrichi : `pack_hashes` exclut les packs supprimés, `deleted_pack_ids` peuplé.
- Tests de broadcast `bundle_available` — pas de broadcast si conflit ouvert.

**Schema test** : vérif que l'index unique partiel rejette une seconde row ouverte pour `(server_id, pack_id)`.

### Plugin (Kotlin + JUnit)

**Fichiers modifiés** :
- `plugin/src/test/kotlin/net/artisanmc/plugin/BundleDownloaderTest.kt` — 4 tests bug A : suppression propagée, SyncMetadata préservée, répertoires vides nettoyés, path traversal défendu.
- `plugin/src/test/kotlin/net/artisanmc/plugin/FullSyncIntegrationTest.kt` — scénario end-to-end : seed divergence → `load()` → vérif envoi `pack_divergence_detected` au mock backend → mock répond `bundle_available` simulant "keep editor" → vérif fichiers fantômes supprimés.

**Nouveau fichier** :
- `plugin/src/test/kotlin/net/artisanmc/plugin/PackDeletionTest.kt` :
  - WS `pack_deleted` runtime → dossier déplacé dans `.artisan-trash/<packId>-<timestamp>/`, `bundles` map atomiquement mis à jour.
  - `hello_ack.deleted_pack_ids` au reconnect → même comportement.
  - `pack_deleted` pour pack inexistant localement → no-op silencieux.
  - `.artisan-trash/` préexistant → second pack avec même nom → dossier trash avec timestamp distinct.

### Éditeur (Vitest + React Testing Library)

**Nouveaux fichiers** :
- `editor/src/state/conflictsStore.test.ts` — hydration depuis GET, upsert sur `pack_conflict_detected`, remove sur `pack_conflict_resolved`.
- `editor/src/features/sync/ConflictBanner.test.tsx` — visibilité conditionnelle, navigation vers modal.
- `editor/src/features/sync/ConflictResolutionModal.test.tsx` — résumé (added/modified/removed), routes appelées correctement, warning "disque vide", auto-close au dernier conflit résolu, toast sur `pack_conflict_resolved` pendant modal ouverte.
- `editor/src/features/sync/DeletePackDialog.test.tsx` — type-to-confirm, DELETE appelée, fermeture sur succès, gestion 404.

**Fichiers modifiés** :
- Tests existants de `pack.$packId.tsx` — bouton "Publier" / autopublish désactivé si conflit ouvert sur le pack courant.
- Tests `wsStore` — routage des nouveaux messages WS vers les bons stores.

### E2E manuel (non automatisé)

Scénario documenté dans `docs/specs/sync-deletion-e2e.md` (à créer avec la spec) :
1. Lancer Docker stack complète.
2. Créer un pack, ajouter 3 menus, publier.
3. Vérifier dossier présent sur disque serveur.
4. Supprimer un menu dans l'éditeur, publier → menu disparaît du disque (bug A).
5. Stopper le serveur, supprimer un fichier YAML en SSH, redémarrer.
6. Ouvrir l'éditeur → banner conflit apparaît.
7. Cliquer "Garder l'éditeur" → fichier YAML réapparait sur disque.
8. Refaire (5) avec une modif de contenu.
9. Cliquer "Utiliser le serveur" → éditeur reflète la version disque.
10. DELETE pack via modal type-to-confirm → vérifier déplacement dans `.artisan-trash/`.

---

## 10. Hors scope (follow-ups potentiels)

- **File watcher runtime** côté plugin (option rejetée section trigger). Si jamais on en a besoin plus tard, c'est ajoutable sans changer le protocole.
- **Diff file-level** dans la modal de résolution (viewer YAML side-by-side). La structure actuelle (`diskFiles` complet en DB) permet de l'ajouter sans migration.
- **GC du trash** côté plugin (`.artisan-trash/` purgé après N jours). Le dossier peut grossir indéfiniment sinon — TODO à tracker.
- **GC des conflits résolus** en DB (purge des rows `resolved_at < NOW() - 90 days`). Pas critique en v1.
- **Audit log** dédié des résolutions (qui a cliqué quoi, quand). Pour l'instant traçable via les timestamps sur `pack_conflicts`, mais sans identité utilisateur — le projet n'a pas encore d'utilisateurs nominatifs.

---

## 11. Fichiers touchés (estimation)

**Backend** :
- `backend/src/db/schema.ts` (table `pack_conflicts` + colonne `deletedAt` sur `pack_bundles`)
- `backend/src/lib/hub.ts` (nouveau handler `pack_divergence_detected`, broadcast freeze + nouveaux messages éditeur)
- `backend/src/lib/conflictDetection.ts` (nouveau — calcul du `diff`)
- `backend/src/routes/conflicts.ts` (nouveau)
- `backend/src/routes/packs.ts` (nouveau, ou ajout DELETE dans `bundles.ts`)
- `backend/src/routes/bundles.ts` (défense 409 `pack_locked`)
- `backend/src/index.ts` (registration des nouvelles routes)

**Plugin** :
- `plugin/src/main/kotlin/net/artisanmc/plugin/sync/BundleDownloader.kt` (fix bug A)
- `plugin/src/main/kotlin/net/artisanmc/plugin/sync/BundleUploader.kt` (factoriser le walk + read pour réutilisation dans la détection de conflit)
- `plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt` (envoi `pack_divergence_detected`, handler `pack_deleted`, lecture `deleted_pack_ids` dans `hello_ack`)
- `plugin/src/main/kotlin/net/artisanmc/plugin/sync/PackDeleter.kt` (nouveau — move-to-trash atomique)

**Éditeur** :
- `editor/src/state/conflictsStore.ts` (nouveau)
- `editor/src/features/sync/ConflictBanner.tsx` (nouveau)
- `editor/src/features/sync/ConflictResolutionModal.tsx` (nouveau)
- `editor/src/features/sync/DeletePackDialog.tsx` (nouveau)
- `editor/src/state/wsStore.ts` (routage nouveaux messages)
- `editor/src/routes/pack.$packId.tsx` (intégration banner + désactivation publish si conflit)
- `editor/src/locales/en.ts` + `fr.ts` (nouvelles clés)

**Docs** :
- `CLAUDE.md` (nouveaux invariants section "Invariants critiques", nouveaux endpoints dans la table, message `pack_deleted` dans la table protocole, mention `.artisan-trash/`)
- `docs/specs/sync-deletion-e2e.md` (nouveau — scénario manuel)
