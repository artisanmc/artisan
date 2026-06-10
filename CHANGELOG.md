# Changelog

All notable changes to Artisan are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

See `docs/architecture/versioning.md` for the full versioning rules.

## [Unreleased]

### Added
- Console admin — onglet **Utilisateurs** : liste des comptes avec recherche (nom/email), vue profil avec champs éditables (nom, email, flag admin) + infos compte (méthode de connexion, date de création, networks et rôles). Backend `backend/src/routes/adminUsers.ts` : `GET /api/v1/admin/users?q=`, `GET /api/v1/admin/users/:id`, `PATCH /api/v1/admin/users/:id` (email unique → 409 `email_taken` ; self-demote interdit → 422 `cannot_demote_self` ; `passwordHash` jamais exposé). Éditeur : routes `/admin/users` + `/admin/users/:userId`, entrée « Utilisateurs » dans la sidebar admin.
- Édition des networks et serveurs (nom + slug) :
  - Endpoints REST `PATCH /api/v1/networks/:id` (name/slug) et `PATCH /api/v1/networks/:id/server-keys/:keyId` (label/slug) — membre requis, `:id` réseau accepte id ou slug, slug canonique exigé (422 `invalid_slug`), unicité (409 `slug_taken` ; scope global pour les networks, par network pour les serveurs).
  - Éditeur : section « Général » (nom + slug) dans les settings réseau (navigation automatique vers la nouvelle URL après changement de slug) ; action « Modifier le serveur… » dans le kebab des cartes serveur (`EditServerModal`, label + slug). Helper `editor/src/lib/slug.ts` (miroir du `slugify` backend) ; clients API `updateNetwork` / `updateServerKey`.
- Historique des conversations de l'assistant IA — **persistées en DB** (`assistant_conversations`, migration 0007), scopées par workspace (`ownerKey` + `packId`). Le panneau ouvre sur une **liste** (titre auto depuis le 1er message + date) avec « Nouvelle conversation » ; cliquer une conversation **recharge son transcript** et on continue dessus. Backend : repo `conversationRepo.ts` + endpoints `GET /assistant/conversations?packId=` (liste) et `GET /assistant/conversations/:id` (transcript), persistance du transcript après chaque tour SSE. Front : `AssistantBody` (liste ↔ chat), `AssistantConversations` (liste), `AssistantChat` reprend via `conversationId`.
- Socle console super-admin (plan 1 — `docs/superpowers/plans/2026-06-09-admin-1-access-secrets.md`) :
  - `users.is_admin` (BOOLEAN, migration 0006) + amorçage env `ADMIN_BOOTSTRAP_EMAILS` (CSV) dans `userAuth` (promotion une fois, guard `!isAdmin`). `GET /me` expose `isAdmin`.
  - Middleware `requireAdmin()` (`backend/src/middleware/requireAdmin.ts`) — 403 si non-admin (assume `userAuth` en amont ; câblé aux routes en plan 2).
  - Table générique `app_settings` (`key`/`value` JSON/`updated_at`/`updated_by`, migration 0006) pour les settings plateforme.
  - `secretBox` (`backend/src/lib/secretBox.ts`) — AES-256-GCM (`CONFIG_ENC_KEY`), `encryptSecret` / `decryptSecret` / `isSecretsConfigured`.
- Config IA en DB éditable par l'admin (plan 2 — `docs/superpowers/plans/2026-06-09-admin-2-config-backend.md`) :
  - Store générique `getSetting` / `setSetting` (`backend/src/lib/appSettings.ts`) — clé → valeur JSON dans `app_settings`, upsert avec `updatedBy`.
  - `loadAssistantProviderConfig()` (`backend/src/modules/assistant/provider/dbConfig.ts`) — lit `app_settings["assistant"]` (clé API déchiffrée via `secretBox`) si présente & utilisable, sinon fallback `resolveProviderConfig(env)` (inchangé). Le moteur SSE (`routes.ts`) résout désormais via ce loader → une modif admin prend effet **sans redeploy**.
  - Endpoints super-admin `GET` / `PUT` `/api/v1/admin/assistant-config` + `POST /api/v1/admin/assistant-config/test` (`backend/src/modules/assistant/adminRoutes.ts`), gardés `userAuth` + `requireAdmin` (montés sur `/api/v1/admin/*` dans `app.ts`). GET expose `keySet: boolean` (jamais la clé) ; PUT chiffre la clé et la **préserve** quand `apiKey` est vide ; `/test` valide un provider sans persister.
