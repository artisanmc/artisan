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
./gradlew test          # 25 tests (unit + intégration MockWebServer)
./gradlew shadowJar     # → build/libs/interfaze-plugin-1.0.0-SNAPSHOT-all.jar
```

### Backend (Bun + Hono + PostgreSQL)

```bash
cd backend
bun install
bun run db:push         # Applique le schéma Drizzle sur PostgreSQL (DATABASE_URL requis)
bun run dev             # Dev avec --watch sur port 3001
bun test                # 11 tests (unit + intégration WS réel)
```

### Editor (React 19 + Vite 6)

```bash
cd editor
npm install
npm run dev             # Vite dev server sur port 5173
npx vitest run          # 366 tests
npm run build           # Build production
```

### Stack complète (Docker)

```bash
cp .env.example .env    # puis renseigner INTERFAZE_SERVER_KEY
docker compose up       # backend:3001 + editor:5173 + minecraft:25565
docker compose build minecraft  # rebuild le JAR + image Paper
```

---

## Architecture

```
editor/          React 19 + Vite + Konva
backend/         Bun + Hono + PostgreSQL (Drizzle)
plugin/          Kotlin 2.0 + Paper 1.21.4 + OkHttp
docker/          Dockerfile multi-stage (Gradle JDK21 → Paper JRE21)
docker-compose.yml
docs/
  decisions/stack.md     ← stack technique et rationale
  specs/                 ← spec produit et éditeur
  superpowers/specs/     ← specs data sources, expression DSL
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
| `hello` | plugin → backend | `server_key`, `current_bundle_hash` |
| `hello_ack` | backend → plugin | `pack_hashes`, `needs_sync`, `api_url` |
| `bundle_available` | backend → plugin | `pack_id`, `url`, `hash` |
| `draft_update` | backend → plugin | `menu_id`, `menu_yaml` |
| `ping` / `pong` | backend ↔ plugin | keepalive OkHttp 30s |

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
    lang/<lang>.yaml
    .interfaze-sync.yaml   ← SyncMetadata (syncedHash, backendHash, syncedAt)
```

`.interfaze-sync.yaml` est exclu du hash (préfixe `.interfaze` filtré dans `BundleHasher`).

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
| Backend unit | `hub.test.ts`, `bundles.test.ts`, `serverKeys.test.ts`, `app.test.ts` | 7 |
| Backend intégration WS+HTTP | `integration.test.ts` | 4 |
| Plugin unit | `BundleHasherTest`, `ConflictDetectionTest`, `BundleDownloaderTest`, etc. | 22 |
| Plugin intégration | `FullSyncIntegrationTest` | 3 |
| Editor unit | Vitest, 366 tests couvrant expr DSL, canvas, export, i18n | 366 |
| E2E editor | `smoke.spec.ts` (Playwright) — canvas charge, sidebar visible | 1 |

E2E cross-stack (editor → backend → plugin en bout en bout) : **non automatisé**, test manuel via Docker.
