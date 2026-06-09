# Changelog

All notable changes to Artisan are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

See `docs/architecture/versioning.md` for the full versioning rules.

## [Unreleased]

### Added
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

### Changed
- `ConditionParser` (plugin) lit `of` pour les conditions composites `and`/`or` (au lieu de `all`/`any`), réalignant le plugin sur la forme `menu/v1` canonique émise par l'éditeur (P1.1). Restaure l'intégration éditeur↔plugin pour les conditions composites.
- **BREAKING (pre-1.0)** REST API now under `/api/v1/*` instead of `/api/*`. Plugin + editor clients updated in the same release. Legacy `/api/*` paths return 404 — no compatibility alias.

### Deprecated
- Nothing yet.

### Removed
- `menu/v1` schema: retrait des types `StandardClick` / `ComponentClick` (remplacés par le step-tree de `click`) et de la condition `Cooldown`.

### Fixed
- Race condition in editor: `/`, `/link`, `/transfer` routes no longer redirect to `/login` before `authStore.hydrate()` completes. `isLoading` now starts `true` and routes gate on it.

### Security
- Nothing yet.

## [1.0.0-alpha] - 2026-05-25

### Added
- Pre-release alpha. See git log for the full history (auth, accounts × networks UX, multi-server bindings, branches + commits, Phase 3 semantic merge, title composer v3, resource pack delegation, custom items integration, etc.). Future releases will follow proper SemVer.
