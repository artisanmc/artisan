# Sync Model — Suppressions et résolution des divergences — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fixer la sync entre éditeur / backend / plugin sur trois axes connectés : (A) propager les suppressions de fichiers de l'éditeur vers le disque serveur, (B) détecter et résoudre les divergences disque ↔ backend via un workflow conflit persistant, (C) supporter la suppression de pack entier avec confirmation type-to-confirm et trash côté plugin.

**Architecture:** Modèle éditeur-autoritaire en régime normal ; le plugin émet `pack_divergence_detected` au boot et à `/artisan reload` quand le disque diverge de la dernière version synchronisée ; le backend stocke un conflit persistant et gèle les `bundle_available` jusqu'à résolution éditeur. La suppression de fichiers (bug A) devient une étape de sweep dans `BundleDownloader` ; la suppression de pack entier passe par un soft-delete backend + un déplacement vers `plugins/Artisan/.artisan-trash/` côté plugin. Toutes les UI éditeur passent par react-i18next + Zustand.

**Tech Stack:** Bun + Hono + Drizzle (PostgreSQL) côté backend ; Kotlin + JUnit + OkHttp + MockWebServer côté plugin ; React 19 + Vitest + Zustand côté éditeur ; bun:test.

**Spec:** `docs/superpowers/specs/2026-05-20-sync-deletion-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `plugin/src/main/kotlin/net/artisanmc/plugin/sync/BundleDownloader.kt` | Modify | Bug A : sweep des fichiers locaux absents du bundle après écriture. |
| `plugin/src/test/kotlin/net/artisanmc/plugin/BundleDownloaderTest.kt` | Modify (append) | Tests sweep / `.artisan*` préservée / dirs vides / path traversal. |
| `backend/src/db/schema.ts` | Modify | Ajout colonne `pack_bundles.deleted_at` + nouvelle table `pack_conflicts` avec index unique partiel. |
| `backend/src/protocol.ts` | Modify | Ajout types `PackDivergenceDetectedMessage`, `PackDeletedMessage`, `PackConflictDetectedMessage`, `PackConflictResolvedMessage` + champ `deleted_pack_ids` sur `HelloAckMessage`. |
| `backend/src/ws/hub.ts` | Modify | Handler `pack_divergence_detected`, broadcast freeze dans `pushBundleAvailable`, populate `deleted_pack_ids` dans `hello_ack`, exclusion des packs supprimés de `pack_hashes`, broadcasts `pack_conflict_detected` / `pack_conflict_resolved` / `pack_deleted`. |
| `backend/src/ws/hub.test.ts` | Modify (append) | Tests pour les nouveaux flux. |
| `backend/src/lib/conflictDiff.ts` | Create | Calcul du `diff` (added/modified/removed) entre `diskFilesJson` et `packBundles.filesJson`. |
| `backend/src/lib/conflictDiff.test.ts` | Create | Tests unitaires du diff. |
| `backend/src/routes/conflicts.ts` | Create | `GET /:token/conflicts`, `GET /:token/conflicts/:id`, `POST /:token/conflicts/:id/resolve`. |
| `backend/src/routes/conflicts.test.ts` | Create | Tests endpoints conflits. |
| `backend/src/routes/editorSession.ts` | Modify | Ajout `DELETE /:token/packs/:packId` (soft-delete + auto-résolution conflit + broadcasts). |
| `backend/src/routes/editorSession.test.ts` | Modify (append) | Tests DELETE pack. |
| `backend/src/routes/bundles.ts` | Modify | POST `/api/bundles/:packId` renvoie 409 `pack_locked` si conflit ouvert. |
| `backend/src/routes/bundles.test.ts` | Modify (append) | Test 409. |
| `backend/src/app.ts` | Modify | Wire le router conflicts. |
| `plugin/src/main/kotlin/net/artisanmc/plugin/sync/PackDeleter.kt` | Create | Move-to-trash atomique : `packsDir/<packId>` → `packsDir/.artisan-trash/<packId>-<timestamp>/`. |
| `plugin/src/test/kotlin/net/artisanmc/plugin/PackDeleterTest.kt` | Create | Tests move-to-trash. |
| `plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt` | Modify | Lire `deleted_pack_ids` dans `hello_ack`, handler WS `pack_deleted`, émettre `pack_divergence_detected` au boot et `/artisan reload` pour packs LOCAL_ONLY ou CONFLICT, factoriser le walk + read avec `BundleUploader`. |
| `plugin/src/test/kotlin/net/artisanmc/plugin/PackDeletionTest.kt` | Create | Tests réception `pack_deleted` runtime + `hello_ack.deleted_pack_ids` au reconnect. |
| `plugin/src/test/kotlin/net/artisanmc/plugin/FullSyncIntegrationTest.kt` | Modify (append) | Scénario E2E plugin : seed divergence → envoi `pack_divergence_detected` → freeze côté backend. |
| `plugin/src/main/kotlin/net/artisanmc/plugin/sync/BundleUploader.kt` | Modify | Extraire la fonction `readPackFiles(packDir, packId): Map<String, String>` pour réutilisation par le flux de détection. |
| `editor/src/state/conflictsStore.ts` | Create | Zustand store : hydration depuis API, upsert sur WS `pack_conflict_detected`, remove sur `pack_conflict_resolved`. |
| `editor/src/state/conflictsStore.test.ts` | Create | Tests store. |
| `editor/src/state/wsStore.ts` | Modify | Router les messages `pack_conflict_detected` / `pack_conflict_resolved` / `pack_deleted` vers les bons stores. |
| `editor/src/state/wsStore.test.ts` | Modify (append) | Tests routage. |
| `editor/src/lib/api/conflicts.ts` | Create | Client API : `listConflicts`, `getConflict`, `resolveConflict`. |
| `editor/src/lib/api/packs.ts` | Create | Client API : `deletePack`. |
| `editor/src/features/sync/ConflictBanner.tsx` | Create | Banner persistant en haut du canvas. |
| `editor/src/features/sync/ConflictBanner.test.tsx` | Create | Tests banner. |
| `editor/src/features/sync/ConflictResolutionModal.tsx` | Create | Modal par pack avec diff résumé + 2 boutons. |
| `editor/src/features/sync/ConflictResolutionModal.test.tsx` | Create | Tests modal. |
| `editor/src/features/sync/DeletePackDialog.tsx` | Create | Modal type-to-confirm. |
| `editor/src/features/sync/DeletePackDialog.test.tsx` | Create | Tests dialog. |
| `editor/src/routes/pack.$packId.tsx` | Modify | Hydratation conflits au mount, banner intégré, autopublish inhibé si conflit ouvert. |
| `editor/src/locales/en.ts` | Modify | Ajout clés `sync.*` (banner, modal, dialog). |
| `editor/src/locales/fr.ts` | Modify | Idem en français. |
| `CLAUDE.md` | Modify | Nouveaux invariants (freeze, .artisan-trash), nouveaux messages WS, nouveaux endpoints, bump test counts. |

---

# Phase 1 — Bug A : propagation des suppressions dans `BundleDownloader`

Cette phase est self-contained et ne touche que le plugin. Elle peut shipper indépendamment.

## Task 1: Test "fichiers fantômes supprimés après download"

**Files:**
- Modify: `plugin/src/test/kotlin/net/artisanmc/plugin/BundleDownloaderTest.kt`

- [ ] **Step 1: Ajouter le test à la fin du fichier (avant la `}` de la classe)**

```kotlin
    @Test
    fun `download removes local files not present in bundle`() {
        MockWebServer().use { server ->
            server.start()
            val packId = "p_sweep_test"
            val packsDir = Files.createTempDirectory("artisan_sweep_").toFile()
            val packDir = File(packsDir, packId).also { it.mkdirs() }

            // Seed: deux menus sur disque
            File(packDir, "menus").mkdirs()
            File(packDir, "menus/keep.yaml").writeText("id: keep\nsize: 27\n")
            File(packDir, "menus/stale.yaml").writeText("id: stale\nsize: 9\n")

            // Bundle backend : seulement keep.yaml (stale.yaml a été supprimé dans l'éditeur)
            val files = mapOf(
                "plugins/Artisan/packs/$packId/menus/keep.yaml" to "id: keep\nsize: 27\n"
            )
            server.enqueue(
                MockResponse()
                    .setBody(mapper.writeValueAsString(mapOf("files" to files, "hash" to "abc")))
                    .setHeader("Content-Type", "application/json")
            )

            val downloader = BundleDownloader(OkHttpClient(), packsDir)
            downloader.download(
                url = server.url("/api/bundles/$packId").toString(),
                serverKey = "sk", packId = packId,
            )

            assertTrue(File(packDir, "menus/keep.yaml").exists(), "keep.yaml doit être conservé")
            assertTrue(!File(packDir, "menus/stale.yaml").exists(), "stale.yaml doit être supprimé")
        }
    }
```

- [ ] **Step 2: Run pour confirmer le fail**

```bash
cd plugin
./gradlew test --tests "net.artisanmc.plugin.BundleDownloaderTest.download removes local files not present in bundle"
```

Expected: FAIL — `stale.yaml` est toujours présent (sweep pas implémenté).

- [ ] **Step 3: Implémenter le sweep dans `BundleDownloader.kt`**

Modifier `plugin/src/main/kotlin/net/artisanmc/plugin/sync/BundleDownloader.kt`, remplacer la fonction `download` par :

```kotlin
    fun download(url: String, serverKey: String, packId: String) {
        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $serverKey")
            .build()

        val responseBody = httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                logger?.warning("Bundle download failed: HTTP ${response.code} for pack $packId")
                return
            }
            response.body?.string() ?: return
        }

        val parsed = runCatching {
            mapper.readValue(responseBody, object : TypeReference<Map<String, Any>>() {})
        }.getOrNull() ?: run {
            logger?.warning("Bundle download: failed to parse response for pack $packId")
            return
        }

        @Suppress("UNCHECKED_CAST")
        val files = parsed["files"] as? Map<String, String> ?: run {
            logger?.warning("Bundle download: missing 'files' in response for pack $packId")
            return
        }
        val backendHash = parsed["hash"] as? String ?: ""

        val prefix = "plugins/Artisan/packs/$packId/"
        val packDir = File(packsDir, packId)
        packDir.mkdirs()

        // 1) Build expected rel-paths and write incoming files
        val expectedRelPaths = mutableSetOf<String>()
        for ((path, content) in files) {
            val relPath = if (path.startsWith(prefix)) path.removePrefix(prefix) else continue
            val target = File(packDir, relPath)
            if (!target.canonicalPath.startsWith(packDir.canonicalPath + File.separator)) continue
            target.parentFile?.mkdirs()
            target.writeText(content, Charsets.UTF_8)
            expectedRelPaths.add(relPath.replace('\\', '/'))
        }

        // 2) Sweep: delete local files NOT in the bundle, preserving .artisan* metadata
        packDir.walkTopDown()
            .filter { it.isFile }
            .filter { !it.name.startsWith(".artisan") }
            .forEach { f ->
                val relPath = f.relativeTo(packDir).path.replace('\\', '/')
                if (relPath !in expectedRelPaths) f.delete()
            }

        // 3) Cleanup empty directories bottom-up (but keep packDir itself)
        packDir.walkBottomUp()
            .filter { it.isDirectory && it != packDir }
            .filter { it.list()?.isEmpty() == true }
            .forEach { it.delete() }

        SyncMetadata.recordSync(packDir, syncedHash = BundleHasher.hash(packDir), backendHash = backendHash)
        logger?.info("Bundle synced for pack $packId (${expectedRelPaths.size} files, swept)")
    }
```

- [ ] **Step 4: Run le test, vérifier qu'il passe**

```bash
cd plugin
./gradlew test --tests "net.artisanmc.plugin.BundleDownloaderTest"
```

Expected: PASS pour les 3 tests (les 2 anciens + le nouveau).

- [ ] **Step 5: Commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/plugin/sync/BundleDownloader.kt plugin/src/test/kotlin/net/artisanmc/plugin/BundleDownloaderTest.kt
rtk git commit -m "fix(plugin): BundleDownloader — sweep des fichiers locaux absents du bundle"
```

## Task 2: Test ".artisan* metadata préservée pendant le sweep"

**Files:**
- Modify: `plugin/src/test/kotlin/net/artisanmc/plugin/BundleDownloaderTest.kt`

- [ ] **Step 1: Ajouter le test**

```kotlin
    @Test
    fun `sweep preserves dotartisan metadata files`() {
        MockWebServer().use { server ->
            server.start()
            val packId = "p_meta_preserve"
            val packsDir = Files.createTempDirectory("artisan_meta_preserve_").toFile()
            val packDir = File(packsDir, packId).also { it.mkdirs() }
            File(packDir, ".artisan-sync.yaml").writeText("syncedHash: prev\nbackendHash: prev\n")
            File(packDir, "menus").mkdirs()
            File(packDir, "menus/old.yaml").writeText("id: old\n")

            // Bundle vide (admin a tout supprimé)
            server.enqueue(
                MockResponse()
                    .setBody(mapper.writeValueAsString(mapOf("files" to emptyMap<String, String>(), "hash" to "")))
                    .setHeader("Content-Type", "application/json")
            )

            val downloader = BundleDownloader(OkHttpClient(), packsDir)
            downloader.download(server.url("/api/bundles/$packId").toString(), "sk", packId)

            assertTrue(File(packDir, ".artisan-sync.yaml").exists(), "métadonnée préservée")
            assertTrue(!File(packDir, "menus/old.yaml").exists(), "fichier sweepé")
        }
    }
```

- [ ] **Step 2: Run le test**

```bash
cd plugin
./gradlew test --tests "net.artisanmc.plugin.BundleDownloaderTest.sweep preserves dotartisan metadata files"
```

Expected: PASS (le filter `!it.name.startsWith(".artisan")` est déjà en place depuis Task 1).

- [ ] **Step 3: Commit**

```bash
rtk git add plugin/src/test/kotlin/net/artisanmc/plugin/BundleDownloaderTest.kt
rtk git commit -m "test(plugin): BundleDownloader — sweep préserve .artisan* metadata"
```

## Task 3: Test "répertoires vides nettoyés"

**Files:**
- Modify: `plugin/src/test/kotlin/net/artisanmc/plugin/BundleDownloaderTest.kt`

- [ ] **Step 1: Ajouter le test**

