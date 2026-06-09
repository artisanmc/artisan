# REST endpoints — index

> **Source de vérité = les fichiers de routes** (`backend/src/routes/*.ts`). Ce doc ne recopie pas
> chaque signature (elle dériverait) : il dit **quel fichier ouvrir** pour quelle surface, les
> conventions transverses, et les **flux non-évidents** qu'un skim du code ne révèle pas.
> Pour les codes d'erreur exacts, le body et le statut : lire le handler.

## Conventions

- Tout endpoint est sous **`/api/v1/`** (versioning : breaking change → `/api/v2/<name>` à côté, garder v1 6-12 mois).
- **Deux systèmes d'auth distincts**, cookies coexistants :
  - **Trust dance** (server_key + `editor_session` token dans l'URL) → routes `editor-session/:token/*`. Pas de compte user requis (session-mode).
  - **User session** (cookie `artisan_user_session`, HttpOnly 30j → row `user_sessions.id`) → routes `networks/*`, `user/packs/*`, `auth/*`.
- Style d'erreur : `c.json({ error: "snake_case_reason" }, <status>)`.

## Index par fichier de routes

| Fichier | Surface |
|---|---|
| `auth.ts` | `auth/signup`, `auth/login`, `auth/logout`, `auth/me` (GET + PATCH `editor_language`), `auth/discord/start`, `auth/discord/callback`. |
| `discordOauth.ts` | Lib OAuth Discord (exchange code, fetch user) consommée par `auth.ts`. |
| `link.ts` | `link/:code/claim` — **login required**, smart-count network (cf. flux ci-dessous). |
| `userNetworks.ts` | `networks` (CRUD), `networks/:id/server-keys` (create / `rotate` / DELETE / `status` / `helloes` / `allowlist`), `networks/:id/packs` (POST — **`serverKeyId` requis**). |
| `userBranches.ts` | `networks/:id/packs/:packId/branches` (list/create), `commits` (list / POST / `:commitId/content`), `branches/:src/promote/:dst`, `branches/:src/merge-into/:dst` (+ `/resolve`). |
| `userPacks.ts` | `user/packs/:packId` (GET / PUT, user-auth + membership check). PUT broadcast `bundle_available`. |
| `networkTransfers.ts` | `networks/:id/transfer/init`, `networks/transfer/:token` (GET / `accept`). Transfert de propriété d'un Network (TTL 24h, clean break). |
| `editorSession.ts` | `editor-session/:token` (GET, inclut `network_id`), `…/custom-items`, `…/packs/:packId/assets` (CRUD + `:id/duplicate`), `…/packs/:packId` (DELETE soft + auto-resolve conflits), `…/resource-pack/rebuild`. |
| `assets.ts` | Handlers assets per-pack (upload PNG, list, detail, PATCH name/ascent/height, duplicate glyph, delete). Montés sous `editor-session/:token`. |
| `bundles.ts` | `bundles/:packId` (publish POST / download GET) — consommé par le plugin (`BundleDownloader.kt`). |
| `serverKeys.ts` | Création server_key standalone (auto-crée un Network par défaut). |
| `textures.ts` / `textures.assets` | Sert PNG : vanilla (`textures/:version/*`), custom (`textures/custom/:sk/*`), asset (`textures/asset/:packId/:assetId`), asset-font (`textures/asset-font/:assetId/*`). |
| `models.ts` / `modelBundle.ts` | Sert JSON modèles : vanilla (`models/:version/*`), custom (`models/custom/:sk/*`). |
| `resourcePack.ts` | `resource-pack/:server_key_id/:hash.zip` — `Cache-Control: immutable`, `ETag`. 404 si hash inconnu. |
| `modules/assistant/routes.ts` | `assistant/conversations` (POST — seed working-copy depuis `menus`/`attachments`, renvoie `{conversationId}`), `assistant/conversations/:id/messages` (POST — **réponse SSE**, flux d'`EngineEvent`). Auth **editor-session** (`Authorization: Bearer <access token>`, `validateAccessToken`). Monté via `assistantModule` (cf. `mountModules` dans `app.ts`). |

## Flux non-évidents

- **Merge sémantique (handshake en 2 temps)** : `POST …/merge-into/:dst` calcule le plan (`kind: already_merged | fast_forward | auto | conflicts`) mais **ne crée pas de commit** sauf `fast_forward`. Le client résout côté éditeur puis `POST …/merge-into/:dst/resolve` avec `{resolutions, lcaCommitId, srcCommitId, dstCommitId, mergedFilesJson, mergedEditorJson}` → crée le merge commit (`parentId = dst.head`, `parentId2 = src.head`). `409 stale_merge` si les heads ont bougé entre les deux. Détail modèle : `entities.md`.
- **Promotion** : `promote/:dst` est **fast-forward only** → `409 not_fast_forward` si divergence.
- **Claim link** (`link/:code/claim`) : **login required**. Smart-count des networks de l'user : 0 → auto-crée "Mon Réseau" ; 1 → l'utilise ; 2+ → `400 must_choose_network` (le client renvoie `{network_id}`).
- **Conflit = freeze** : tant qu'un `pack_conflicts` est ouvert, `bundle_available` n'est pas broadcast (cf. `CLAUDE.md` § Invariants).
- **DELETE pack** (`editor-session/:token/packs/:packId`) : soft-delete (`deletedAt`) + auto-résout tout conflit ouvert en `"editor"` + broadcast `pack_deleted`. L'éditeur devient autoritaire.
- **Custom items** : `editor-session/:token/custom-items` lit le **cache disque** (`data/custom-items/{sk}/{hash.txt,items.json,textures/}`), peuplé par le plugin via WS `custom_items_bundle`. `items: []` si pas encore synchronisé.
- **Resource pack multi-pack** : `rebuildResourcePack(serverKeyId)` collecte les assets de tous les packs du server_key et merge les codepoints (`lib/rpCodepointMerger.ts`).
- **server_key security** : `rotate` invalide l'ancien hash et drop l'auth des conns vivantes (re-hello requis) ; `allowlist` (IP) rejette au hello suivant + log dans `helloes`.
- **Assistant IA (SSE)** : `POST assistant/conversations` crée une conversation **en mémoire** (pas de persistance DB) scopée au `serverKeyId` de la session ; elle est seedée avec le system prompt (`buildSystemPrompt`) + une working-copy des `menus`/`attachments` fournis. `POST assistant/conversations/:id/messages` (404 si conversation inconnue ou cross-`serverKeyId`) optionnellement re-seede la working-copy (`menus` dans le body), pousse le message user, puis stream les `EngineEvent` de `runTurn` en **SSE** (`event:` = type d'event : `text`/`tool`/`menu_written`/`menu_deleted`/`usage`/`error`/`done`, `data:` = JSON de l'event). `503` si aucun provider n'est configuré (`ASSISTANT_API_KEY` absent et base non-locale).

## Endpoints supprimés (ne pas réintroduire)

- `…/packs/:packId/bindings/*` (GET/PATCH/POST/DELETE) — modèle `pack_bindings` M:N supprimé 2026-06-03 (→ 1:N `packs.serverKeyId`). Cf. `entities.md`.
