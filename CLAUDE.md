# Interfaze — Instructions Claude

## Règles de mise à jour des docs

Quand tu modifies du code, tu dois aussi mettre à jour les docs correspondants :

| Tu touches | Tu mets à jour |
|---|---|
| Protocole WS (`hub.ts`, `protocol.ts`, `WsClient.kt`) | `docs/specs/` section protocole |
| Stack / dépendances | `docs/decisions/stack.md` + tableau "Pivots" si c'est un changement de choix |
| Termes du domaine (Pack, Menu, Element…) | `CONTEXT.md` |
| Commandes plugin (`IfzCommand.kt`) | Ce fichier, section Plugin ci-dessous |
| Variables d'environnement | `.env.example` + ce fichier |
| Endpoints API | Ce fichier, section Backend |

Ne pas mettre à jour = la prochaine session ne saura pas que le code a changé.

---

## Commandes

### Plugin (Kotlin 2.0 / Paper 1.21.4)

```bash
cd plugin
./gradlew test          # ~190 tests (unit + intégration MockWebServer)
./gradlew shadowJar     # → build/libs/interfaze-plugin-1.0.0-SNAPSHOT-all.jar
```

### Backend (Bun + Hono + PostgreSQL)

```bash
cd backend
bun install
bun run db:push         # Applique le schéma Drizzle sur PostgreSQL (DATABASE_URL requis)
bun run dev             # Dev avec --watch sur port 3001
bun test                # ~104 tests (unit + intégration WS réel)
```

```bash
# Générer les données items (à faire avant gen-icons.ts)
bun backend/scripts/gen-items.ts [version]    # télécharge assets MC + génère items.json avec champs model

# Pre-render les icônes 3D server-side (Playwright + Three.js, nécessite gen-items.ts d'abord)
bun backend/scripts/gen-icons.ts [version]    # rend 750 PNGs → data/mc-assets/{version}/textures/icons/
                                               # puis met à jour items.json (remplace model par texture icons/{id})
# Note : utilise Node.js en sous-processus pour Playwright (workaround Bun+Windows pipe IPC)
```

### Editor (React 19 + Vite 6)

```bash
cd editor
npm install
npm run dev             # Vite dev server sur port 5173
npx vitest run          # 400 tests
npm run build           # Build production
```

### Stack complète (Docker)

```bash
cp .env.example .env    # puis renseigner INTERFAZE_SERVER_KEY
docker compose up       # backend:3001 + editor:5173 + minecraft:25565
```

**Déployer un nouveau JAR plugin (workflow normal) :**
```bash
cd plugin
./gradlew deploy        # compile + redémarre le container (le JAR est monté directement depuis build/libs/)
```

---

## Architecture

```
editor/          React 19 + Vite + Konva
backend/         Bun + Hono + PostgreSQL (Drizzle)
plugin/          Kotlin 2.0 + Paper 1.21.4 + OkHttp
docker/          Config serveur Minecraft (itzg/minecraft-server, Paper géré par l'image)
docker-compose.yml
docs/
  decisions/             ← ADRs (stack, state model)
  specs/                 ← specs produit et éditeur (web-editor.md, main-spec.md)
  schema/                ← JSON schemas menu/pack/command/translations
  superpowers/specs/     ← design docs data-sources, expression DSL
  superpowers/plans/     ← plans actifs (archive/ = plans complétés)
CONTEXT.md               ← glossaire domaine (source de vérité pour les termes)
```

### Flux de données

```
[Editor browser]
   │ WS ws://backend:3001/ws/plugin  (pluginBridge.ts)
   │ POST /api/bundles/:packId       (bundlePublisher.ts)
   ▼
[Backend Bun/Hono]
   │ WS /ws/plugin                   (hub.ts)
   │ REST /api/bundles, /api/server-keys
   ▼
[Plugin Kotlin]
   │ hello → hello_ack + bundle_available
   │ GET /api/bundles/:packId        (BundleDownloader.kt)
   └ écrit sur disque → hot-reload menus
```

### Protocole WS plugin ↔ backend

| Message | Sens | Contenu clé |
|---|---|---|
| `hello` | plugin → backend | `server_key`, `current_bundle_hash`, `custom_items_hash?` |
| `hello_ack` | backend → plugin | `pack_hashes`, `needs_sync`, `api_url` |
| `bundle_available` | backend → plugin | `pack_id`, `url`, `hash` |
| `draft_update` | backend → plugin | `menu_id`, `menu_yaml` |
| `editor_session_request` | plugin → backend | `sender` |
| `editor_session_ready` | backend → plugin | `url`, `expires_at`, `trust_code` |
| `editor_session_revoke` | plugin → backend | `{}` |
| `editor_trust_request` | plugin → backend | `trust_code` |
| `session_trusted` | backend → éditeur WS | `{}` |
| `session_expired` | backend → éditeur WS | `{}` |
| `ping` / `pong` | backend ↔ plugin | keepalive OkHttp 30s |
| `custom_items_changed` | plugin → backend | `{ hash }` — hot-reload Nexo/Oraxen/ItemsAdder |
| `custom_items_request` | backend → plugin | `{}` — demande le bundle complet |
| `custom_items_bundle` | plugin → backend | `{ hash, data }` — `data = base64(gzip(zip))` |