- UI console admin (plan 3 — `docs/superpowers/plans/2026-06-09-admin-3-ui.md`) :
  - Route éditeur `/admin` (`editor/src/routes/admin.tsx`) — shell à onglets (v1 = onglet « IA »), gardée côté composant via `authStore` (`isAdmin` du `/me`) : `null` pendant l'hydratation, message « admins only » sinon.
  - Formulaire de config IA (`editor/src/features/admin/AssistantConfigForm.tsx`) — provider / base URL / model + clé API **write-only** (champ vide = inchangée, placeholder « •••• définie » si `keySet`) + boutons « Tester la connexion » et « Enregistrer ».
  - Client API admin en **cookie** (`editor/src/lib/api/adminConfig.ts`, `credentials:"include"`) ; `AuthUserDto.isAdmin` ; entrée « Console admin » sur la page compte (visible seulement pour les admins) ; namespace i18n `admin.*` (en + fr).
- Versioning foundations (`docs/architecture/versioning.md`):
  - Stability annotations under `net.artisanmc.modules.api.annotations` — `@Stable`, `@Beta`, `@Internal`, `@Sunset(reason, removeInVersion, replacement)`. (`@Sunset` replaces `@Deprecated` in the spec to avoid clashing with `kotlin.Deprecated`.)
  - Schema migration framework: `SchemaMigration<T>` interface + `SchemaRegistry<T>.loadToCurrent()` chained migrator + `UnsupportedSchemaVersionException` / `CircularMigrationException`. Wired via `ArtisanAPI.schemas`.
  - `schema` discriminator field at top of menu, command, dialog, manifest YAML (`menu/v1`, `command/v1`, `dialog/v1`, `manifest/v1`). Plugin `PackReader` enforces; editor `transform.ts` emits.
  - WS hello carries `protocol_version: "1"` + `core_version`. Backend tolerates unknown message types (logs + returns `{ reply: null }`).
  - Backend Drizzle migrations folder `backend/drizzle/` + `db:generate` / `db:migrate` scripts. Docker compose backend boot uses `db:migrate` (idempotent).
  - `CHANGELOG.md` (this file), `docs/architecture/api-surface.md`.
- Modular monolith pattern (`docs/architecture/modules.md`):
  - `ArtisanModule` / `BackendModule` / `FrontendModule` interfaces with module registries on all 3 layers.
  - `DataSourceRegistry`, `CommandRegistry`, `ModuleEventBus` (plugin) + cross-module event bus on editor side via WS `module_event`.
  - `<SchemaForm>` JSON-Schema→React-form generator (`editor/src/components/SchemaForm/`).
  - `menus` and `commands` modules wrap existing engine code without rewrite.
- Schema canonicalisation P1.0 (`docs/architecture/schemas-codegen.md`) :
  - `menu/v1` canonicalisé : `title` en tableau de layers, `click` en step-tree, `context_inputs` en snake_case, nouvelles actions `show_title` / `open_dialog` / `close_dialog` / `set_arg*`, nouvelle condition `expression`.
  - Validateur ajv `menu/v1` (`editor/src/schema/validateMenuV1.ts`) + exemples canoniques (`docs/schema/menu/v1/examples/`) + CI de validation (`.github/workflows/schema.yml`).
  - Codegen quicktype évalué et écarté (NO-GO — aplatit les unions discriminées en god-objects ; cf. `docs/schema/CODEGEN.md`) → types écrits à la main, `schema.json` source de vérité.
- Schema canonicalisation P1.1 — conformité éditeur (`docs/architecture/schemas-codegen.md`) :
  - L'export éditeur (`editor/src/features/export/transform.ts`) émet désormais la forme canonique `menu/v1` : conditions composites en `of` (au lieu de `all`/`any`), `if` d'appearance en tableau `Condition[]`, `title` toujours en tableau de layers (plus de raccourci string plain-only), action `paginate` → `pagination_next` / `pagination_prev`.
  - Oracle de conformité ajv « golden pack → export → validate » (`editor/src/features/export/canonical.test.ts`).
  - Miroir de types à la main `docs/schema/menu/v1/types.ts` aligné sur le schéma canonique.
- Schema canonicalisation P1.2 — conformité plugin (`docs/architecture/schemas-codegen.md`) :
  - Oracle cross-stack « exemples éditeur compilent dans le plugin » (`plugin/src/test/kotlin/net/artisanmc/plugin/engine/CanonicalConformanceTest.kt`) : parse `docs/schema/menu/v1/examples/canonical-*.json` à travers `BundleCompiler` sans erreur.