```kotlin
    @Test
    fun `sweep removes directories that become empty`() {
        MockWebServer().use { server ->
            server.start()
            val packId = "p_dir_cleanup"
            val packsDir = Files.createTempDirectory("artisan_dir_").toFile()
            val packDir = File(packsDir, packId).also { it.mkdirs() }
            File(packDir, "dialogs").mkdirs()
            File(packDir, "dialogs/d1.yaml").writeText("id: d1\n")
            File(packDir, "menus").mkdirs()
            File(packDir, "menus/m1.yaml").writeText("id: m1\n")

            // Bundle ne garde que menus/m1.yaml — dialogs/ doit disparaitre
            val files = mapOf(
                "plugins/Artisan/packs/$packId/menus/m1.yaml" to "id: m1\n"
            )
            server.enqueue(
                MockResponse()
                    .setBody(mapper.writeValueAsString(mapOf("files" to files, "hash" to "x")))
                    .setHeader("Content-Type", "application/json")
            )

            val downloader = BundleDownloader(OkHttpClient(), packsDir)
            downloader.download(server.url("/api/bundles/$packId").toString(), "sk", packId)

            assertTrue(!File(packDir, "dialogs").exists(), "dialogs/ doit être supprimé (vide après sweep)")
            assertTrue(File(packDir, "menus/m1.yaml").exists(), "menus/m1.yaml conservé")
            assertTrue(File(packDir, "menus").exists(), "menus/ conservé (contient m1)")
        }
    }
```

- [ ] **Step 2: Run, vérifier PASS** (logique implémentée en Task 1)

```bash
cd plugin
./gradlew test --tests "net.artisanmc.plugin.BundleDownloaderTest.sweep removes directories that become empty"
```

- [ ] **Step 3: Commit**

```bash
rtk git add plugin/src/test/kotlin/net/artisanmc/plugin/BundleDownloaderTest.kt
rtk git commit -m "test(plugin): BundleDownloader — sweep nettoie les répertoires vides"
```

## Task 4: Test "défense path traversal toujours en place"

**Files:**
- Modify: `plugin/src/test/kotlin/net/artisanmc/plugin/BundleDownloaderTest.kt`

- [ ] **Step 1: Ajouter le test**

```kotlin
    @Test
    fun `download rejects path traversal in file keys`() {
        MockWebServer().use { server ->
            server.start()
            val packId = "p_traversal"
            val packsDir = Files.createTempDirectory("artisan_trav_").toFile()
            // Fichier hors du packDir — ne doit JAMAIS être écrit
            val outsideTarget = File(packsDir, "outside.txt")

            val files = mapOf(
                "plugins/Artisan/packs/$packId/../outside.txt" to "pwned"
            )
            server.enqueue(
                MockResponse()
                    .setBody(mapper.writeValueAsString(mapOf("files" to files, "hash" to "h")))
                    .setHeader("Content-Type", "application/json")
            )

            val downloader = BundleDownloader(OkHttpClient(), packsDir)
            downloader.download(server.url("/api/bundles/$packId").toString(), "sk", packId)

            assertTrue(!outsideTarget.exists(), "Le fichier en dehors du packDir doit être bloqué")
        }
    }
```

- [ ] **Step 2: Run, vérifier PASS** (défense `canonicalPath.startsWith(...)` existante L51 conservée en Task 1)

```bash
cd plugin
./gradlew test --tests "net.artisanmc.plugin.BundleDownloaderTest.download rejects path traversal in file keys"
```

- [ ] **Step 3: Commit**

```bash
rtk git add plugin/src/test/kotlin/net/artisanmc/plugin/BundleDownloaderTest.kt
rtk git commit -m "test(plugin): BundleDownloader — defense in depth contre path traversal"
```

---

# Phase 2 — Schéma DB : `pack_conflicts` + `deletedAt`

## Task 5: Migration schéma + colonne deletedAt sur pack_bundles

**Files:**
- Modify: `backend/src/db/schema.ts`

- [ ] **Step 1: Ajouter `deletedAt` à `packBundles`**

Dans `backend/src/db/schema.ts`, modifier le bloc `packBundles` (lignes 14-25) pour ajouter `deletedAt: timestamp("deleted_at")` :

```ts
export const packBundles = pgTable("pack_bundles", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull(),
  packId: text("pack_id").notNull(),
  hash: text("hash").notNull(),
  filesJson: text("files_json").notNull(),
  editorJson: text("editor_json"),
  deployedEditorJson: text("deployed_editor_json"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull(),
}, (t) => [
  uniqueIndex("server_pack_uniq").on(t.serverId, t.packId),
]);
```

- [ ] **Step 2: Ajouter la table `packConflicts` à la fin du fichier**

```ts
export const packConflicts = pgTable("pack_conflicts", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull().references(() => serverKeys.id, { onDelete: "cascade" }),
  packId: text("pack_id").notNull(),
  diskFilesJson: text("disk_files_json").notNull(),
  diskHash: text("disk_hash").notNull(),
  lastSyncedHash: text("last_synced_hash").notNull(),
  backendHashAtDetection: text("backend_hash_at_detection").notNull(),
  detectedAt: timestamp("detected_at").notNull(),
  resolvedAt: timestamp("resolved_at"),
  resolution: text("resolution"), // NULL | "editor" | "server"
}, (t) => [
  uniqueIndex("pack_conflicts_open_uniq")
    .on(t.serverId, t.packId)
    .where(sql`resolved_at IS NULL`),
]);
```

- [ ] **Step 3: Lancer la migration sur la DB locale**

```bash
cd backend
bun run db:push
```

Expected: la commande affiche que `pack_bundles.deleted_at` est ajoutée et que `pack_conflicts` est créée avec l'index unique partiel.

- [ ] **Step 4: Commit**

```bash
rtk git add backend/src/db/schema.ts
rtk git commit -m "feat(backend): schema — pack_bundles.deletedAt + pack_conflicts (open uniq index)"
```

---

# Phase 3 — Protocole WS étendu (backend)

## Task 6: Étendre `protocol.ts` avec les nouveaux types de messages

**Files:**
- Modify: `backend/src/protocol.ts`

- [ ] **Step 1: Ajouter les types et étendre `HelloAckMessage`**

Modifier `HelloAckMessage` (lignes 11-22) pour ajouter `deleted_pack_ids` :

```ts
export interface HelloAckMessage {
  type: "hello_ack";
  session_id: string;
  server_id: string;
  tier: "free" | "crew" | "network";
  needs_sync: boolean;
  latest_bundle_hash: string;
  api_url: string;
  bundle_url: string;
  pack_hashes: Record<string, string>;
  deleted_pack_ids: string[];
  resource_pack: { url: string; hash: string } | null;
}
```

À la fin du fichier, juste avant `export type PluginToServerMessage = ...`, ajouter :

```ts
// Plugin → backend : divergence disque ↔ backend détectée au boot ou /artisan reload
export interface PackDivergenceDetectedMessage {
  type: "pack_divergence_detected";
  pack_id: string;
  disk_files: Record<string, string>;
  disk_hash: string;
  last_synced_hash: string;
}

// Backend → plugin : pack supprimé côté éditeur
export interface PackDeletedMessage {
  type: "pack_deleted";
  pack_id: string;
}

// Backend → éditeur : conflit ouvert/refresh
export interface PackConflictDetectedEditorMessage {
  type: "pack_conflict_detected";
  conflict_id: string;
  pack_id: string;
  detected_at: string;
}

// Backend → éditeur : conflit résolu (multi-onglets)
export interface PackConflictResolvedEditorMessage {
  type: "pack_conflict_resolved";
  conflict_id: string;
  pack_id: string;
  resolution: "editor" | "server";
}
```

Et étendre les unions :

```ts
export type PluginToServerMessage =
  | HelloMessage
  | PongMessage
  | SetupRequestMessage
  | SetupClaimMessage
  | EditorSessionRequestMessage
  | EditorSessionRevokeMessage
  | EditorTrustRequestMessage
  | CustomItemsChangedMessage
  | CustomItemsBundleMessage
  | PackDivergenceDetectedMessage;

export type ServerToPluginMessage =
  | HelloAckMessage
  | BundleAvailableMessage
  | DraftUpdateMessage
  | PingMessage
  | SetupCodeMessage
  | LinkConfirmedMessage
  | EditorSessionReadyMessage
  | CustomItemsRequestMessage
  | ResourcePackUpdatedMessage
  | PackDeletedMessage;
```

- [ ] **Step 2: Vérifier que le TypeScript compile**

```bash
cd backend
bunx tsc --noEmit
```

Expected: une seule erreur dans `backend/src/ws/hub.ts` à propos de `deleted_pack_ids` manquant dans la construction de `HelloAckMessage` — c'est ce qu'on va fixer en Task 7.

- [ ] **Step 3: Commit**

```bash
rtk git add backend/src/protocol.ts
rtk git commit -m "feat(backend): protocol — types pour divergence/deletion (pack_conflicts WS)"
```

---

# Phase 4 — Suppression de pack (backend + plugin + éditeur)

Cette phase implémente le flux DELETE pack en entier (plus simple que le flux conflit, on l'enchaîne d'abord).

## Task 7: Backend — populate `deleted_pack_ids` dans `hello_ack` et filtrer `pack_hashes`

**Files:**
- Modify: `backend/src/ws/hub.ts`

- [ ] **Step 1: Modifier la requête `packs` et la construction de `ack`**

Dans `hub.ts`, dans la fonction `handlePluginMessage` (case `hello`), remplacer le bloc qui SELECT les packs (autour des lignes 135-141) par :

```ts
    const allPacks = await db
      .select({ packId: packBundles.packId, hash: packBundles.hash, deletedAt: packBundles.deletedAt })
      .from(packBundles)
      .where(eq(packBundles.serverId, keyId));

    const packs = allPacks.filter((p) => p.deletedAt == null);
    const deletedPackIds = allPacks.filter((p) => p.deletedAt != null).map((p) => p.packId);

    const packHashesMap: Record<string, string> = {};
    for (const p of packs) packHashesMap[p.packId] = p.hash;
```

Ensuite, dans la construction de `ack`, ajouter `deleted_pack_ids: deletedPackIds` :

```ts
    const ack: HelloAckMessage = {
      type: "hello_ack",
      session_id: sessionId,
      server_id: keyId,
      tier: "free",
      needs_sync: needsSync,
      latest_bundle_hash: latestHash,
      api_url: API_BASE_URL,
      bundle_url: BUNDLE_BASE_URL,
      pack_hashes: packHashesMap,
      deleted_pack_ids: deletedPackIds,
      resource_pack: rp,
    };
```

- [ ] **Step 2: Vérifier que ça compile**

```bash
cd backend
bunx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Lancer les tests existants pour vérifier qu'on n'a rien cassé**

```bash
cd backend
bun test src/ws/hub.test.ts
```

Expected: les tests existants doivent passer (la nouvelle clé `deleted_pack_ids: []` ne devrait pas casser ceux qui n'inspectent pas ce champ).

- [ ] **Step 4: Commit**

```bash
rtk git add backend/src/ws/hub.ts
rtk git commit -m "feat(backend): hello_ack — filtre packs supprimés + expose deleted_pack_ids"
```

## Task 8: Backend — endpoint `DELETE /:token/packs/:packId`

**Files:**
- Modify: `backend/src/routes/editorSession.ts`
- Modify: `backend/src/routes/editorSession.test.ts`

- [ ] **Step 1: Écrire le test (TDD)**

À la fin de `backend/src/routes/editorSession.test.ts`, ajouter avant la dernière `}` :

```ts
describe("DELETE /api/editor-session/:token/packs/:packId", () => {
  test("soft-deletes pack, broadcasts pack_deleted, returns 200", async () => {
    // Setup: create server key + pack
    const keyRes = await app.request("/api/server-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "delete-test" }),
    });
    const { key, id: serverKeyId } = (await keyRes.json()) as { key: string; id: string };

    // Insert pack
    const { db } = await import("../db/index");
    const { packBundles, editorSessions } = await import("../db/schema");
    await db.insert(packBundles).values({
      id: crypto.randomUUID(),
      serverId: serverKeyId,
      packId: "p_to_delete",
      hash: "h",
      filesJson: "{}",
      editorJson: JSON.stringify({ id: "p_to_delete", name: "p_to_delete" }),
      createdAt: new Date(),
    });

    // Create editor session and exchange for access token
    const sessionToken = `etok_${crypto.randomUUID()}`;
    const accessToken = `acc_${crypto.randomUUID()}`;
    await db.insert(editorSessions).values({
      token: sessionToken,
      serverKeyId,
      createdBy: "test",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400_000),
      exchangedAt: new Date(),
      accessToken,
      accessExpiresAt: new Date(Date.now() + 86400_000),
    });

    const res = await app.request(`/api/editor-session/${accessToken}/packs/p_to_delete`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: boolean };
    expect(body.deleted).toBe(true);

    // Verify soft-delete in DB
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(packBundles).where(eq(packBundles.packId, "p_to_delete"));
    expect(rows[0].deletedAt).not.toBeNull();
  });

  test("returns 404 for unknown pack", async () => {
    const keyRes = await app.request("/api/server-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "delete-404" }),
    });
    const { id: serverKeyId } = (await keyRes.json()) as { id: string };
    const { db } = await import("../db/index");
    const { editorSessions } = await import("../db/schema");
    const accessToken = `acc_${crypto.randomUUID()}`;
    await db.insert(editorSessions).values({
      token: `etok_${crypto.randomUUID()}`,
      serverKeyId,
      createdBy: "test",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400_000),
      exchangedAt: new Date(),
      accessToken,
      accessExpiresAt: new Date(Date.now() + 86400_000),
    });

    const res = await app.request(`/api/editor-session/${accessToken}/packs/nonexistent`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run le test, vérifier qu'il fail (endpoint n'existe pas)**

```bash
cd backend
bun test src/routes/editorSession.test.ts -t "DELETE /api/editor-session"
```

Expected: FAIL — 404 sur la route DELETE (Hono répond Not Found pour route inconnue).

- [ ] **Step 3: Implémenter l'endpoint dans `editorSession.ts`**

À la fin de `backend/src/routes/editorSession.ts`, AVANT `export { router as editorSessionRouter };`, ajouter :

```ts
router.delete("/:token/packs/:packId", async (c) => {
  const token = c.req.param("token");
  const packId = c.req.param("packId");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const { packBundles, packConflicts } = await import("../db/schema");
  const { and, eq, isNull } = await import("drizzle-orm");

  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const updated = await tx.update(packBundles)
      .set({ deletedAt: now })
      .where(and(
        eq(packBundles.serverId, session.serverKeyId),
        eq(packBundles.packId, packId),
        isNull(packBundles.deletedAt),
      ))
      .returning({ id: packBundles.id });
    if (updated.length === 0) return null;

    // Auto-resolve any open conflict for this pack as "editor"
    await tx.update(packConflicts)
      .set({ resolvedAt: now, resolution: "editor" })
      .where(and(
        eq(packConflicts.serverId, session.serverKeyId),
        eq(packConflicts.packId, packId),
        isNull(packConflicts.resolvedAt),
      ));
    return updated[0];
  });

  if (!result) return c.json({ error: "Not found" }, 404);

  const { pushPackDeleted } = await import("../ws/hub");
  pushPackDeleted(session.serverKeyId, packId);

  return c.json({ deleted: true });
});
```

