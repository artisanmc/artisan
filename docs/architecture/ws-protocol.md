# WS Protocol — plugin ↔ backend

> Référence du protocole WebSocket entre le plugin Kotlin et le backend.
> Source de vérité du code : `backend/src/ws/hub.ts`, `editor/src/lib/ws/pluginBridge.ts`, plugin `WsClient.kt`.
> Quand tu modifies un message, mets à jour ce fichier (cf. tableau de discipline docs dans `CLAUDE.md`).

## Versioning / forward-compat

`hello` carries `protocol_version: "1"` + `core_version`. Unknown message types are logged + ignored (forward-compat). Tout endpoint REST associé est sous `/api/v1/`.

## Messages

| Message | Sens | Contenu clé |
|---|---|---|
| `hello` | plugin → backend | `server_key`, `current_bundle_hash`, `custom_items_hash?`, `installed_modules?: {id, version}[]` — modules enregistrés dans le `ModuleRegistry` au moment de la connexion ; le backend persiste par server_key (`server_modules`), l'éditeur lit pour gater la visibilité des modules (activation par présence, spec 2026-06-15 §8). Absent sur anciens plugins. |
| `modules_changed` | plugin → backend | `{ type, server_key, installed_modules: {id, version}[] }` — émis quand un module se `register()`-e après l'envoi du `hello` (ex: plugin tiers `onEnable`). Le backend re-exécute `persistServerModules` pour la même session. Absent sur anciens plugins. |
| `hello_ack` | backend → plugin | `pack_hashes`, `needs_sync`, `api_url`, `resource_pack: { url, hash } \| null`, `deleted_pack_ids: string[]` — liste des packs supprimés côté éditeur depuis la dernière connexion, pour que le plugin puisse move-to-trash les packs locaux correspondants. **Phase 2** : `pack_hashes[packId]` = `branch.head_commit.contentHash` (branche `"main"` en V1 ; le pack est résolu via `packs.serverKeyId`). |
| `bundle_available` | backend → plugin | `pack_id`, `url`, `hash` |
| `draft_update` | backend → plugin | `menu_id`, `menu_yaml` |
| `editor_session_request` | plugin → backend | `sender` |
| `editor_session_ready` | backend → plugin | `url`, `expires_at`, `trust_code` |
| `editor_session_revoke` | plugin → backend | `{}` |
| `editor_trust_request` | plugin → backend | `trust_code` |
| `session_trusted` | backend → éditeur WS | `{}` |
| `session_expired` | backend → éditeur WS | `{}` |
| `ping` / `pong` | backend ↔ plugin | keepalive OkHttp 30s |
| `resource_pack_updated` | backend → plugin | `{ url, hash }` — broadcast après chaque rebuild |
| `custom_items_changed` | plugin → backend | `{ hash }` — hot-reload Nexo/Oraxen/ItemsAdder |
| `custom_items_request` | backend → plugin | `{}` — demande le bundle complet |
| `custom_items_bundle` | plugin → backend | `{ hash, data }` — `data = base64(gzip(zip))` |
| `pack_divergence_detected` | plugin → backend | `{ pack_id, disk_files, disk_hash, last_synced_hash }` — **Plan 1C: handler is now a no-op for backward compat; new plugins log WARN instead** |
| `pack_deleted` | backend → plugin | `{ pack_id }` — pack supprimé côté éditeur, le plugin move-to-trash |
| `local_push` | plugin → backend | `{ pack_id, files, hash }` — used by `/artisan pushLocal`. Backend creates pack if missing (avec `serverKeyId` de la session), upserts content, broadcasts `bundle_available`. |

## Flux de données (orientation)

```
[Editor browser]
   │ WS ws://backend:3001/ws/plugin  (pluginBridge.ts)
   │ POST /api/v1/bundles/:packId    (bundlePublisher.ts)
   ▼
[Backend Bun/Hono]
   │ WS /ws/plugin                   (hub.ts)
   │ REST /api/v1/bundles, /api/v1/server-keys, ...
   ▼
[Plugin Kotlin]
   │ hello → hello_ack + bundle_available
   │ GET /api/v1/bundles/:packId     (BundleDownloader.kt)
   └ écrit sur disque → hot-reload menus
```

## Invariants liés (détaillés dans `CLAUDE.md` § Invariants critiques)

- **Conflit = freeze** : tant que `pack_conflicts.resolved_at IS NULL`, aucun `bundle_available` n'est broadcast pour ce `(server_id, pack_id)` (`pushBundleAvailable` dans `hub.ts`).
- **Hash byte-order** : `BundleHasher.kt` / `hashUtils.ts` trient par ordre byte natif — jamais `localeCompare`.
- **OkHttp thread** : `SyncedMenuProvider.handleMessage` tourne sur le callback WS d'OkHttp — pas d'I/O bloquant direct.