- Convertisseur `menu/v1 → domain` (`editor/src/schema/menuV1ToDomain.ts`) — inverse de l'export domain→menu/v1 (feature IA, sous-plan 1) :
  - Fonction pure `menuV1ToDomain(src, opts) → { menu, i18nKeys, unsupported }` : pont i18n (littéral → nouvelle clé allouée ; `{i18n:KEY}` → réf + copie de la traduction fournie), un-snake (`asset_id`→`assetId`, `menu_id`→`menuId`, `line_height`→`lineHeight`…), `size`→`rows`, `pagination_*`→`paginate{direction}`. Mappe explicitement le **sous-ensemble domain** du vocab actions/conditions ; tout construct hors domain est listé dans `unsupported` (pas de crash). Aucune mutation de pack — les clés i18n allouées sont retournées.
  - Oracle round-trip domain↔menu/v1 (`editor/src/schema/menuV1ToDomain.roundtrip.test.ts`) : domain → `transform` → parse YAML → `menuV1ToDomain` → assertions structure + texte résolu.
- Abstraction `LLMProvider` OpenAI-compatible (feature IA, sous-plan 2a — `backend/src/modules/assistant/provider/`) :
  - Interface neutre `LlmProvider.streamTurn` (`types.ts`) émettant des `LlmStreamEvent` (`text` / `tool_use` / `usage` / `done`) — indépendante du SDK et du fournisseur.
  - Adaptateur unique `OpenAICompatibleProvider` (SDK `openai`, client injectable pour les tests) : mapping messages/tools + normalisation du streaming et des tool-calls fragmentés.
  - Resolver de presets piloté par l'env (`config.ts`) : `openai` (défaut) / `deepseek` / `mistral` / `openrouter` / `local`, avec overrides `ASSISTANT_BASE_URL` / `ASSISTANT_MODEL`. Feature désactivée (renvoie `null`) sans clé sauf base URL locale. Aucun SDK Anthropic — multi-provider via le protocole OpenAI-compatible.
  - Variables d'environnement `ASSISTANT_PROVIDER` / `ASSISTANT_API_KEY` / `ASSISTANT_BASE_URL` / `ASSISTANT_MODEL` (documentées dans `.env.example`).
- Cœur agentique de l'assistant (feature IA, sous-plan 2b — `backend/src/modules/assistant/`) :
  - Gate de validation `menu/v1` backend (`validate.ts`) — `ajv(docs/schema/menu/v1/schema.json)` + `validateMenuLayout` (importé de `docs/schema/menu/v1/types.ts`). **Exactement le même contrat que l'éditeur** : un menu invalide ne peut pas entrer dans la working-copy ; les erreurs sont renvoyées au modèle pour auto-correction.
  - Working-copy en mémoire (`workingCopy.ts`) : `Map<menuId, menu/v1>` + attachments `Map<fileId, texte>`.
  - Tools que l'IA appelle (`tools.ts`) : `list_menus` / `get_menu` / `upsert_menu` (passe par le gate) / `delete_menu` / `read_attachment`, avec `TOOL_DEFS` (JSON-Schema) + `executeTool` émettant des `EngineEvent` (`menu_written` / `menu_deleted` / `tool` / …).
  - Boucle agentique manuelle (`loop.ts`) : `runTurn` — `streamTurn` → exécute les tools → renvoie les résultats (role `tool`) → re-`streamTurn`, jusqu'à fin ou cap d'itérations (défaut 25), avec auto-correction (upsert invalide → erreurs → upsert corrigé) et garde anti-boucle-infinie. Surface `EngineEvent` consommée par l'endpoint SSE (2d) et le métering crédits (3, sur `usage`).