---

## Invariants critiques

**Hash byte-order sort** — `BundleHasher.kt` et `hashUtils.ts` trient les fichiers par ordre byte natif (`<`/`>` Kotlin/JS). Ne jamais utiliser `localeCompare` ou `compareToIgnoreCase` : les hashes divergeraient entre plugin et backend.

**Sentinel `""`** — chaîne vide = "jamais synchronisé / pas de contenu" dans tous les contextes hash. `BundleHasher.hash()` renvoie `""` pour un répertoire vide. `SyncMetadata.syncedHash` est `""` par défaut.

**`BUNDLE_BASE_URL` vs `API_BASE_URL`** — en Docker, le plugin (container `minecraft`) accède au backend via `http://backend:3001`, mais le browser accède via `http://localhost:3001`. Les deux env vars sont distinctes. Par défaut `BUNDLE_BASE_URL` = `API_BASE_URL` (hors Docker, c'est identique).

**OkHttp thread** — `SyncedMenuProvider.handleMessage` est appelé sur le thread WS callback d'OkHttp. Le download de bundle est dispatché sur `httpClient.dispatcher.executorService`. Ne jamais faire de I/O bloquant dans le callback WS directement.

**Reload atomique** — `reloadFromDisk()` construit un nouveau `ConcurrentHashMap` entier, puis l'assigne à `@Volatile var menus`. Ne jamais modifier le map en place.

---

## Structure des packs sur disque

```
plugins/Interfaze/packs/
  <pack_id>/
    manifest.yaml
    menus/<menu_id>.yaml
    dialogs/<dialog_id>.yaml
    lang/<lang>.yaml
    .interfaze-sync.yaml   ← SyncMetadata (syncedHash, backendHash, syncedAt)
```

`.interfaze-sync.yaml` est exclu du hash (préfixe `.interfaze` filtré dans `BundleHasher`).

---

## Custom Items — endpoints et cache

| Endpoint | Description |
|---|---|
| `GET /api/editor-session/:token/custom-items` | Retourne `{ serverKeyId, items[] }` depuis le cache disque. `items: []` si pas encore synchronisé. |
| `GET /api/textures/:version/:path*` | Sert les PNG vanilla depuis `data/mc-assets/{version}/textures/{path}.png`. |
| `GET /api/textures/custom/:serverKeyId/:path*` | Sert les PNG custom depuis `data/custom-items/{serverKeyId}/textures/{path}.png`. |
| `GET /api/models/:version/:path*` | Sert les JSON de modèles vanilla depuis `data/mc-assets/{version}/models/{path}.json`. |
| `GET /api/models/custom/:serverKeyId/:path*` | Sert les JSON de modèles custom depuis `data/custom-items/{serverKeyId}/models/{path}.json`. |

Cache disque : `backend/data/custom-items/{server_key_id}/hash.txt`, `items.json`, `textures/`.

**Invariant custom items hash** — `CustomItemsManager.buildBundle()` calcule le hash en inline à partir des items/textures déjà collectés (ne rappelle pas `computeHash()` séparément) pour garantir la cohérence hash ↔ data.

---

## Variables d'environnement (backend)

| Variable | Défaut | Usage |
|---|---|---|
| `PORT` | `3001` | Port HTTP/WS du backend |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/interfaze` | URL de connexion PostgreSQL |
| `API_BASE_URL` | `http://localhost:3001` | URL publique du backend (envoyée dans `hello_ack.api_url`) |
| `BUNDLE_BASE_URL` | `= API_BASE_URL` | URL utilisée dans `bundle_available.url` (plugin → download) |

---

## Tests — ce qui est couvert

| Scope | Fichiers | Count |
|---|---|---|
| Backend unit + intégration | `hub.test.ts`, `bundles.test.ts`, `serverKeys.test.ts`, `app.test.ts`, `editorSession.test.ts`, `integration.test.ts`, `customItems.test.ts`, `models.test.ts`, etc. | ~104 pass (2 pre-existing failures: `link_codes schema`, `findSessionByTrustCode`) |
| Plugin unit + intégration | `BundleHasherTest`, `ConflictDetectionTest`, `BundleDownloaderTest`, `CustomItemsManagerTest`, `ActionExecutorTest`, `FullSyncIntegrationTest`, etc. (26 fichiers) | ~190 |
| Editor unit | Vitest, 400 tests couvrant expr DSL, canvas, export, i18n, custom items Library, mcModelRenderer | 400 |
| E2E editor | `smoke.spec.ts` (Playwright) — canvas charge, sidebar visible | 1 |

E2E cross-stack (editor → backend → plugin en bout en bout) : **non automatisé**, test manuel via Docker.
