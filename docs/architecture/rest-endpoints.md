# REST endpoints — index

> **Source de vérité = les fichiers de routes** (`backend/src/routes/*.ts`). Ce doc ne recopie pas
> chaque signature (elle dériverait) : il dit **quel fichier ouvrir** pour quelle surface, les
> conventions transverses, et les **flux non-évidents** qu'un skim du code ne révèle pas.
> Pour les codes d'erreur exacts, le body et le statut : lire le handler.

## Conventions

- Tout endpoint est sous **`/api/v1/`** (versioning : breaking change → `/api/v2/<name>` à côté, garder v1 6-12 mois).
- **Deux systèmes d'auth distincts**, cookies coexistants :
  - **Trust dance** (server_key + `editor_session` token dans l'URL) → routes `editor-session/:token/*`. Pas de compte user requis (session-mode).
  - **User session** (cookie `artisan_user_session`, HttpOnly 30j → row `user_sessions.id`) → routes `networks/*`, `user/projects/*`, `auth/*`, `admin/*`. Les routes `admin/*` ajoutent `requireAdmin` après `userAuth` (403 si `!user.isAdmin`).
- Style d'erreur : `c.json({ error: "snake_case_reason" }, <status>)`.

## Index par fichier de routes

| Fichier | Surface |
|---|---|
| `auth.ts` | `auth/signup`, `auth/login`, `auth/logout`, `auth/me` (GET + PATCH `editor_language`), `auth/discord/start`, `auth/discord/callback`. |
| `discordOauth.ts` | Lib OAuth Discord (exchange code, fetch user) consommée par `auth.ts`. |
| `link.ts` | `link/:code/claim` — **login required**, smart-count network (cf. flux ci-dessous). |
| `userNetworks.ts` | `networks` (CRUD + PATCH `:id` — name/slug, 409 `slug_taken`), `networks/:id` (GET détail — chaque project porte `documentCount` = menus+commandes+dialogs, pour l'indicateur sidebar/Projects), `networks/:id/server-keys` (create / PATCH `:keyId` — label/slug / `rotate` / DELETE / `status` / `helloes` / `allowlist`), `networks/:id/projects` (POST — **`serverKeyId` requis**). Les `:id` réseau acceptent id **ou** slug. |
| `userBranches.ts` | `networks/:id/projects/:projectId/branches` (list/create), `commits` (list / POST / `:commitId/content`), `branches/:src/promote/:dst` (**fast-forward only**). Pas de merge 3-way / résolution de conflits — retiré le 2026-06-17 (cf. ADR `no-branch-conflict-resolution`). |
| `userProjects.ts` | `user/projects/:projectId` (GET / PUT, user-auth + membership check). PUT broadcast `bundle_available`. |
| `networkTransfers.ts` | `networks/:id/transfer/init`, `networks/transfer/:token` (GET / `accept`). Transfert de propriété d'un Network (TTL 24h, clean break). |
| `editorSession.ts` | `editor-session/:token` (GET, inclut `network_id`), `…/modules` (GET — modules actifs du serveur, activation par présence depuis `server_modules`), `…/custom-items`, `…/projects/:projectId/assets` (CRUD + `:id/duplicate`), `…/projects/:projectId` (DELETE soft + auto-resolve conflits), `…/resource-pack/rebuild`. |
| `assets.ts` | Handlers assets per-project (upload PNG, list, detail, PATCH name/ascent/height, duplicate glyph, delete). Montés sous `editor-session/:token`. |
| `bundles.ts` | `bundles/:projectId` (publish POST / download GET) — consommé par le plugin (`BundleDownloader.kt`). |
| `serverKeys.ts` | Création server_key standalone (auto-crée un Network par défaut). |
| `textures.ts` / `textures.assets` | Sert PNG : vanilla (`textures/:version/*`), custom (`textures/custom/:sk/*`), asset (`textures/asset/:packId/:assetId`), asset-font (`textures/asset-font/:assetId/*`). |
| `models.ts` / `modelBundle.ts` | Sert JSON modèles : vanilla (`models/:version/*`), custom (`models/custom/:sk/*`). |
| `resourcePack.ts` | `resource-pack/:server_key_id/:hash.zip` — `Cache-Control: immutable`, `ETag`. 404 si hash inconnu. |
| `modules/assistant/routes.ts` | `assistant/conversations` (**GET** — liste les conversations d'un project via `?packId=`, titres + dates seulement ; **POST** — crée une conversation `{packId}`, renvoie `{conversationId}`), `assistant/conversations/:id` (GET — transcript complet pour la reprise), `assistant/conversations/:id/messages` (POST — **réponse SSE**, flux d'`EngineEvent` ; la working-copy est reconstruite depuis `menus`/`attachments` du body, le transcript est persisté après le stream). Conversations stockées en DB (`assistant_conversations`), scopées par `ownerKey`. Auth **Bearer editor-session OU cookie `artisan_user_session`** (`resolveOwnerKey`). Monté via `assistantModule` (cf. `mountModules` dans `app.ts`). |
| `modules/assistant/adminRoutes.ts` | `admin/assistant-config` (GET — renvoie `{provider, baseUrl, model, keySet}`, **jamais la clé** ; PUT — upsert `{provider, baseUrl, model, apiKey?}` chiffré dans `app_settings`, renvoie `keySet`), `admin/assistant-config/test` (POST — teste un provider, renvoie `{ok}`). Auth **super-admin** (`userAuth` + `requireAdmin` sur `/api/v1/admin/*` dans `app.ts`). |
| `adminUsers.ts` | `admin/users` (GET — liste + recherche `?q=` sur nom/email, ilike ; expose `hasPassword`, **jamais `passwordHash`**), `admin/users/:id` (GET — profil + networks/rôles via `memberships`), `admin/users/:id` (PATCH — `name`/`email`/`isAdmin` ; email normalisé trim+lowercase, unique → 409 `email_taken`, 422 `invalid_email`/`invalid_name` ; un admin ne peut pas se retirer son propre flag → 422 `cannot_demote_self`). Auth **super-admin**. |

## Flux non-évidents

- **Promotion** : `promote/:dst` est **fast-forward only** → `409 not_fast_forward` si divergence. Le merge 3-way / résolution de conflits a été retiré le 2026-06-17 (jamais câblé en UI ; concurrence live gérée par LWW + présence) — cf. ADR `no-branch-conflict-resolution`.
- **Claim link** (`link/:code/claim`) : **login required**. Smart-count des networks de l'user : 0 → auto-crée "Mon Réseau" ; 1 → l'utilise ; 2+ → `400 must_choose_network` (le client renvoie `{network_id}`).
- **Conflit = freeze** : tant qu'un `project_conflicts` est ouvert, `bundle_available` n'est pas broadcast (cf. `CLAUDE.md` § Invariants).
- **DELETE project** (`editor-session/:token/projects/:projectId`) : soft-delete (`deletedAt`) + auto-résout tout conflit ouvert en `"editor"` + broadcast `project_deleted`. L'éditeur devient autoritaire.
- **Custom items** : `editor-session/:token/custom-items` lit le **cache disque** (`data/custom-items/{sk}/{hash.txt,items.json,textures/}`), peuplé par le plugin via WS `custom_items_bundle`. `items: []` si pas encore synchronisé.
- **Resource pack multi-project** : `rebuildResourcePack(serverKeyId)` collecte les assets de tous les projects du server_key et merge les codepoints (`lib/rpCodepointMerger.ts`).
- **server_key security** : `rotate` invalide l'ancien hash et drop l'auth des conns vivantes (re-hello requis) ; `allowlist` (IP) rejette au hello suivant + log dans `helloes`.
- **Config IA admin (DB→env)** : `admin/assistant-config` stocke la config provider dans `app_settings["assistant"]` (`StoredAssistantConfig`, clé API chiffrée AES-256-GCM via `secretBox`). Le moteur (`assistant/routes.ts` → `resolve()`) lit via `loadAssistantProviderConfig()` : **config DB déchiffrée si présente & utilisable** (model + (clé ou base locale), `CONFIG_ENC_KEY` requis), sinon fallback `resolveProviderConfig(env)`. Une modif admin prend donc effet **sans redeploy**. La clé en clair n'est **jamais** renvoyée : GET expose `keySet: boolean` ; PUT avec `apiKey` vide **préserve** la clé stockée (l'admin peut changer model/provider sans re-saisir la clé) ; PUT renvoie `503 encryption_not_configured` si on tente d'écrire une clé sans `CONFIG_ENC_KEY`. `/test` n'inclut jamais la clé dans son erreur.
- **Assistant IA (SSE)** : `POST assistant/conversations` crée une conversation **en mémoire** (pas de persistance DB) scopée au `serverKeyId` de la session ; elle est seedée avec le system prompt (`buildSystemPrompt`) + une working-copy des `menus`/`attachments` fournis. `POST assistant/conversations/:id/messages` (404 si conversation inconnue ou cross-`serverKeyId`) optionnellement re-seede la working-copy (`menus` dans le body), pousse le message user, puis stream les `EngineEvent` de `runTurn` en **SSE** (`event:` = type d'event : `text`/`tool`/`menu_written`/`menu_deleted`/`usage`/`error`/`done`, `data:` = JSON de l'event). `503` si aucun provider n'est configuré (`ASSISTANT_API_KEY` absent et base non-locale).

## Endpoints supprimés (ne pas réintroduire)

- `…/projects/:projectId/bindings/*` (GET/PATCH/POST/DELETE) — modèle `project_bindings` M:N supprimé 2026-06-03 (→ 1:N `projects.serverKeyId`). Cf. `entities.md`.