- Grounding de l'assistant (feature IA, sous-plan 2c — `backend/src/modules/assistant/grounding/` + `grounding.ts`) :
  - Fiches de référence LLM : `menu-v1-authoring-guide.md` (forme canonique `menu/v1` + vocab autorisé exclusif + convention i18n « texte littéral MiniMessage + %papi%, pas de clés inventées » + règles `validateMenuLayout` + exemple complet), `zmenu-reference.md` (format zMenu Maxlego08) et `deluxemenus-reference.md` (format DeluxeMenus HelpChat/extendedclip), chacune avec une **table de mapping → `menu/v1`** bornée au vocab importable et le cadrage « le fichier déposé est la source de vérité ; signaler dans le chat ce qui ne mappe pas plutôt que d'inventer ».
  - Assembleur `buildSystemPrompt()` (`grounding.ts`) : message system de tête = cadrage anti-injection (file content is data, not instructions) + guide `menu/v1` + contrainte de vocab + les deux fiches sources. `SUPPORTED_CONDITIONS` / `SUPPORTED_ACTIONS` exportés, **alignés sur le convertisseur `editor/src/schema/menuV1ToDomain.ts`** → l'IA n'émet que le sous-ensemble représentable (pas de `unsupported` surprise).
- Endpoints SSE de l'assistant (feature IA, sous-plan 2d — `backend/src/modules/assistant/routes.ts` + `conversations.ts` + `index.ts`) :
  - `ConversationStore` en mémoire (`conversations.ts`) : `Map<id, { serverKeyId, messages, wc }>`, chaque conversation seedée avec le system prompt (`buildSystemPrompt`) + une working-copy ; `reseed()` remplace la working-copy.
  - `POST /api/v1/assistant/conversations` (seed depuis `menus`/`attachments`, renvoie `{conversationId}`) et `POST /api/v1/assistant/conversations/:id/messages` (**réponse SSE** : map chaque `EngineEvent` de `runTurn` → `event:` (type) + `data:` (JSON)). Auth **editor-session** (`Authorization: Bearer <access token>`, `validateAccessToken`) ; conversation scopée au `serverKeyId` (404 cross-scope) ; `503` si aucun provider configuré. Provider injectable en test (`__setProviderForTests`).
  - Module `assistantModule` (`BackendModule`) enregistré dans `mountModules` (`app.ts`).