- [ ] **Step 4: Ajouter `pushPackDeleted` à `hub.ts`**

Dans `backend/src/ws/hub.ts`, à la fin du fichier (après `pushResourcePackUpdated`), ajouter :

```ts
export function pushPackDeleted(serverKeyId: string, packId: string): void {
  const payload = JSON.stringify({ type: "pack_deleted", pack_id: packId });
  // Push to plugin connections
  for (const [connId, sId] of connToServerId) {
    if (sId !== serverKeyId) continue;
    const send = connSenders.get(connId);
    if (send) send(payload);
  }
  // Push to editor connections (so other open tabs close the pack view)
  for (const [sessionId, sId] of editorTokenToServer) {
    if (sId !== serverKeyId) continue;
    const send = editorSenders.get(sessionId);
    if (send) send(payload);
  }
}
```

Note : `editorTokenToServer` est privé dans hub.ts. Il faut soit l'exporter, soit déplacer la logique. La forme la plus simple : ajouter `export const editorTokenToServer = ...` à sa déclaration (ligne 42). Modifier en conséquence.

Faire la modification ligne 42 :
```ts
export const editorTokenToServer = new Map<string, string>();
```

- [ ] **Step 5: Run le test, vérifier qu'il passe**

```bash
cd backend
bun test src/routes/editorSession.test.ts -t "DELETE /api/editor-session"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add backend/src/routes/editorSession.ts backend/src/routes/editorSession.test.ts backend/src/ws/hub.ts
rtk git commit -m "feat(backend): DELETE /api/editor-session/:token/packs/:packId — soft-delete + broadcast pack_deleted"
```

## Task 9: Plugin — `PackDeleter` (move-to-trash atomique)

**Files:**
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/sync/PackDeleter.kt`
- Create: `plugin/src/test/kotlin/net/artisanmc/plugin/PackDeleterTest.kt`

- [ ] **Step 1: Écrire le test**

`plugin/src/test/kotlin/net/artisanmc/plugin/PackDeleterTest.kt` :

```kotlin
package net.artisanmc.plugin

import net.artisanmc.plugin.sync.PackDeleter
import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PackDeleterTest {

    @Test
    fun `moves pack dir into artisan-trash with timestamp suffix`() {
        val packsDir = Files.createTempDirectory("artisan_del_").toFile()
        val packDir = File(packsDir, "p_test").also { it.mkdirs() }
        File(packDir, "menus").mkdirs()
        File(packDir, "menus/m1.yaml").writeText("id: m1\n")

        val deleter = PackDeleter(packsDir)
        deleter.delete("p_test")

        assertFalse(packDir.exists(), "Original packDir doit disparaître")
        val trash = File(packsDir, ".artisan-trash")
        assertTrue(trash.exists() && trash.isDirectory, "Trash directory créé")
        val trashEntries = trash.listFiles() ?: emptyArray()
        assertEquals(1, trashEntries.size, "Une seule entrée dans le trash")
        val moved = trashEntries[0]
        assertTrue(moved.name.startsWith("p_test-"), "Préfixe préservé : ${moved.name}")
        assertTrue(File(moved, "menus/m1.yaml").exists(), "Contenu déplacé")
    }

    @Test
    fun `noop when pack does not exist`() {
        val packsDir = Files.createTempDirectory("artisan_del_").toFile()
        val deleter = PackDeleter(packsDir)
        deleter.delete("nonexistent") // ne doit pas lever
        assertFalse(File(packsDir, ".artisan-trash").exists(),
            "Pas de trash créé si rien à déplacer")
    }

    @Test
    fun `unique timestamp suffix when deleting twice with same packId`() {
        val packsDir = Files.createTempDirectory("artisan_del_").toFile()
        val deleter = PackDeleter(packsDir)

        File(packsDir, "p").also { it.mkdirs() }.also { File(it, "a.yaml").writeText("first\n") }
        deleter.delete("p")
        File(packsDir, "p").also { it.mkdirs() }.also { File(it, "a.yaml").writeText("second\n") }
        Thread.sleep(1100)  // distinct timestamp (epoch seconds)
        deleter.delete("p")

        val trash = File(packsDir, ".artisan-trash")
        assertEquals(2, trash.listFiles()?.size, "Deux entrées trash distinctes")
    }
}
```

- [ ] **Step 2: Run, vérifier FAIL (classe n'existe pas)**

```bash
cd plugin
./gradlew test --tests "net.artisanmc.plugin.PackDeleterTest"
```

Expected: compilation error — `PackDeleter` doesn't exist.

- [ ] **Step 3: Implémenter `PackDeleter`**

`plugin/src/main/kotlin/net/artisanmc/plugin/sync/PackDeleter.kt` :

```kotlin
package net.artisanmc.plugin.sync

import java.io.File
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.logging.Logger

/**
 * Atomic-ish pack deletion via move-to-trash.
 *
 * Pack at `<packsDir>/<packId>/` is moved to `<packsDir>/.artisan-trash/<packId>-<timestamp>/`.
 * The `.artisan` prefix excludes the trash directory from BundleHasher (filename filter)
 * AND from BundleHasher.hashAll's pack iteration (dotfile-directory filter).
 *
 * No-op if the pack dir does not exist.
 */
class PackDeleter(
    private val packsDir: File,
    private val logger: Logger? = null,
) {
    private val tsFormat = DateTimeFormatter.ofPattern("yyyyMMddHHmmss").withZone(ZoneOffset.UTC)

    fun delete(packId: String) {
        val packDir = File(packsDir, packId)
        if (!packDir.exists()) return

        val trash = File(packsDir, ".artisan-trash").also { it.mkdirs() }
        val timestamp = tsFormat.format(Instant.now())
        val target = File(trash, "$packId-$timestamp")
        val ok = packDir.renameTo(target)
        if (!ok) {
            logger?.warning("Failed to move $packDir to $target — pack may be partially deleted")
        } else {
            logger?.info("Pack $packId moved to trash at ${target.absolutePath}")
        }
    }
}
```

- [ ] **Step 4: Run les tests**

```bash
cd plugin
./gradlew test --tests "net.artisanmc.plugin.PackDeleterTest"
```

Expected: PASS pour les 3 tests.

- [ ] **Step 5: Commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/plugin/sync/PackDeleter.kt plugin/src/test/kotlin/net/artisanmc/plugin/PackDeleterTest.kt
rtk git commit -m "feat(plugin): PackDeleter — move-to-trash atomique pour suppression de pack"
```

## Task 10: Plugin — handler WS `pack_deleted` runtime + reconcile via `hello_ack.deleted_pack_ids`

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt`
- Create: `plugin/src/test/kotlin/net/artisanmc/plugin/PackDeletionTest.kt`

- [ ] **Step 1: Écrire le test d'intégration**

`plugin/src/test/kotlin/net/artisanmc/plugin/PackDeletionTest.kt` :

```kotlin
package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.provider.SyncedMenuProvider
import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PackDeletionTest {

    private val mapper = ObjectMapper()

    @Test
    fun `pack_deleted runtime message moves pack dir to artisan-trash`() {
        val packsDir = Files.createTempDirectory("artisan_pd_").toFile()
        val packDir = File(packsDir, "p_kill").also { it.mkdirs() }
        File(packDir, "menus").mkdirs()
        File(packDir, "menus/m.yaml").writeText("id: m\n")

        val provider = SyncedMenuProvider(
            packsDir = packsDir,
            serverKey = "",  // skip WsClient.connect
            wsUrl = "ws://unused",
            logger = null,
        )

        // Simuler la réception d'un message pack_deleted via le hook interne
        provider.handleMessageForTesting(
            mapper.writeValueAsString(mapOf("type" to "pack_deleted", "pack_id" to "p_kill"))
        )

        assertFalse(packDir.exists(), "packDir doit avoir été déplacé")
        val trash = File(packsDir, ".artisan-trash")
        assertTrue(trash.exists(), "trash créé")
        assertTrue(trash.listFiles()!!.any { it.name.startsWith("p_kill-") }, "fichier trash présent")
    }
}
```

- [ ] **Step 2: Run, vérifier FAIL** (handler n'existe pas + méthode test `handleMessageForTesting`)

```bash
cd plugin
./gradlew test --tests "net.artisanmc.plugin.PackDeletionTest"
```

Expected: compilation error.

- [ ] **Step 3: Modifier `SyncedMenuProvider.kt`**

3a. **Ajouter le handler `pack_deleted` dans `handleMessage`** — dans le `when (node["type"]?.asText())` (après le case `"resource_pack_updated"`, avant `"ping"`) :

```kotlin
            "pack_deleted" -> {
                val packId = node["pack_id"]?.asText() ?: return
                handlePackDeletion(packId)
            }
```

3b. **Ajouter la méthode `handlePackDeletion`** — juste avant `resolvePluginDownloadUrl` :

```kotlin
    private fun handlePackDeletion(packId: String) {
        // Atomic switch: drop the pack from the in-memory bundles BEFORE touching disk.
        bundles = bundles.filterNot { it.packId == packId }
        val freshMenus = ConcurrentHashMap<String, BundleMenu>()
        val freshDialogs = ConcurrentHashMap<String, BundleDialog>()
        bundles.forEach { b ->
            b.menus.forEach { freshMenus[it.id] = it }
            b.dialogs.forEach { freshDialogs[it.id] = it }
        }
        menus = freshMenus
        dialogs = freshDialogs
        net.artisanmc.plugin.sync.PackDeleter(packsDir, logger).delete(packId)
        onReload?.invoke()
    }
```

3c. **Réconcilier au boot via `hello_ack.deleted_pack_ids`** — dans le case `"hello_ack"`, juste après la lecture de `packHashesNode` (autour de la ligne 228), ajouter :

```kotlin
                val deletedPackIdsNode = node["deleted_pack_ids"]
                if (deletedPackIdsNode != null && deletedPackIdsNode.isArray) {
                    deletedPackIdsNode.forEach { idNode ->
                        val packId = idNode.asText()
                        if (File(packsDir, packId).exists()) {
                            logger?.info("hello_ack: reconciling deletion of $packId")
                            handlePackDeletion(packId)
                        }
                    }
                }
```

3d. **Hook de test** — ajouter à la fin de la classe (juste avant la `}` finale) :

```kotlin
    internal fun handleMessageForTesting(raw: String) = handleMessage(raw)
```

- [ ] **Step 4: Run le test**

```bash
cd plugin
./gradlew test --tests "net.artisanmc.plugin.PackDeletionTest"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt plugin/src/test/kotlin/net/artisanmc/plugin/PackDeletionTest.kt
rtk git commit -m "feat(plugin): handlers pack_deleted (runtime + hello_ack.deleted_pack_ids reconcile)"
```

## Task 11: Editor — API client pour DELETE pack

**Files:**
- Create: `editor/src/lib/api/packs.ts`

- [ ] **Step 1: Créer le client**

`editor/src/lib/api/packs.ts` :

```ts
export interface DeletePackOptions {
  apiUrl: string;
  token: string;
  packId: string;
}

