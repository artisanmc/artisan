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

### Changed
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