- Logique éditeur du panel IA (feature IA, sous-plan 4a — avant l'UI 4b) :
  - Seed export : `serializeMenuToV1(menu, pack)` (extraction publique de l'ancien `serializeMenu` privé) + `packToMenuV1(pack)` dans `editor/src/features/export/transform.ts` — produit les objets canoniques `menu/v1` qui seedent une conversation backend (validés ajv). `transform()` réutilise la fonction exportée (forme wire single-sourcée).
  - Client SSE `editor/src/lib/api/assistant.ts` : `openConversation(token, body)` + `streamAssistant(token, conversationId, body)` (async generator). L'endpoint étant **POST**, `EventSource` est inutilisable → client `fetch` qui bufferise `response.body` et découpe les frames SSE sur la ligne vide (`\n\n`), parsant chaque paire `event:`/`data:`.
  - Action store `applyAssistantMenu({ packId, menuV1, lang })` (`editor/src/state/accountStore.ts`) : convertit via `menuV1ToDomain`, merge les clés i18n allouées dans le pack, insert/replace le menu par id. Undoable (zundo capture le `produce`).
- Panel chat de l'assistant IA (feature IA, sous-plan 4b — l'UI) :
  - `editor/src/features/assistant/AssistantPanel.tsx` : overlay `Sheet` (droite, mobile-friendly) avec transcript + composer. Drag-drop de fichiers zmenu/DeluxeMenus → `attachments`. Boucle `streamAssistant` (4a) qui rend le texte en flux et applique en live au canvas : `menu_written` → `applyAssistantMenu`, `menu_deleted` → `deleteFromPack`, `error` → toast. Chaque message re-seede la working-copy backend avec `packToMenuV1(pack)` + `attachments` (last-writer).
  - Flag transitoire `uiStore.assistantPanelOpen` / `setAssistantPanelOpen` (non persisté), bouton top-bar `Sparkles` (`WorkspaceTopBarControls`), montage `<AssistantPanel packId>` dans la route workspace. Namespace i18n `assistant.*` (en + fr). Pas de module sidebar (overlay, pas de route).

### Changed
- Assistant IA : sur desktop (≥lg) le panneau s'ouvre en **pane latéral droit redimensionnable** (réutilise `SplitPane`, largeur persistée `uiStore.assistantPaneWidth`) au lieu d'une modale par-dessus le canvas ; sur mobile il reste un drawer (`Sheet`). Logique chat extraite dans `AssistantChat`, partagée par `AssistantPane` (desktop) et `AssistantPanel` (drawer mobile, gated `!isDesktop`). Le bouton top-bar ✨ devient un toggle.
- Entrée « Console admin » ajoutée au menu utilisateur (bas-gauche, `UserMenu`), visible seulement si `currentUser.isAdmin` — raccourci vers `/admin` (en plus du lien sur la page compte).
- `ConditionParser` (plugin) lit `of` pour les conditions composites `and`/`or` (au lieu de `all`/`any`), réalignant le plugin sur la forme `menu/v1` canonique émise par l'éditeur (P1.1). Restaure l'intégration éditeur↔plugin pour les conditions composites.
- **BREAKING (pre-1.0)** REST API now under `/api/v1/*` instead of `/api/*`. Plugin + editor clients updated in the same release. Legacy `/api/*` paths return 404 — no compatibility alias.

### Deprecated
- Nothing yet.

### Removed
- `menu/v1` schema: retrait des types `StandardClick` / `ComponentClick` (remplacés par le step-tree de `click`) et de la condition `Cooldown`.

### Fixed
- Assistant IA : les **fichiers joints étaient invisibles pour le modèle** — il répondait « dépose tes fichiers » alors qu'ils étaient déjà attachés. Le tool `read_attachment` prend un `file_id`, mais rien dans le tour n'annonçait quels ids existaient. `POST /assistant/conversations/:id/messages` injecte désormais un message `system` listant les fichiers joints (file_id = nom exact) avant le message user. Côté UI, le compteur « N fichier(s) joint(s) » est remplacé par une **liste de chips** (nom + taille + bouton retirer) et un bouton **trombone** (file picker) complète le drag-drop — indispensable sur mobile.
- Assistant IA : un menu généré pouvait être **perdu si on rechargeait dans les ~2 s** (l'auto-save est debounced à 2 s, et un reload avant son déclenchement écrasait le menu non sauvé). Le pack est désormais **persisté immédiatement** après chaque `menu_written` / `menu_deleted` de l'assistant. Logique de sauvegarde extraite dans `editor/src/features/pack/persistPack.ts`, partagée par l'auto-save (`usePackAutoSave`) et l'assistant.
- Éditeur : bande grise en bas du canvas / panneau d'édition à l'ouverture du pane assistant — `<main>` passait d'un parent flex (où `flex-1` l'étire) au wrapper **bloc** du `SplitPane` (où `flex-1` est inopérant) et retombait à la hauteur du contenu ; `h-full` ajouté pour qu'il remplisse les deux cas.
- Éditeur : un network inaccessible (403/404 — p. ex. une URL périmée pointant vers le network d'un autre compte) ne boucle plus sur une page cassée. `getNetwork` attache le status HTTP et les routes network/serveur (`networks.$networkId.tsx`, `networks.$networkId.servers.$serverId.tsx`) redirigent vers `/networks` (liste des networks de l'utilisateur).
- Assistant IA : flux SSE coupé en plein milieu (`ERR_INCOMPLETE_CHUNKED_ENCODING` côté navigateur) dès que le LLM mettait plus de 10 s — l'`idleTimeout` par défaut de Bun (10 s) tuait le stream. Relevé à 255 s (max Bun) dans `backend/src/index.ts` ; chaque écriture SSE réarme l'horloge d'inactivité.
- Assistant IA injoignable dans l'éditeur web : le panel vit dans la route user-auth (`networks/.../workspaces/$workspaceId`) mais s'authentifiait via le token editor-session (`sessionStore.accessToken`), toujours `null` hors trust-dance plugin → `send()` sortait en silence (clic « Envoyer » sans effet). Le routeur assistant (`backend/src/modules/assistant/routes.ts`) accepte désormais **soit** le Bearer editor-session **soit** le cookie `artisan_user_session` (conversations scopées par `ownerKey` = `sk:<serverKeyId>` ou `user:<userId>`) ; le client front (`editor/src/lib/api/assistant.ts`) envoie `credentials:"include"` et n'ajoute le Bearer que s'il existe ; la garde du panel autorise un token **ou** un utilisateur connecté.
- Race condition in editor: `/`, `/link`, `/transfer` routes no longer redirect to `/login` before `authStore.hydrate()` completes. `isLoading` now starts `true` and routes gate on it.

### Security
- Nothing yet.

## [1.0.0-alpha] - 2026-05-25

### Added
- Pre-release alpha. See git log for the full history (auth, accounts × networks UX, multi-server bindings, branches + commits, Phase 3 semantic merge, title composer v3, resource pack delegation, custom items integration, etc.). Future releases will follow proper SemVer.