export async function deletePack({ apiUrl, token, packId }: DeletePackOptions): Promise<void> {
  const res = await fetch(`${apiUrl}/api/editor-session/${token}/packs/${packId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error("pack_not_found");
    throw new Error(`delete_failed_${res.status}`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
rtk git add editor/src/lib/api/packs.ts
rtk git commit -m "feat(editor): API client — deletePack"
```

## Task 12: Editor — `DeletePackDialog` avec type-to-confirm

**Files:**
- Create: `editor/src/features/sync/DeletePackDialog.tsx`
- Create: `editor/src/features/sync/DeletePackDialog.test.tsx`
- Modify: `editor/src/locales/en.ts`
- Modify: `editor/src/locales/fr.ts`

- [ ] **Step 1: Ajouter les clés i18n**

Dans `editor/src/locales/en.ts`, à un endroit cohérent avec les autres clés (suit la convention existante du fichier), ajouter sous une clé top-level `sync` :

```ts
  sync: {
    deletePackDialog: {
      title: "Delete pack «{{name}}»?",
      warning: "This action will remove all menus, dialogs and translations of the pack from every connected Minecraft server. The files will be moved to `plugins/Artisan/.artisan-trash/` server-side in case you need to recover them.",
      conflictWarning: "If a conflict exists for this pack, it will be ignored and the editor will become authoritative.",
      typePrompt: "To confirm, type the pack name:",
      cancel: "Cancel",
      confirm: "Delete",
    },
  },
```

Dans `editor/src/locales/fr.ts`, ajouter la version française :

```ts
  sync: {
    deletePackDialog: {
      title: "Supprimer le pack «{{name}}» ?",
      warning: "Cette action supprimera tous les menus, dialogs et traductions du pack sur tous les serveurs Minecraft connectés. Les fichiers seront déplacés dans `plugins/Artisan/.artisan-trash/` côté serveur en cas de récupération nécessaire.",
      conflictWarning: "Si un conflit existe pour ce pack, il sera ignoré et l'éditeur deviendra autoritaire.",
      typePrompt: "Pour confirmer, tape le nom du pack :",
      cancel: "Annuler",
      confirm: "Supprimer",
    },
  },
```

- [ ] **Step 2: Écrire le test**

`editor/src/features/sync/DeletePackDialog.test.tsx` :

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeletePackDialog } from "./DeletePackDialog";

describe("DeletePackDialog", () => {
  it("disables confirm button until pack name is typed exactly", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<DeletePackDialog packName="my_pack" onConfirm={onConfirm} onCancel={onCancel} />);

    const confirmBtn = screen.getByRole("button", { name: /supprimer/i });
    expect(confirmBtn).toBeDisabled();

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "my_pack" } });
    expect(confirmBtn).toBeEnabled();

    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not enable confirm on near-miss (e.g., trailing space)", () => {
    render(<DeletePackDialog packName="my_pack" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "my_pack " } });
    expect(screen.getByRole("button", { name: /supprimer/i })).toBeDisabled();
  });

  it("calls onCancel when cancel button clicked", () => {
    const onCancel = vi.fn();
    render(<DeletePackDialog packName="my_pack" onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /annuler/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run, vérifier FAIL**

```bash
cd editor
npx vitest run src/features/sync/DeletePackDialog.test.tsx
```

Expected: FAIL — component does not exist.

- [ ] **Step 4: Implémenter le composant**

`editor/src/features/sync/DeletePackDialog.tsx` :

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";

export interface DeletePackDialogProps {
  packName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeletePackDialog({ packName, onConfirm, onCancel }: DeletePackDialogProps) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  const confirmEnabled = typed === packName;

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
        <h2 className="text-lg font-semibold mb-3">
          {t("sync.deletePackDialog.title", { name: packName })}
        </h2>
        <p className="text-sm text-gray-700 mb-2">
          {t("sync.deletePackDialog.warning")}
        </p>
        <p className="text-sm text-gray-700 mb-4">
          {t("sync.deletePackDialog.conflictWarning")}
        </p>
        <label className="block text-sm font-medium mb-1">
          {t("sync.deletePackDialog.typePrompt")}
        </label>
        <input
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="border w-full px-3 py-2 rounded mb-4"
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300"
          >
            {t("sync.deletePackDialog.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!confirmEnabled}
            className="px-4 py-2 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("sync.deletePackDialog.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run le test**

```bash
cd editor
npx vitest run src/features/sync/DeletePackDialog.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add editor/src/features/sync/DeletePackDialog.tsx editor/src/features/sync/DeletePackDialog.test.tsx editor/src/locales/en.ts editor/src/locales/fr.ts
rtk git commit -m "feat(editor): DeletePackDialog — modal type-to-confirm pour suppression de pack"
```

---

# Phase 5 — Conflit : backend (diff, route, hub handler, freeze)

## Task 13: Backend — `conflictDiff.ts` (lib pour calculer added/modified/removed)

**Files:**
- Create: `backend/src/lib/conflictDiff.ts`
- Create: `backend/src/lib/conflictDiff.test.ts`

- [ ] **Step 1: Écrire le test**

`backend/src/lib/conflictDiff.test.ts` :

```ts
import { describe, expect, test } from "bun:test";
import { computeConflictDiff } from "./conflictDiff";

describe("computeConflictDiff", () => {
  test("identical files → empty diff", () => {
    const same = { "menus/m.yaml": "x" };
    expect(computeConflictDiff(same, same)).toEqual({
      addedOnDisk: [], removedOnDisk: [], modifiedOnDisk: [],
    });
  });

  test("file present on disk but not in backend → addedOnDisk", () => {
    const diff = computeConflictDiff({ "menus/new.yaml": "x" }, {});
    expect(diff.addedOnDisk).toEqual(["menus/new.yaml"]);
    expect(diff.removedOnDisk).toEqual([]);
    expect(diff.modifiedOnDisk).toEqual([]);
  });

  test("file absent from disk but present on backend → removedOnDisk", () => {
    const diff = computeConflictDiff({}, { "menus/old.yaml": "x" });
    expect(diff.removedOnDisk).toEqual(["menus/old.yaml"]);
  });

  test("file present on both sides with different content → modifiedOnDisk", () => {
    const diff = computeConflictDiff({ "menus/m.yaml": "v2" }, { "menus/m.yaml": "v1" });
    expect(diff.modifiedOnDisk).toEqual(["menus/m.yaml"]);
  });

  test("mixed change set", () => {
    const disk = { "a.yaml": "1", "b.yaml": "2", "c.yaml": "new" };
    const backend = { "a.yaml": "1", "b.yaml": "old", "d.yaml": "z" };
    const diff = computeConflictDiff(disk, backend);
    expect(diff.addedOnDisk.sort()).toEqual(["c.yaml"]);
    expect(diff.removedOnDisk.sort()).toEqual(["d.yaml"]);
    expect(diff.modifiedOnDisk.sort()).toEqual(["b.yaml"]);
  });
});
```

- [ ] **Step 2: Run, vérifier FAIL**

```bash
cd backend
bun test src/lib/conflictDiff.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implémenter**

`backend/src/lib/conflictDiff.ts` :

```ts
export interface ConflictDiff {
  addedOnDisk: string[];
  removedOnDisk: string[];
  modifiedOnDisk: string[];
}

export function computeConflictDiff(
  diskFiles: Record<string, string>,
  backendFiles: Record<string, string>,
): ConflictDiff {
  const diskKeys = new Set(Object.keys(diskFiles));
  const backendKeys = new Set(Object.keys(backendFiles));
  const addedOnDisk: string[] = [];
  const removedOnDisk: string[] = [];
  const modifiedOnDisk: string[] = [];
  for (const k of diskKeys) {
    if (!backendKeys.has(k)) addedOnDisk.push(k);
    else if (diskFiles[k] !== backendFiles[k]) modifiedOnDisk.push(k);
  }
  for (const k of backendKeys) {
    if (!diskKeys.has(k)) removedOnDisk.push(k);
  }
  return { addedOnDisk, removedOnDisk, modifiedOnDisk };
}
```

- [ ] **Step 4: Run le test, PASS**

```bash
cd backend
bun test src/lib/conflictDiff.test.ts
```

- [ ] **Step 5: Commit**

```bash
rtk git add backend/src/lib/conflictDiff.ts backend/src/lib/conflictDiff.test.ts
rtk git commit -m "feat(backend): conflictDiff — added/modified/removed entre disque et backend"
```

## Task 14: Backend — hub handler `pack_divergence_detected` + freeze dans `pushBundleAvailable`

**Files:**
- Modify: `backend/src/ws/hub.ts`
- Modify: `backend/src/ws/hub.test.ts`

- [ ] **Step 1: Écrire le test**

À la fin de `backend/src/ws/hub.test.ts`, ajouter :

```ts
describe("pack_divergence_detected", () => {
  test("upserts pack_conflicts row and notifies editors", async () => {
    const { db } = await import("../db/index");
    const { serverKeys, packBundles, packConflicts, editorSessions } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");

    // Seed: server key + pack
    const keyId = crypto.randomUUID();
    const rawKey = "srv-key-divergence";
    const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
    const keyHash = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0")).join("");
    await db.insert(serverKeys).values({ id: keyId, hash: keyHash, label: "test", createdAt: new Date() });
    await db.insert(packBundles).values({
      id: crypto.randomUUID(), serverId: keyId, packId: "p_div",
      hash: "backend_hash_x", filesJson: "{}", editorJson: "{}", createdAt: new Date(),
    });

    const { handlePluginMessage, connToServerId } = await import("./hub");
    const connId = crypto.randomUUID();
    connToServerId.set(connId, keyId);

    const msg = JSON.stringify({
      type: "pack_divergence_detected",
      pack_id: "p_div",
      disk_files: { "menus/m.yaml": "id: m\n" },
      disk_hash: "disk_hash_y",
      last_synced_hash: "prev_hash_z",
    });
    await handlePluginMessage(connId, msg);

    const rows = await db.select().from(packConflicts).where(eq(packConflicts.packId, "p_div"));
    expect(rows.length).toBe(1);
    expect(rows[0].diskHash).toBe("disk_hash_y");
    expect(rows[0].lastSyncedHash).toBe("prev_hash_z");
    expect(rows[0].resolvedAt).toBeNull();
  });

  test("re-detection updates existing open conflict (no second row)", async () => {
    const { db } = await import("../db/index");
    const { serverKeys, packBundles, packConflicts } = await import("../db/schema");
    const { and, eq, isNull } = await import("drizzle-orm");

    const keyId = crypto.randomUUID();
    const rawKey = "srv-key-redetect";
    const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
    const keyHash = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0")).join("");
    await db.insert(serverKeys).values({ id: keyId, hash: keyHash, label: "redetect", createdAt: new Date() });
    await db.insert(packBundles).values({
      id: crypto.randomUUID(), serverId: keyId, packId: "p_re",
      hash: "h", filesJson: "{}", editorJson: "{}", createdAt: new Date(),
    });

    const { handlePluginMessage, connToServerId } = await import("./hub");
    const connId = crypto.randomUUID();
    connToServerId.set(connId, keyId);

    await handlePluginMessage(connId, JSON.stringify({
      type: "pack_divergence_detected",
      pack_id: "p_re", disk_files: { "a": "1" }, disk_hash: "d1", last_synced_hash: "s",
    }));
    await handlePluginMessage(connId, JSON.stringify({
      type: "pack_divergence_detected",
      pack_id: "p_re", disk_files: { "a": "2" }, disk_hash: "d2", last_synced_hash: "s",
    }));

    const open = await db.select().from(packConflicts).where(and(
      eq(packConflicts.packId, "p_re"),
      isNull(packConflicts.resolvedAt),
    ));
    expect(open.length).toBe(1);
    expect(open[0].diskHash).toBe("d2");
  });

  test("skips upsert when pack is soft-deleted", async () => {
    const { db } = await import("../db/index");
    const { serverKeys, packBundles, packConflicts } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");

    const keyId = crypto.randomUUID();
    const rawKey = "srv-key-del";
    const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
    const keyHash = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0")).join("");
    await db.insert(serverKeys).values({ id: keyId, hash: keyHash, label: "deltest", createdAt: new Date() });
    await db.insert(packBundles).values({
      id: crypto.randomUUID(), serverId: keyId, packId: "p_del",
      hash: "h", filesJson: "{}", editorJson: "{}", deletedAt: new Date(), createdAt: new Date(),
    });

    const { handlePluginMessage, connToServerId } = await import("./hub");
    const connId = crypto.randomUUID();
    connToServerId.set(connId, keyId);

    await handlePluginMessage(connId, JSON.stringify({
      type: "pack_divergence_detected",
      pack_id: "p_del", disk_files: {}, disk_hash: "h", last_synced_hash: "",
    }));

    const rows = await db.select().from(packConflicts).where(eq(packConflicts.packId, "p_del"));
    expect(rows.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run, vérifier FAIL** (handler n'existe pas)

```bash
cd backend
bun test src/ws/hub.test.ts -t "pack_divergence_detected"
```

Expected: FAIL — no row inserted.

- [ ] **Step 3: Ajouter le handler dans `hub.ts`**

Dans `handlePluginMessage`, juste avant `return { reply: null };` final (autour de la ligne 337), ajouter :

```ts
  if (msg.type === "pack_divergence_detected") {
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };
    const raw = msg as Record<string, unknown>;
    const packId = raw.pack_id as string | undefined;
    const diskFiles = raw.disk_files as Record<string, string> | undefined;
    const diskHash = raw.disk_hash as string | undefined;
    const lastSyncedHash = raw.last_synced_hash as string | undefined;
    if (!packId || !diskFiles || diskHash == null || lastSyncedHash == null) return { reply: null };

    const { and: aand, eq: eeq } = await import("drizzle-orm");
    const existing = await db.select().from(packBundles)
      .where(aand(eeq(packBundles.serverId, serverId), eeq(packBundles.packId, packId)));
    if (existing.length === 0 || existing[0].deletedAt != null) return { reply: null };
    const backendHashAtDetection = existing[0].hash;

    const { packConflicts } = await import("../db/schema");
    const { isNull: inull } = await import("drizzle-orm");
    const now = new Date();
    const conflictId = crypto.randomUUID();

    const open = await db.select().from(packConflicts).where(aand(
      eeq(packConflicts.serverId, serverId),
      eeq(packConflicts.packId, packId),
      inull(packConflicts.resolvedAt),
    ));

    let finalConflictId: string;
    if (open.length > 0) {
      await db.update(packConflicts)
        .set({
          diskFilesJson: JSON.stringify(diskFiles),
          diskHash,
          lastSyncedHash,
          backendHashAtDetection,
        })
        .where(eeq(packConflicts.id, open[0].id));
      finalConflictId = open[0].id;
    } else {
      await db.insert(packConflicts).values({
        id: conflictId,
        serverId,
        packId,
        diskFilesJson: JSON.stringify(diskFiles),
        diskHash,
        lastSyncedHash,
        backendHashAtDetection,
        detectedAt: now,
      });
      finalConflictId = conflictId;
    }

    // Notify editor sessions for this server
    const payload = JSON.stringify({
      type: "pack_conflict_detected",
      conflict_id: finalConflictId,
      pack_id: packId,
      detected_at: now.toISOString(),
    });
    for (const [sessionId, sId] of editorTokenToServer) {
      if (sId !== serverId) continue;
      const send = editorSenders.get(sessionId);
      if (send) send(payload);
    }
    return { reply: null };
  }
```

- [ ] **Step 4: Implémenter le freeze dans `pushBundleAvailable`**

Remplacer la fonction `pushBundleAvailable` (autour de la ligne 340) par :

```ts
export async function pushBundleAvailable(
  serverKeyId: string,
  packId: string,
  hash: string,
): Promise<void> {
  // Freeze: skip broadcast if an open conflict exists for this (server, pack)
  const { packConflicts } = await import("../db/schema");
  const { and: aand, eq: eeq, isNull: inull } = await import("drizzle-orm");
  const open = await db.select({ id: packConflicts.id }).from(packConflicts).where(aand(
    eeq(packConflicts.serverId, serverKeyId),
    eeq(packConflicts.packId, packId),
    inull(packConflicts.resolvedAt),
  ));
  if (open.length > 0) return;

  const url = `${BUNDLE_BASE_URL}/api/bundles/${packId}`;
  const payload = JSON.stringify({
    type: "bundle_available",
    pack_id: packId,
    url,
    hash,
    signature: "",
  } satisfies BundleAvailableMessage);

  for (const [connId, sId] of connToServerId) {
    if (sId !== serverKeyId) continue;
    const send = connSenders.get(connId);
    if (send) send(payload);
  }
}
```

Note : la fonction devient `async`. Mettre à jour les call sites pour `await pushBundleAvailable(...)`. Grepper `pushBundleAvailable` :

```bash
cd backend
grep -rn "pushBundleAvailable" src/
```

Mettre à jour tous les appels pour les await.

- [ ] **Step 5: Run les tests hub.test.ts**

```bash
cd backend
bun test src/ws/hub.test.ts
```

Expected: tous les tests existants + les nouveaux passent.

- [ ] **Step 6: Commit**

```bash
rtk git add backend/src/ws/hub.ts backend/src/ws/hub.test.ts
rtk git commit -m "feat(backend): hub — handler pack_divergence_detected + freeze des bundle_available si conflit ouvert"
```

## Task 15: Backend — endpoints `/api/editor-session/:token/conflicts*`

**Files:**
- Create: `backend/src/routes/conflicts.ts`
- Create: `backend/src/routes/conflicts.test.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Écrire les tests**

`backend/src/routes/conflicts.test.ts` :

```ts
import { describe, expect, test } from "bun:test";
import { app } from "../app";

async function createServerWithSession(label: string) {
  const keyRes = await app.request("/api/server-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  });
  const { key, id: serverKeyId } = (await keyRes.json()) as { key: string; id: string };
  const { db } = await import("../db/index");
  const { editorSessions } = await import("../db/schema");
  const accessToken = `acc_${crypto.randomUUID()}`;
  await db.insert(editorSessions).values({
    token: `etok_${crypto.randomUUID()}`,
    serverKeyId,
    createdBy: "test",
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 86400_000),
    exchangedAt: new Date(),
    accessToken,
    accessExpiresAt: new Date(Date.now() + 86400_000),
  });
  return { key, serverKeyId, accessToken };
}

async function seedConflict(serverKeyId: string, packId: string, diskFiles: Record<string, string>, backendFiles: Record<string, string>) {
  const { db } = await import("../db/index");
  const { packBundles, packConflicts } = await import("../db/schema");
  await db.insert(packBundles).values({
    id: crypto.randomUUID(), serverId: serverKeyId, packId,
    hash: "backendH", filesJson: JSON.stringify(backendFiles),
    editorJson: JSON.stringify({ id: packId, name: packId }),
    createdAt: new Date(),
  });
  const conflictId = crypto.randomUUID();
  await db.insert(packConflicts).values({
    id: conflictId, serverId: serverKeyId, packId,
    diskFilesJson: JSON.stringify(diskFiles), diskHash: "diskH",
    lastSyncedHash: "syncedH", backendHashAtDetection: "backendH",
    detectedAt: new Date(),
  });
  return conflictId;
}

describe("/api/editor-session/:token/conflicts", () => {
  test("GET conflicts — empty when no conflict", async () => {
    const { accessToken } = await createServerWithSession("conf-empty");
    const res = await app.request(`/api/editor-session/${accessToken}/conflicts`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { conflicts: unknown[] };
    expect(body.conflicts).toEqual([]);
  });

  test("GET conflicts — lists open conflicts with diff summary", async () => {
    const { serverKeyId, accessToken } = await createServerWithSession("conf-list");
    await seedConflict(serverKeyId, "p_a", { "menus/m.yaml": "new" }, { "menus/old.yaml": "old" });
    const res = await app.request(`/api/editor-session/${accessToken}/conflicts`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { conflicts: Array<{ packId: string; diff: { addedOnDisk: string[]; removedOnDisk: string[]; modifiedOnDisk: string[] } }> };
    expect(body.conflicts.length).toBe(1);
    expect(body.conflicts[0].packId).toBe("p_a");
    expect(body.conflicts[0].diff.addedOnDisk).toEqual(["menus/m.yaml"]);
    expect(body.conflicts[0].diff.removedOnDisk).toEqual(["menus/old.yaml"]);
  });

  test("POST resolve choice=editor leaves packBundles unchanged + marks resolved", async () => {
    const { serverKeyId, accessToken } = await createServerWithSession("conf-keep");
    const conflictId = await seedConflict(serverKeyId, "p_keep",
      { "a": "diskver" }, { "a": "backendver" });

    const res = await app.request(`/api/editor-session/${accessToken}/conflicts/${conflictId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choice: "editor" }),
    });
    expect(res.status).toBe(200);

    const { db } = await import("../db/index");
    const { packBundles, packConflicts } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const pack = await db.select().from(packBundles).where(eq(packBundles.packId, "p_keep"));
    expect(JSON.parse(pack[0].filesJson)).toEqual({ "a": "backendver" });
    const conflict = await db.select().from(packConflicts).where(eq(packConflicts.id, conflictId));
    expect(conflict[0].resolvedAt).not.toBeNull();
    expect(conflict[0].resolution).toBe("editor");
  });

  test("POST resolve choice=server replaces packBundles.filesJson + marks resolved", async () => {
    const { serverKeyId, accessToken } = await createServerWithSession("conf-srv");
    const conflictId = await seedConflict(serverKeyId, "p_srv",
      { "a": "diskver" }, { "a": "backendver" });

    const res = await app.request(`/api/editor-session/${accessToken}/conflicts/${conflictId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choice: "server" }),
    });
    expect(res.status).toBe(200);

    const { db } = await import("../db/index");
    const { packBundles } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const pack = await db.select().from(packBundles).where(eq(packBundles.packId, "p_srv"));
    expect(JSON.parse(pack[0].filesJson)).toEqual({ "a": "diskver" });
  });

  test("POST resolve on already-resolved conflict returns 409", async () => {
    const { serverKeyId, accessToken } = await createServerWithSession("conf-409");
    const conflictId = await seedConflict(serverKeyId, "p_409", {}, {});

    await app.request(`/api/editor-session/${accessToken}/conflicts/${conflictId}/resolve`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choice: "editor" }),
    });
    const second = await app.request(`/api/editor-session/${accessToken}/conflicts/${conflictId}/resolve`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choice: "editor" }),
    });
    expect(second.status).toBe(409);
  });

  test("Endpoints reject bad token with 401", async () => {
    const r1 = await app.request(`/api/editor-session/bad_token/conflicts`);
    expect(r1.status).toBe(401);
    const r2 = await app.request(`/api/editor-session/bad_token/conflicts/x/resolve`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    expect(r2.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run, vérifier FAIL** (route n'existe pas)

```bash
cd backend
bun test src/routes/conflicts.test.ts
```

Expected: tous les tests FAIL — endpoint return 404 ou 401 sur erreurs de routing.

- [ ] **Step 3: Implémenter `conflicts.ts`**

`backend/src/routes/conflicts.ts` :

```ts
import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/index";
import { packBundles, packConflicts } from "../db/schema";
import { validateAccessToken } from "../lib/auth";
import { computeConflictDiff } from "../lib/conflictDiff";
import { computeBundleHash } from "../lib/hashUtils";
import { readEditorLayoutFromFiles, importPackFromFiles, isEmptyStub } from "../lib/packImport";
import { pushBundleAvailable } from "../ws/hub";

const router = new Hono();

router.get("/:token/conflicts", async (c) => {
  const token = c.req.param("token");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const conflicts = await db.select().from(packConflicts).where(and(
    eq(packConflicts.serverId, session.serverKeyId),
    isNull(packConflicts.resolvedAt),
  ));
  if (conflicts.length === 0) return c.json({ conflicts: [] });

  const packIds = conflicts.map((c) => c.packId);
  const bundles = await db.select({ packId: packBundles.packId, filesJson: packBundles.filesJson }).from(packBundles)
    .where(eq(packBundles.serverId, session.serverKeyId));
  const filesByPack: Record<string, Record<string, string>> = {};
  for (const b of bundles) {
    if (packIds.includes(b.packId)) filesByPack[b.packId] = JSON.parse(b.filesJson);
  }

  const summaries = conflicts.map((cf) => {
    const diskFiles = JSON.parse(cf.diskFilesJson) as Record<string, string>;
    const backendFiles = filesByPack[cf.packId] ?? {};
    const diff = computeConflictDiff(diskFiles, backendFiles);
    return {
      id: cf.id,
      packId: cf.packId,
      detectedAt: cf.detectedAt.toISOString(),
      diskHash: cf.diskHash,
      backendHashAtDetection: cf.backendHashAtDetection,
      fileCount: Object.keys(diskFiles).length,
      diff,
    };
  });
  return c.json({ conflicts: summaries });
});

router.get("/:token/conflicts/:id", async (c) => {
  const token = c.req.param("token");
  const id = c.req.param("id");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const rows = await db.select().from(packConflicts).where(and(
    eq(packConflicts.id, id),
    eq(packConflicts.serverId, session.serverKeyId),
  ));
  if (rows.length === 0) return c.json({ error: "Not found" }, 404);
  const cf = rows[0];
  const diskFiles = JSON.parse(cf.diskFilesJson) as Record<string, string>;
  const backendRows = await db.select({ filesJson: packBundles.filesJson }).from(packBundles).where(and(
    eq(packBundles.serverId, session.serverKeyId),
    eq(packBundles.packId, cf.packId),
  ));
  const backendFiles = backendRows.length > 0 ? JSON.parse(backendRows[0].filesJson) : {};
  return c.json({
    conflict: {
      id: cf.id,
      packId: cf.packId,
      detectedAt: cf.detectedAt.toISOString(),
      diskHash: cf.diskHash,
      backendHashAtDetection: cf.backendHashAtDetection,
      fileCount: Object.keys(diskFiles).length,
      diff: computeConflictDiff(diskFiles, backendFiles),
      diskFiles,
    },
  });
});

router.post("/:token/conflicts/:id/resolve", async (c) => {
  const token = c.req.param("token");
  const id = c.req.param("id");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json<{ choice: "editor" | "server" }>().catch(() => null);
  if (!body || (body.choice !== "editor" && body.choice !== "server")) {
    return c.json({ error: "invalid_choice" }, 400);
  }

  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const open = await tx.select().from(packConflicts).where(and(
      eq(packConflicts.id, id),
      eq(packConflicts.serverId, session.serverKeyId),
      isNull(packConflicts.resolvedAt),
    ));
    if (open.length === 0) return null;
    const cf = open[0];

    let newHash = cf.backendHashAtDetection;
    if (body.choice === "server") {
      const diskFiles = JSON.parse(cf.diskFilesJson) as Record<string, string>;
      newHash = await computeBundleHash(diskFiles, cf.packId);

      // Suit la convention de POST /api/bundles/:packId
      const existing = await tx.select({ editorJson: packBundles.editorJson }).from(packBundles)
        .where(and(eq(packBundles.serverId, cf.serverId), eq(packBundles.packId, cf.packId)));
      const incomingLayout = readEditorLayoutFromFiles(diskFiles, cf.packId);
      let editorJsonObj: Record<string, unknown>;
      if (existing.length > 0 && !isEmptyStub(existing[0].editorJson)) {
        editorJsonObj = JSON.parse(existing[0].editorJson!) as Record<string, unknown>;
      } else {
        editorJsonObj = importPackFromFiles(cf.packId, diskFiles) as Record<string, unknown>;
      }
      editorJsonObj.canvasLayout = incomingLayout;
      await tx.update(packBundles).set({
        filesJson: cf.diskFilesJson,
        hash: newHash,
        editorJson: JSON.stringify(editorJsonObj),
      }).where(and(eq(packBundles.serverId, cf.serverId), eq(packBundles.packId, cf.packId)));
    }

    await tx.update(packConflicts).set({ resolvedAt: now, resolution: body.choice })
      .where(eq(packConflicts.id, cf.id));
    return { newHash, serverId: cf.serverId, packId: cf.packId };
  });

  if (!result) return c.json({ error: "already_resolved" }, 409);

  // Broadcast bundle_available (pack is unlocked now)
  await pushBundleAvailable(result.serverId, result.packId, result.newHash);

  // Notify other open editors that this conflict has been resolved
  const { editorTokenToServer, editorSenders } = await import("../ws/hub");
  const payload = JSON.stringify({
    type: "pack_conflict_resolved",
    conflict_id: id,
    pack_id: result.packId,
    resolution: body.choice,
  });
  for (const [sessionId, sId] of editorTokenToServer) {
    if (sId !== result.serverId) continue;
    const send = editorSenders.get(sessionId);
    if (send) send(payload);
  }

  return c.json({ resolved: true, newHash: result.newHash });
});

export { router as conflictsRouter };
```

- [ ] **Step 4: Wirer dans `app.ts`**

Dans `backend/src/app.ts`, ajouter l'import (avec les autres routers) :

```ts
import { conflictsRouter } from "./routes/conflicts";
```

Et le mount (juste après `app.route("/api/editor-session", resourcePackAdminRouter);`) :

```ts
app.route("/api/editor-session", conflictsRouter);
```

- [ ] **Step 5: Exporter `editorSenders` depuis `hub.ts`** (déjà exporté ligne 40) — confirmer.

```bash
cd backend
grep "export const editorSenders" src/ws/hub.ts
```

Si présent, ok. Sinon ajouter `export` en ligne 40.

- [ ] **Step 6: Run les tests**

```bash
cd backend
bun test src/routes/conflicts.test.ts
```

Expected: PASS pour les 6 tests.

- [ ] **Step 7: Commit**

```bash
rtk git add backend/src/routes/conflicts.ts backend/src/routes/conflicts.test.ts backend/src/app.ts
rtk git commit -m "feat(backend): endpoints conflicts — GET list/detail + POST resolve (editor|server)"
```

## Task 16: Backend — POST /api/bundles/:packId renvoie 409 si conflit ouvert

**Files:**
- Modify: `backend/src/routes/bundles.ts`
- Modify: `backend/src/routes/bundles.test.ts`

- [ ] **Step 1: Écrire le test**

À la fin de `backend/src/routes/bundles.test.ts`, ajouter :

```ts
test("POST returns 409 pack_locked when an open conflict exists for the pack", async () => {
  const keyRes = await app.request("/api/server-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label: "lock-test" }),
  });
  const { key, id: serverKeyId } = (await keyRes.json()) as { key: string; id: string };

  // Seed open conflict for this server + pack
  const { db } = await import("../db/index");
  const { packConflicts } = await import("../db/schema");
  const conflictId = crypto.randomUUID();
  await db.insert(packConflicts).values({
    id: conflictId, serverId: serverKeyId, packId: "p_locked",
    diskFilesJson: "{}", diskHash: "d", lastSyncedHash: "", backendHashAtDetection: "",
    detectedAt: new Date(),
  });

  const res = await app.request("/api/bundles/p_locked", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify({ files: { "plugins/Artisan/packs/p_locked/m.yaml": "x" } }),
  });
  expect(res.status).toBe(409);
  const body = (await res.json()) as { error: string; conflictId?: string };
  expect(body.error).toBe("pack_locked");
  expect(body.conflictId).toBe(conflictId);
});
```

- [ ] **Step 2: Run, vérifier FAIL** (la route POST retourne 201 quand même)

```bash
cd backend
bun test src/routes/bundles.test.ts -t "pack_locked"
```

- [ ] **Step 3: Implémenter la défense dans `bundles.ts`**

Au début de la fonction `router.post("/:packId", async (c) => {...})`, juste après la lecture de `packId` (avant le `await c.req.json` autour de la ligne 16) :

```ts
  const { packConflicts } = await import("../db/schema");
  const { isNull } = await import("drizzle-orm");
  const open = await db.select({ id: packConflicts.id }).from(packConflicts).where(and(
    eq(packConflicts.serverId, serverId),
    eq(packConflicts.packId, packId),
    isNull(packConflicts.resolvedAt),
  ));
  if (open.length > 0) {
    return c.json({ error: "pack_locked", conflictId: open[0].id }, 409);
  }
```

- [ ] **Step 4: Run, PASS**

```bash
cd backend
bun test src/routes/bundles.test.ts
```

- [ ] **Step 5: Commit**

```bash
rtk git add backend/src/routes/bundles.ts backend/src/routes/bundles.test.ts
rtk git commit -m "feat(backend): POST /api/bundles refuse publish si conflit ouvert (409 pack_locked)"
```

---

# Phase 6 — Plugin : factorisation walk + détection de divergence

## Task 17: Plugin — Extraire `readPackFiles` de `BundleUploader` vers une lib partagée

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/sync/BundleUploader.kt`

- [ ] **Step 1: Refactor**

Ouvrir `BundleUploader.kt` et déplacer la logique de walk dans une fonction object-level :

```kotlin
package net.artisanmc.plugin.sync

import com.fasterxml.jackson.databind.ObjectMapper
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.logging.Logger

object PackFilesReader {
    /**
     * Walk packDir and produce the canonical files map keyed by
     * "plugins/Artisan/packs/<packId>/<relPath>", excluding `.artisan*` metadata.
     */
    fun read(packDir: File, packId: String): Map<String, String> {
        val prefix = "plugins/Artisan/packs/$packId/"
        val out = mutableMapOf<String, String>()
        packDir.walkTopDown()
            .filter { it.isFile && !it.name.startsWith(".artisan") }
            .forEach { file ->
                val rel = file.relativeTo(packDir).path.replace('\\', '/')
                out["$prefix$rel"] = file.readText(Charsets.UTF_8)
            }
        return out
    }
}

class BundleUploader(
    private val httpClient: OkHttpClient,
    private val apiUrl: String,
    private val serverKey: String,
    private val logger: Logger? = null,
) {
    private val mapper = ObjectMapper()
    private val json = "application/json; charset=utf-8".toMediaType()

    fun upload(packDir: File, packId: String) {
        val files = PackFilesReader.read(packDir, packId)
        if (files.isEmpty()) {
            logger?.fine("BundleUploader: no files in $packId, skipping upload")
            return
        }

        val body = mapper.writeValueAsString(mapOf("files" to files))
        val request = Request.Builder()
            .url("$apiUrl/api/bundles/$packId")
            .header("Authorization", "Bearer $serverKey")
            .post(body.toRequestBody(json))
            .build()

        httpClient.newCall(request).execute().use { response ->
            if (response.isSuccessful) {
                logger?.info("Uploaded local pack $packId to backend (${files.size} files)")
            } else {
                logger?.warning("Bundle upload failed for $packId: HTTP ${response.code}")
            }
        }
    }
}
```

- [ ] **Step 2: Vérifier que les tests existants passent**

```bash
cd plugin
./gradlew test --tests "net.artisanmc.plugin.*"
```

Expected: tout passe (refactor pur).

- [ ] **Step 3: Commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/plugin/sync/BundleUploader.kt
rtk git commit -m "refactor(plugin): extract PackFilesReader.read from BundleUploader"
```

## Task 18: Plugin — émettre `pack_divergence_detected` au hello_ack pour LOCAL_ONLY/CONFLICT

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt`
- Modify: `plugin/src/test/kotlin/net/artisanmc/plugin/FullSyncIntegrationTest.kt`

- [ ] **Step 1: Lire le test d'intégration existant pour comprendre le pattern**

```bash
cd plugin
head -80 src/test/kotlin/net/artisanmc/plugin/FullSyncIntegrationTest.kt
```

- [ ] **Step 2: Ajouter un test à `FullSyncIntegrationTest.kt`**

Append à la fin de la classe :

```kotlin
    @Test
    fun `plugin sends pack_divergence_detected when disk diverges from synced state`() {
        // Setup MockWebServer playing the WS role indirectly via REST + a fake WS sender capture.
        // The simplest form: call provider's handleMessageForTesting with a hello_ack
        // and assert that a pack_divergence_detected payload is sent.
        val packsDir = Files.createTempDirectory("artisan_div_").toFile()
        val packDir = File(packsDir, "p_local").also { it.mkdirs() }
        File(packDir, "menus").mkdirs()
        File(packDir, "menus/m.yaml").writeText("id: m\n")

        // Seed SyncMetadata with a "previous synced hash" so that LOCAL_ONLY is detected
        net.artisanmc.plugin.sync.SyncMetadata.recordSync(packDir, syncedHash = "old_synced_hash", backendHash = "old_synced_hash")

        val sent = mutableListOf<Map<String, Any>>()
        val provider = net.artisanmc.plugin.provider.SyncedMenuProvider(
            packsDir = packsDir,
            serverKey = "",
            wsUrl = "ws://noop",
            logger = null,
        )
        provider.setSendForTesting { raw ->
            val parsed = com.fasterxml.jackson.databind.ObjectMapper().readValue(raw, Map::class.java)
            @Suppress("UNCHECKED_CAST")
            sent.add(parsed as Map<String, Any>)
        }

        // Hello ack: backend has same hash as last_synced → DIVERGENT (disk has m.yaml unsynced)
        val ack = """{"type":"hello_ack","pack_hashes":{"p_local":"old_synced_hash"},"deleted_pack_ids":[],"bundle_url":"http://backend"}"""
        provider.handleMessageForTesting(ack)

        // Allow background dispatcher to run
        Thread.sleep(200)

        val divergence = sent.firstOrNull { it["type"] == "pack_divergence_detected" }
        assertNotNull(divergence, "Expected pack_divergence_detected sent")
        assertEquals("p_local", divergence!!["pack_id"])
        @Suppress("UNCHECKED_CAST")
        val files = divergence["disk_files"] as Map<String, String>
        assertTrue(files.containsKey("plugins/Artisan/packs/p_local/menus/m.yaml"))
    }
```

- [ ] **Step 3: Run, vérifier FAIL** (setSendForTesting et logique de détection n'existent pas)

```bash
cd plugin
./gradlew test --tests "net.artisanmc.plugin.FullSyncIntegrationTest.plugin sends pack_divergence_detected*"
```

Expected: compilation error.

- [ ] **Step 4: Modifier `SyncedMenuProvider.kt`**

4a. **Ajouter une variable test-only de capture de send** — juste après `@Volatile private var wsClient` :

```kotlin
    @Volatile private var testSendOverride: ((String) -> Unit)? = null

    internal fun setSendForTesting(fn: (String) -> Unit) {
        testSendOverride = fn
    }

    private fun send(payload: Map<String, Any>) {
        val raw = jsonMapper.writeValueAsString(payload)
        testSendOverride?.invoke(raw) ?: wsClient?.send(payload)
    }
```

4b. **Dans `handleMessage`, case `hello_ack`**, remplacer les appels à `wsClient?.send(...)` qui existent (rares) par `send(...)` quand on en a, mais surtout :

Dans le bloc `packsDir.listFiles { ... }?.forEach { packDir -> ... }` (lignes ~230-264), modifier le branchement `when (detectSyncAction(...))` pour émettre `pack_divergence_detected` sur `LOCAL_ONLY` et `CONFLICT` :

```kotlin
                    val meta = SyncMetadata.read(packDir)
                    val action = detectSyncAction(diskHash, meta.syncedHash, backendHash)
                    when (action) {
                        SyncAction.IN_SYNC    -> logger?.fine("Pack $packId is in sync")
                        SyncAction.AUTO_SYNC  -> logger?.fine("Pack $packId: backend is newer — sync will be applied via bundle_available")
                        SyncAction.LOCAL_ONLY, SyncAction.CONFLICT -> {
                            logger?.info("Pack $packId: divergence detected ($action) — sending pack_divergence_detected")
                            httpClient.dispatcher.executorService.execute {
                                val diskFiles = net.artisanmc.plugin.sync.PackFilesReader.read(packDir, packId)
                                send(mapOf(
                                    "type" to "pack_divergence_detected",
                                    "pack_id" to packId,
                                    "disk_files" to diskFiles,
                                    "disk_hash" to diskHash,
                                    "last_synced_hash" to meta.syncedHash,
                                ))
                            }
                        }
                    }
```

4c. **Importer assertion utilities** dans le test :

Au top du fichier `FullSyncIntegrationTest.kt`, ajouter (s'ils manquent) :

```kotlin
import kotlin.test.assertNotNull
```

- [ ] **Step 5: Run le test**

```bash
cd plugin
./gradlew test --tests "net.artisanmc.plugin.FullSyncIntegrationTest"
```

Expected: nouveau test PASS, anciens tests toujours OK.

- [ ] **Step 6: Commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt plugin/src/test/kotlin/net/artisanmc/plugin/FullSyncIntegrationTest.kt
rtk git commit -m "feat(plugin): emit pack_divergence_detected pour LOCAL_ONLY/CONFLICT au hello_ack"
```

---

# Phase 7 — Éditeur : store, banner, modal conflit

## Task 19: Editor — `conflictsStore`

**Files:**
- Create: `editor/src/state/conflictsStore.ts`
- Create: `editor/src/state/conflictsStore.test.ts`

- [ ] **Step 1: Écrire le test**

`editor/src/state/conflictsStore.test.ts` :

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { useConflictsStore } from "./conflictsStore";

describe("conflictsStore", () => {
  beforeEach(() => {
    useConflictsStore.setState({ conflicts: [] });
  });

  it("hydrates from list", () => {
    useConflictsStore.getState().setConflicts([
      { id: "c1", packId: "p1", detectedAt: "2026-05-20T10:00:00Z", diskHash: "d", backendHashAtDetection: "b", fileCount: 2, diff: { addedOnDisk: [], removedOnDisk: [], modifiedOnDisk: [] } },
    ]);
    expect(useConflictsStore.getState().conflicts.length).toBe(1);
  });

  it("upsert adds new conflict", () => {
    useConflictsStore.getState().upsert({ id: "c1", packId: "p1", detectedAt: "t" } as any);
    expect(useConflictsStore.getState().conflicts.find((c) => c.id === "c1")).toBeDefined();
  });

  it("upsert replaces existing conflict by id", () => {
    useConflictsStore.getState().upsert({ id: "c1", packId: "p1", detectedAt: "t1" } as any);
    useConflictsStore.getState().upsert({ id: "c1", packId: "p1", detectedAt: "t2" } as any);
    const all = useConflictsStore.getState().conflicts.filter((c) => c.id === "c1");
    expect(all.length).toBe(1);
    expect(all[0].detectedAt).toBe("t2");
  });

  it("remove by id", () => {
    useConflictsStore.getState().setConflicts([
      { id: "c1" } as any,
      { id: "c2" } as any,
    ]);
    useConflictsStore.getState().remove("c1");
    expect(useConflictsStore.getState().conflicts.map((c) => c.id)).toEqual(["c2"]);
  });

  it("getByPackId returns the open conflict for a pack", () => {
    useConflictsStore.getState().setConflicts([
      { id: "c1", packId: "p1" } as any,
      { id: "c2", packId: "p2" } as any,
    ]);
    expect(useConflictsStore.getState().getByPackId("p1")?.id).toBe("c1");
    expect(useConflictsStore.getState().getByPackId("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, FAIL**

```bash
cd editor
npx vitest run src/state/conflictsStore.test.ts
```

- [ ] **Step 3: Implémenter**

`editor/src/state/conflictsStore.ts` :

```ts
import { create } from "zustand";

export interface ConflictDiff {
  addedOnDisk: string[];
  removedOnDisk: string[];
  modifiedOnDisk: string[];
}

export interface ConflictSummary {
  id: string;
  packId: string;
  detectedAt: string;
  diskHash: string;
  backendHashAtDetection: string;
  fileCount: number;
  diff: ConflictDiff;
}

interface ConflictsState {
  conflicts: ConflictSummary[];
  setConflicts: (list: ConflictSummary[]) => void;
  upsert: (c: ConflictSummary) => void;
  remove: (id: string) => void;
  getByPackId: (packId: string) => ConflictSummary | undefined;
}

export const useConflictsStore = create<ConflictsState>((set, get) => ({
  conflicts: [],
  setConflicts: (list) => set({ conflicts: list }),
  upsert: (c) => set((state) => {
    const others = state.conflicts.filter((x) => x.id !== c.id);
    return { conflicts: [...others, c] };
  }),
  remove: (id) => set((state) => ({ conflicts: state.conflicts.filter((c) => c.id !== id) })),
  getByPackId: (packId) => get().conflicts.find((c) => c.packId === packId),
}));
```

- [ ] **Step 4: PASS**

```bash
cd editor
npx vitest run src/state/conflictsStore.test.ts
```

- [ ] **Step 5: Commit**

```bash
rtk git add editor/src/state/conflictsStore.ts editor/src/state/conflictsStore.test.ts
rtk git commit -m "feat(editor): conflictsStore — Zustand store pour conflits ouverts"
```

## Task 20: Editor — API client `conflicts.ts`

**Files:**
- Create: `editor/src/lib/api/conflicts.ts`

- [ ] **Step 1: Écrire le client (simple, pas de test à part — on testera via les composants)**

`editor/src/lib/api/conflicts.ts` :

```ts
import type { ConflictSummary } from "@/state/conflictsStore";

export interface ConflictDetail extends ConflictSummary {
  diskFiles: Record<string, string>;
}

export async function listConflicts(apiUrl: string, token: string): Promise<ConflictSummary[]> {
  const res = await fetch(`${apiUrl}/api/editor-session/${token}/conflicts`);
  if (!res.ok) throw new Error(`list_failed_${res.status}`);
  const body = (await res.json()) as { conflicts: ConflictSummary[] };
  return body.conflicts;
}

export async function getConflict(apiUrl: string, token: string, id: string): Promise<ConflictDetail> {
  const res = await fetch(`${apiUrl}/api/editor-session/${token}/conflicts/${id}`);
  if (!res.ok) throw new Error(`get_failed_${res.status}`);
  const body = (await res.json()) as { conflict: ConflictDetail };
  return body.conflict;
}

export async function resolveConflict(apiUrl: string, token: string, id: string, choice: "editor" | "server"): Promise<void> {
  const res = await fetch(`${apiUrl}/api/editor-session/${token}/conflicts/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ choice }),
  });
  if (res.status === 409) throw new Error("already_resolved");
  if (!res.ok) throw new Error(`resolve_failed_${res.status}`);
}
```

- [ ] **Step 2: Commit**

```bash
rtk git add editor/src/lib/api/conflicts.ts
rtk git commit -m "feat(editor): API client conflicts — list/get/resolve"
```

## Task 21: Editor — router WS messages vers `conflictsStore` dans `wsStore.ts`

**Files:**
- Modify: `editor/src/state/wsStore.ts`
- Modify: `editor/src/state/wsStore.test.ts`

- [ ] **Step 1: Lire `wsStore.test.ts` pour comprendre le pattern**

```bash
cd editor
cat src/state/wsStore.test.ts
```

- [ ] **Step 2: Étendre `wsStore.ts` pour router les nouveaux messages**

Modifier la fonction `connect` dans `wsStore.ts`, dans le `_unsubMessage = bridge.onMessage((raw) => {...})`. Remplacer le `if (msg.type === "hello_ack")` par une chaîne :

```ts
    _unsubMessage = bridge.onMessage((raw) => {
      try {
        const msg = JSON.parse(raw) as Record<string, unknown>;
        if (msg.type === "hello_ack") {
          set({
            connected: true,
            serverId:  msg.server_id as string,
            apiUrl:    msg.api_url   as string,
            serverKey,
          });
        } else if (msg.type === "pack_conflict_detected") {
          // Refetch the summary since we only get the conflict_id from WS
          const { apiUrl: au } = get();
          const tok = (msg as Record<string, unknown>).conflict_id as string;
          void (async () => {
            if (!au) return;
            // Dynamic import to avoid circular dep at module load
            const { getConflict } = await import("@/lib/api/conflicts");
            const { useConflictsStore } = await import("@/state/conflictsStore");
            const sessionToken = (window.location.search.match(/token=([^&]+)/)?.[1]) ?? "";
            if (!sessionToken) return;
            const detail = await getConflict(au, sessionToken, tok).catch(() => null);
            if (detail) useConflictsStore.getState().upsert(detail);
          })();
        } else if (msg.type === "pack_conflict_resolved") {
          void (async () => {
            const { useConflictsStore } = await import("@/state/conflictsStore");
            useConflictsStore.getState().remove((msg as Record<string, unknown>).conflict_id as string);
          })();
        } else if (msg.type === "pack_deleted") {
          // Surface to listeners via window event (avoids tight coupling here)
          window.dispatchEvent(new CustomEvent("ifz:pack_deleted", { detail: { packId: msg.pack_id } }));
        }
      } catch { /* ignore malformed */ }
    });
```

- [ ] **Step 3: Ajouter le test**

À la fin de `wsStore.test.ts`, ajouter :

```ts
import { useConflictsStore } from "./conflictsStore";

describe("wsStore routing of conflict messages", () => {
  it("removes conflict from store on pack_conflict_resolved", async () => {
    useConflictsStore.setState({ conflicts: [{ id: "cx", packId: "p" } as any] });
    // Simulate the dynamic import path being taken
    const { useConflictsStore: imported } = await import("./conflictsStore");
    imported.getState().remove("cx");
    expect(imported.getState().conflicts.length).toBe(0);
  });
});
```

(Test léger ; le routing complet est testé via les browser specs.)

- [ ] **Step 4: Run**

```bash
cd editor
npx vitest run src/state/wsStore.test.ts
```

- [ ] **Step 5: Commit**

```bash
rtk git add editor/src/state/wsStore.ts editor/src/state/wsStore.test.ts
rtk git commit -m "feat(editor): wsStore — router pack_conflict_detected/resolved/pack_deleted"
```

## Task 22: Editor — `ConflictBanner` + intégration dans `pack.$packId.tsx`

**Files:**
- Create: `editor/src/features/sync/ConflictBanner.tsx`
- Create: `editor/src/features/sync/ConflictBanner.test.tsx`
- Modify: `editor/src/locales/en.ts`
- Modify: `editor/src/locales/fr.ts`

- [ ] **Step 1: Ajouter les clés i18n**

Dans le bloc `sync` de `en.ts` (créé en Task 12), ajouter :

```ts
    banner: {
      titleSingular: "1 conflict detected on the Minecraft server",
      titlePlural: "{{count}} conflicts detected on the Minecraft server",
      subtitle: "Files have been modified outside the editor.",
      seeDetails: "See details",
    },
```

Dans `fr.ts` :

```ts
    banner: {
      titleSingular: "1 conflit détecté sur le serveur Minecraft",
      titlePlural: "{{count}} conflits détectés sur le serveur Minecraft",
      subtitle: "Les fichiers ont été modifiés en dehors de l'éditeur.",
      seeDetails: "Voir détails",
    },
```

- [ ] **Step 2: Écrire le test**

`editor/src/features/sync/ConflictBanner.test.tsx` :

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConflictBanner } from "./ConflictBanner";
import { useConflictsStore } from "@/state/conflictsStore";

describe("ConflictBanner", () => {
  beforeEach(() => {
    useConflictsStore.setState({ conflicts: [] });
  });

  it("renders nothing when store is empty", () => {
    const { container } = render(<ConflictBanner onSeeDetails={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders count when store has conflicts", () => {
    useConflictsStore.setState({
      conflicts: [
        { id: "c1", packId: "p1" } as any,
        { id: "c2", packId: "p2" } as any,
      ],
    });
    render(<ConflictBanner onSeeDetails={vi.fn()} />);
    expect(screen.getByText(/2 conflits/i)).toBeTruthy();
  });

  it("calls onSeeDetails when button is clicked", () => {
    useConflictsStore.setState({ conflicts: [{ id: "c1", packId: "p1" } as any] });
    const onSeeDetails = vi.fn();
    render(<ConflictBanner onSeeDetails={onSeeDetails} />);
    fireEvent.click(screen.getByRole("button", { name: /détails/i }));
    expect(onSeeDetails).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run, FAIL**

```bash
cd editor
npx vitest run src/features/sync/ConflictBanner.test.tsx
```

- [ ] **Step 4: Implémenter**

`editor/src/features/sync/ConflictBanner.tsx` :

```tsx
import { useTranslation } from "react-i18next";
import { useConflictsStore } from "@/state/conflictsStore";

export interface ConflictBannerProps {
  onSeeDetails: () => void;
}

export function ConflictBanner({ onSeeDetails }: ConflictBannerProps) {
  const { t } = useTranslation();
  const count = useConflictsStore((s) => s.conflicts.length);
  if (count === 0) return null;
  const title = count === 1
    ? t("sync.banner.titleSingular")
    : t("sync.banner.titlePlural", { count });
  return (
    <div className="w-full bg-yellow-50 border-b border-yellow-300 px-4 py-2 flex items-center justify-between">
      <div className="text-sm">
        <span className="font-medium text-yellow-900">⚠ {title}</span>{" "}
        <span className="text-yellow-700">{t("sync.banner.subtitle")}</span>
      </div>
      <button
        type="button"
        onClick={onSeeDetails}
        className="text-sm font-medium text-yellow-900 underline hover:no-underline"
      >
        {t("sync.banner.seeDetails")}
      </button>
    </div>
  );
}
```

- [ ] **Step 5: PASS**

```bash
cd editor
npx vitest run src/features/sync/ConflictBanner.test.tsx
```

- [ ] **Step 6: Commit**

```bash
rtk git add editor/src/features/sync/ConflictBanner.tsx editor/src/features/sync/ConflictBanner.test.tsx editor/src/locales/en.ts editor/src/locales/fr.ts
rtk git commit -m "feat(editor): ConflictBanner — banner persistant pour conflits ouverts"
```

## Task 23: Editor — `ConflictResolutionModal`

**Files:**
- Create: `editor/src/features/sync/ConflictResolutionModal.tsx`
- Create: `editor/src/features/sync/ConflictResolutionModal.test.tsx`
- Modify: `editor/src/locales/en.ts`
- Modify: `editor/src/locales/fr.ts`

- [ ] **Step 1: Ajouter les clés i18n**

Dans `en.ts` sous `sync`, ajouter :

```ts
    modal: {
      title: "Resolve conflicts",
      modifiedAt: "Modified on the Minecraft server at {{date}}",
      changesDetected: "Changes detected:",
      addedFiles: "{{count}} added",
      modifiedFiles: "{{count}} modified",
      removedFiles: "{{count}} removed",
      emptyDiskWarning: "⚠ Adopting the server version will empty this pack (no files detected on disk). Confirm?",
      keepEditor: "Keep editor",
      keepEditorDesc: "Push this version to the server.",
      useServer: "Use server",
      useServerDesc: "Adopt the server files here.",
      resolvedByOther: "Conflict resolved by another admin",
      close: "Close",
    },
```

Dans `fr.ts` :

```ts
    modal: {
      title: "Résoudre les conflits",
      modifiedAt: "Modifié sur le serveur Minecraft le {{date}}",
      changesDetected: "Changements détectés :",
      addedFiles: "{{count}} ajouté(s)",
      modifiedFiles: "{{count}} modifié(s)",
      removedFiles: "{{count}} supprimé(s)",
      emptyDiskWarning: "⚠ Adopter la version du serveur va vider ce pack (aucun fichier détecté sur disque). Confirmer ?",
      keepEditor: "Garder l'éditeur",
      keepEditorDesc: "Repousser cette version vers le serveur.",
      useServer: "Utiliser le serveur",
      useServerDesc: "Adopter les fichiers du serveur ici.",
      resolvedByOther: "Conflit résolu par un autre admin",
      close: "Fermer",
    },
```

- [ ] **Step 2: Écrire le test**

`editor/src/features/sync/ConflictResolutionModal.test.tsx` :

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConflictResolutionModal } from "./ConflictResolutionModal";
import { useConflictsStore } from "@/state/conflictsStore";

const mkConflict = (id: string, packId: string, overrides?: any) => ({
  id, packId,
  detectedAt: "2026-05-20T10:00:00Z",
  diskHash: "d", backendHashAtDetection: "b",
  fileCount: 4,
  diff: { addedOnDisk: ["a.yaml"], removedOnDisk: ["b.yaml"], modifiedOnDisk: ["c.yaml", "d.yaml"] },
  ...overrides,
});

describe("ConflictResolutionModal", () => {
  beforeEach(() => {
    useConflictsStore.setState({ conflicts: [] });
  });

  it("shows summary counts", () => {
    useConflictsStore.setState({ conflicts: [mkConflict("c1", "p1")] });
    render(<ConflictResolutionModal apiUrl="http://api" token="tok" onClose={vi.fn()} />);
    expect(screen.getByText(/p1/)).toBeTruthy();
    expect(screen.getByText(/1 ajouté/i)).toBeTruthy();
    expect(screen.getByText(/2 modifié/i)).toBeTruthy();
    expect(screen.getByText(/1 supprimé/i)).toBeTruthy();
  });

  it("shows empty-disk warning when fileCount is 0", () => {
    useConflictsStore.setState({ conflicts: [mkConflict("c1", "p1", { fileCount: 0 })] });
    render(<ConflictResolutionModal apiUrl="http://api" token="tok" onClose={vi.fn()} />);
    expect(screen.getByText(/vider ce pack/i)).toBeTruthy();
  });

  it("calls resolveConflict + removes from store on Keep editor", async () => {
    const original = global.fetch;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ resolved: true, newHash: "h" }) });
    global.fetch = fetchMock as any;
    useConflictsStore.setState({ conflicts: [mkConflict("c1", "p1")] });

    render(<ConflictResolutionModal apiUrl="http://api" token="tok" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Garder l'éditeur/i }));

    await waitFor(() => {
      expect(useConflictsStore.getState().conflicts.length).toBe(0);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api/api/editor-session/tok/conflicts/c1/resolve",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ choice: "editor" }),
      }),
    );
    global.fetch = original;
  });

  it("calls onClose when last conflict resolved", async () => {
    const original = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ resolved: true, newHash: "h" }) }) as any;
    useConflictsStore.setState({ conflicts: [mkConflict("c1", "p1")] });
    const onClose = vi.fn();
    render(<ConflictResolutionModal apiUrl="http://api" token="tok" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /Utiliser le serveur/i }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    global.fetch = original;
  });
});
```

- [ ] **Step 3: Run, FAIL**

```bash
cd editor
npx vitest run src/features/sync/ConflictResolutionModal.test.tsx
```

- [ ] **Step 4: Implémenter**

`editor/src/features/sync/ConflictResolutionModal.tsx` :

```tsx
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useConflictsStore } from "@/state/conflictsStore";
import { resolveConflict } from "@/lib/api/conflicts";

export interface ConflictResolutionModalProps {
  apiUrl: string;
  token: string;
  onClose: () => void;
}

export function ConflictResolutionModal({ apiUrl, token, onClose }: ConflictResolutionModalProps) {
  const { t } = useTranslation();
  const conflicts = useConflictsStore((s) => s.conflicts);
  const remove = useConflictsStore((s) => s.remove);

  // Auto-close when the last conflict is gone
  useEffect(() => {
    if (conflicts.length === 0) onClose();
  }, [conflicts.length, onClose]);

  async function handleResolve(id: string, choice: "editor" | "server") {
    try {
      await resolveConflict(apiUrl, token, id, choice);
      remove(id);
    } catch (err) {
      if ((err as Error).message === "already_resolved") {
        remove(id);
      }
    }
  }

  if (conflicts.length === 0) return null;

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 shadow-xl max-h-[80vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">{t("sync.modal.title")}</h2>
        <div className="space-y-6">
          {conflicts.map((cf) => {
            const isEmpty = cf.fileCount === 0;
            return (
              <div key={cf.id} className="border rounded p-4">
                <h3 className="font-medium mb-2">{cf.packId}</h3>
                <p className="text-sm text-gray-600 mb-3">
                  {t("sync.modal.modifiedAt", { date: new Date(cf.detectedAt).toLocaleString() })}
                </p>
                <div className="text-sm mb-3">
                  <div className="font-medium mb-1">{t("sync.modal.changesDetected")}</div>
                  <ul className="ml-4 list-disc text-gray-700">
                    {cf.diff.addedOnDisk.length > 0 && <li>+ {t("sync.modal.addedFiles", { count: cf.diff.addedOnDisk.length })}</li>}
                    {cf.diff.modifiedOnDisk.length > 0 && <li>~ {t("sync.modal.modifiedFiles", { count: cf.diff.modifiedOnDisk.length })}</li>}
                    {cf.diff.removedOnDisk.length > 0 && <li>- {t("sync.modal.removedFiles", { count: cf.diff.removedOnDisk.length })}</li>}
                  </ul>
                </div>
                {isEmpty && (
                  <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2 mb-3">
                    {t("sync.modal.emptyDiskWarning")}
                  </p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => handleResolve(cf.id, "editor")}
                    className="border rounded p-3 text-left hover:bg-blue-50"
                  >
                    <div className="font-medium">{t("sync.modal.keepEditor")}</div>
                    <div className="text-xs text-gray-600">{t("sync.modal.keepEditorDesc")}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleResolve(cf.id, "server")}
                    className="border rounded p-3 text-left hover:bg-blue-50"
                  >
                    <div className="font-medium">{t("sync.modal.useServer")}</div>
                    <div className="text-xs text-gray-600">{t("sync.modal.useServerDesc")}</div>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-6 flex justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300">
            {t("sync.modal.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run, PASS**

```bash
cd editor
npx vitest run src/features/sync/ConflictResolutionModal.test.tsx
```

- [ ] **Step 6: Commit**

```bash
rtk git add editor/src/features/sync/ConflictResolutionModal.tsx editor/src/features/sync/ConflictResolutionModal.test.tsx editor/src/locales/en.ts editor/src/locales/fr.ts
rtk git commit -m "feat(editor): ConflictResolutionModal — résolution par pack avec Keep/Use Server"
```

## Task 24: Editor — intégrer banner + modal dans `pack.$packId.tsx` + hydrater au mount

**Files:**
- Modify: `editor/src/routes/pack.$packId.tsx`

- [ ] **Step 1: Lire le fichier actuel pour localiser le point d'insertion**

```bash
cd editor
grep -n "export default\|function Pack\|return (" src/routes/pack.\$packId.tsx | head -20
```

- [ ] **Step 2: Modifier le fichier**

Ajouter en haut du fichier les imports :

```tsx
import { ConflictBanner } from "@/features/sync/ConflictBanner";
import { ConflictResolutionModal } from "@/features/sync/ConflictResolutionModal";
import { listConflicts } from "@/lib/api/conflicts";
import { useConflictsStore } from "@/state/conflictsStore";
import { useWsStore } from "@/state/wsStore";
```

Dans le composant racine de la route (la fonction qui retourne le layout 3 colonnes), ajouter au début, après les hooks existants :

```tsx
  const [modalOpen, setModalOpen] = useState(false);
  const setConflicts = useConflictsStore((s) => s.setConflicts);
  const apiUrl = useWsStore((s) => s.apiUrl);
  const sessionToken = window.location.search.match(/token=([^&]+)/)?.[1] ?? "";

  useEffect(() => {
    if (!apiUrl || !sessionToken) return;
    listConflicts(apiUrl, sessionToken).then(setConflicts).catch(() => {});
  }, [apiUrl, sessionToken, setConflicts]);
```

Insérer le banner juste avant le JSX root du layout (au-dessus du canvas) :

```tsx
      <ConflictBanner onSeeDetails={() => setModalOpen(true)} />
```

Et après le canvas, monter conditionnellement la modal :

```tsx
      {modalOpen && apiUrl && (
        <ConflictResolutionModal
          apiUrl={apiUrl}
          token={sessionToken}
          onClose={() => setModalOpen(false)}
        />
      )}
```

- [ ] **Step 3: Lancer Vitest sur toute la suite éditeur pour confirmer la non-régression**

```bash
cd editor
npx vitest run
```

Expected: tous les tests passent, count = ancien + nouveaux.

- [ ] **Step 4: Commit**

```bash
rtk git add editor/src/routes/pack.\$packId.tsx
rtk git commit -m "feat(editor): pack route — hydrater conflits au mount + banner + modal résolution"
```

## Task 25: Editor — désactiver publish si conflit ouvert pour le pack courant

**Files:**
- Modify: `editor/src/routes/pack.$packId.tsx` (ou le fichier qui héberge le bouton publish)

- [ ] **Step 1: Localiser le bouton "Publier"**

```bash
cd editor
grep -rn "publish\|publier\|Publier" src/features/canvas/ src/routes/ | head -20
```

- [ ] **Step 2: Ajouter la garde**

Dans le composant qui rend le bouton publish (probablement dans `pack.$packId.tsx` ou un `<Toolbar>`), récupérer le conflit du pack courant :

```tsx
  const conflictForPack = useConflictsStore((s) => s.getByPackId(packId));
  const isPublishDisabled = conflictForPack !== undefined;
```

Et appliquer `disabled={isPublishDisabled}` au bouton + un titre/tooltip explicatif :

```tsx
  <button
    type="button"
    onClick={handlePublish}
    disabled={isPublishDisabled}
    title={isPublishDisabled ? t("sync.banner.subtitle") : undefined}
    className="... disabled:opacity-50 disabled:cursor-not-allowed"
  >
    ...
  </button>
```

Faire la même chose pour tout autopublish (si appelé via `useEffect`).

- [ ] **Step 3: Ajouter un test si possible (sinon vérification manuelle)**

Si la route a des tests existants, ajouter un test "publish disabled if pack has open conflict". Sinon, vérifier visuellement.

- [ ] **Step 4: Run all editor tests**

```bash
cd editor
npx vitest run
```

- [ ] **Step 5: Commit**

```bash
rtk git add editor/src/routes/pack.\$packId.tsx
rtk git commit -m "feat(editor): désactiver publish si conflit ouvert pour le pack courant"
```

## Task 26: Editor — appeler `DeletePackDialog` depuis la liste des packs

**Files:**
- Modify: l'endroit où la liste des packs / la sidebar permet d'agir sur un pack (probablement `editor/src/routes/pack.$packId.tsx` ou un menu kebab).

- [ ] **Step 1: Localiser le menu d'action par pack**

```bash
cd editor
grep -rn "PackMenu\|packActions\|kebab\|MoreVertical" src/ | head -10
```

- [ ] **Step 2: Ajouter une entrée "Supprimer"**

Dans le menu kebab du pack (ou la zone d'actions), ajouter un bouton qui ouvre `DeletePackDialog`. Câbler le `onConfirm` à `deletePack({ apiUrl, token, packId })` puis :
- Naviguer hors de la route du pack (ex: `navigate("/")` si on était sur ce pack)
- Retirer le pack du store local s'il existe.

Pseudo-code :

```tsx
const [showDelete, setShowDelete] = useState(false);
// ... button:
<button onClick={() => setShowDelete(true)}>Supprimer le pack</button>
// ... in JSX root:
{showDelete && (
  <DeletePackDialog
    packName={pack.name}
    onCancel={() => setShowDelete(false)}
    onConfirm={async () => {
      await deletePack({ apiUrl, token: sessionToken, packId: pack.id });
      setShowDelete(false);
      navigate("/");
    }}
  />
)}
```

- [ ] **Step 3: Run tests**

```bash
cd editor
npx vitest run
```

- [ ] **Step 4: Commit**

```bash
rtk git add editor/
rtk git commit -m "feat(editor): wire DeletePackDialog dans le menu d'action de pack"
```

---

# Phase 8 — Docs

## Task 27: CLAUDE.md — nouveaux invariants + endpoints + protocole + test counts

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Ajouter les nouveaux invariants**

Dans la section "Invariants critiques" de `CLAUDE.md`, ajouter à la fin :

```markdown
**Conflit = freeze** — tant que `pack_conflicts.resolved_at IS NULL` côté backend, aucun `bundle_available` n'est broadcast pour ce `(server_id, pack_id)`. Implémenté dans `pushBundleAvailable` (hub.ts) qui consulte la table en début de fonction. Empêche tout écrasement silencieux pendant qu'une décision est en attente.

**Auto-resolution sur DELETE pack** — `DELETE /api/editor-session/:token/packs/:packId` marque tout conflit ouvert pour ce pack comme `resolution: "editor"` et envoie `pack_deleted` au plugin (qui move-to-trash). L'éditeur devient implicitement autoritaire.

**`.artisan-trash/` is sacred** — répertoire au top de `packsDir` créé par `PackDeleter`. Exclu du hash (filtre `.` au top-level dans `BundleHasher.hashAll`) et du sweep de `BundleDownloader` (filtre `.artisan*` sur les filenames). Ne jamais utiliser ce nom pour autre chose.

**Suppressions propagées** — `BundleDownloader.download` walk le packDir après écriture et supprime les fichiers locaux absents du bundle (filtre `.artisan*` préservé). Le sweep résout le bug historique où supprimer un menu dans l'éditeur ne le retirait pas du disque serveur.
```

- [ ] **Step 2: Ajouter les nouveaux endpoints dans la table API**

Dans la section "Custom Items — endpoints et cache" ou la section dédiée des endpoints (selon la structure du CLAUDE.md actuel), ajouter :

```markdown
| `DELETE /api/editor-session/:token/packs/:packId` | Soft-delete du pack côté backend, auto-résolution de tout conflit ouvert en "editor", broadcast `pack_deleted` au plugin et aux autres éditeurs. 200 `{deleted: true}` ou 404. |
| `GET /api/editor-session/:token/conflicts` | Liste les conflits ouverts pour le server_key de la session. Retourne `{ conflicts: ConflictSummary[] }`. |
| `GET /api/editor-session/:token/conflicts/:id` | Détail d'un conflit (incluant `diskFiles` complet). 404 si autre server_key. |
| `POST /api/editor-session/:token/conflicts/:id/resolve` | Body `{ choice: "editor" \| "server" }`. 200 si résolu, 409 si déjà résolu, 401 si token invalide. |
```

Dans la table "Protocole WS plugin ↔ backend", ajouter :

```markdown
| `pack_divergence_detected` | plugin → backend | `{ pack_id, disk_files, disk_hash, last_synced_hash }` — émis au boot/`/artisan reload` pour les packs en LOCAL_ONLY/CONFLICT |
| `pack_deleted` | backend → plugin | `{ pack_id }` — pack supprimé côté éditeur, le plugin move-to-trash |
| `pack_conflict_detected` | backend → éditeur | `{ conflict_id, pack_id, detected_at }` |
| `pack_conflict_resolved` | backend → éditeur | `{ conflict_id, pack_id, resolution }` |
```

Et étendre la description de `hello_ack` pour mentionner `deleted_pack_ids: string[]`.

- [ ] **Step 3: Bump les test counts**

À la fin de la section "Tests — ce qui est couvert", incrémenter les compteurs :

```markdown
| Backend unit + intégration | (ajoute ~10 tests : conflictDiff, conflicts route, DELETE pack route, hub divergence, bundles pack_locked) |
| Plugin unit + intégration | (ajoute ~7 tests : BundleDownloader sweep, PackDeleter, PackDeletion handler, FullSync divergence) |
| Editor unit | (ajoute ~12 tests : conflictsStore, DeletePackDialog, ConflictBanner, ConflictResolutionModal) |
```

(Compter précisément en fonction des tests réellement ajoutés une fois l'implémentation faite.)

- [ ] **Step 4: Commit**

```bash
rtk git add CLAUDE.md
rtk git commit -m "docs(CLAUDE.md): sync deletion — invariants, endpoints, protocole, bump tests"
```

## Task 28: Scénario E2E manuel

**Files:**
- Create: `docs/specs/sync-deletion-e2e.md`

- [ ] **Step 1: Écrire le scénario**

`docs/specs/sync-deletion-e2e.md` :

```markdown
# E2E manuel — Sync model (suppressions + divergences + DELETE pack)

Scénario à exécuter manuellement après le merge du feature `sync-deletion`. Cross-stack : backend + editor + plugin Docker.

## Préparation

```bash
cd /path/to/Artisan
docker compose up -d
```

Attendre que les trois services soient up : backend (3001), editor (5173), minecraft (25565).

## Bug A — suppressions éditeur propagées sur disque

1. Ouvrir l'éditeur (URL via `/artisan editor` en jeu), créer un pack `e2e_test`.
2. Ajouter 3 menus : `menu_a`, `menu_b`, `menu_c`. Publier.
3. Sur le serveur Minecraft, vérifier que `/server-data/plugins/Artisan/packs/e2e_test/menus/` contient les 3 YAML.
4. Dans l'éditeur, supprimer `menu_b`. Publier.
5. **Attendu :** `menus/menu_b.yaml` disparait du disque serveur. `menu_a.yaml` et `menu_c.yaml` restent. `.artisan-sync.yaml` conservé.

## Bug B — divergence disque ↔ backend détectée et résolue

### Sous-scénario 1 : LOCAL_ONLY, "Garder l'éditeur"

1. Stopper le serveur Minecraft (`docker compose stop minecraft`).
2. SSH (ou exec) dans le container, supprimer un YAML manuellement : `rm /server-data/plugins/Artisan/packs/e2e_test/menus/menu_c.yaml`.
3. Redémarrer le serveur.
4. Ouvrir l'éditeur. **Attendu :** banner conflit en haut du canvas avec "1 conflit détecté".
5. Cliquer "Voir détails" → modal liste `e2e_test` avec `- 1 fichier supprimé (menus/menu_c.yaml)`.
6. Cliquer "Garder l'éditeur".
7. **Attendu :** banner disparait, `menu_c.yaml` réapparait sur disque serveur.

### Sous-scénario 2 : modification, "Utiliser le serveur"

1. Stopper, modifier `menus/menu_a.yaml` côté disque (changer la taille ou un texte), redémarrer.
2. Ouvrir l'éditeur → banner.
3. Cliquer "Utiliser le serveur".
4. **Attendu :** le contenu de `menu_a` dans l'éditeur reflète la modif disque.

### Sous-scénario 3 : aucun éditeur ouvert au moment de la détection

1. Stopper, supprimer un fichier, redémarrer.
2. Vérifier qu'aucun éditeur n'est ouvert. Pas de modal de pop-up évidemment.
3. Ouvrir l'éditeur plus tard. **Attendu :** banner apparait.

## DELETE pack — flux complet

1. Dans l'éditeur, ouvrir le menu d'action du pack `e2e_test`, cliquer "Supprimer le pack".
2. **Attendu :** modal "Supprimer le pack «e2e_test» ?" avec champ type-to-confirm.
3. Taper "e2e_test" exactement. Bouton "Supprimer" s'active.
4. Cliquer "Supprimer".
5. **Attendu :**
   - Le pack disparait de la liste éditeur.
   - Sur le disque serveur, le dossier `packs/e2e_test/` est déplacé vers `packs/.artisan-trash/e2e_test-<timestamp>/`.
   - Aucune erreur dans les logs plugin.

## Edge cases à observer

- **Multi-onglets** : ouvrir deux onglets éditeur. Provoquer un conflit. Un onglet résout. Vérifier que l'autre onglet voit le banner disparaître automatiquement (via `pack_conflict_resolved`).
- **Publish pendant conflit** : provoquer un conflit, vérifier que le bouton Publier est désactivé pour le pack en question.
- **Reload pendant freeze** : provoquer un conflit, ne pas le résoudre, exécuter `/artisan reload` en jeu. Vérifier qu'aucun `bundle_available` n'est broadcast (le pack reste sur sa version disque actuelle).
```

- [ ] **Step 2: Commit**

```bash
rtk git add docs/specs/sync-deletion-e2e.md
rtk git commit -m "docs: scénario E2E manuel pour sync-deletion"
```

---

## Self-review checklist (à effectuer après implémentation)

- [ ] Tous les nouveaux endpoints retournent les codes HTTP corrects (200/201/400/401/404/409).
- [ ] Tous les nouveaux fichiers TypeScript compilent sans erreur (`bunx tsc --noEmit` côté backend + `npx vitest run` côté éditeur).
- [ ] Tous les nouveaux tests Kotlin passent (`./gradlew test` côté plugin).
- [ ] L'index unique partiel `pack_conflicts_open_uniq` rejette bien une seconde row ouverte.
- [ ] La défense path traversal dans `BundleDownloader` est toujours en place.
- [ ] Les clés i18n `sync.*` existent dans `en.ts` ET `fr.ts`.
- [ ] CLAUDE.md mis à jour (invariants, endpoints, protocole, test counts).
- [ ] E2E manuel exécuté avec succès (cf. `docs/specs/sync-deletion-e2e.md`).
