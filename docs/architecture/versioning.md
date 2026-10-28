# Artisan — API versioning and stability

Reference manual for evolving Artisan without breaking existing servers and modules. Covers the 6 versioning surfaces, the migration patterns, the deprecation policy, the CHANGELOG discipline.

**Status**: target architecture — V1 implements the necessary minimum, the rest is added organically.

---

## 1. The 6 versioning surfaces

Artisan has 6 distinct contracts to manage. Each has its own discipline.

| Surface | Concerns | Strategy |
|---|---|---|
| **1. Data schemas** | `menu/v1`, `command/v1`, `shop/v1`, ... | Explicit versioning + migration framework |
| **2. Public Java API** | `ArtisanAPI` + classes exposed to modules | Strict SemVer + `@Stable`/`@Beta`/`@Internal` |
| **3. WebSocket protocol** | Hub ↔ server messages (`/ws/plugin`) | `protocol_version` major.minor at `hello`; different major = server not served |
| **4. REST API** | Hub ↔ editor routes | URL versioning `/api/v1/*`; editor and hub shipped in the same jar |
| **5. Database schema** | Tables of the suite's plugins (H2, MySQL, MariaDB) | Each plugin migrates its own tables; Artisan has none |
| **6. Resource pack format** | CMD strings, fonts, asset structure | `pack_format` + versioned asset registry |

All these surfaces must stay **backward compatible** within a single major version.

---

## 2. Data schemas

### 2.1 Naming pattern

Each schema lives in `/docs/schema/{name}/v{N}/` with:

- `schema.json` (JSON Schema Draft 2020-12)
- `types.ts` (mirror TypeScript)
- `README.md` (design doc + use cases)
- `examples/*.json` (test cases)

The `"schema"` field discriminates the version:

```json
{
  "schema": "menu/v1",
  "id": "shop_main",
  ...
}
```

### 2.2 Evolution rules

**Within a single version (menu/v1 → menu/v1)**:

- ✅ Add **optional** fields (backward compat)
- ✅ Loosen constraints (more permissive `maxLength`, `enum` with more values)
- ✅ Add `$defs` or patterns
- ✅ Improve descriptions, examples, error messages
- ❌ Add a **required** field (forces all producers to provide it)
- ❌ Tighten constraints (more restrictive `maxLength`, `enum` with fewer values)
- ❌ Rename an existing field
- ❌ Remove an existing field
- ❌ Change the type of an existing field

**For forbidden changes**: you make a new version (`shop/v2`).

**Files-first exception — intra-version renaming.** The three bans on
renaming/removing/retyping are modeled on surfaces where the **producer
is a third party**. For Document schemas, the producer is our canonical
writer and the consumer reads from disk. The rule actually applied is
therefore: *renaming or removing a field is allowed within the version as long
as no existing file stops being readable* — either because the reader
stays tolerant of the old form, or because we know these files
exist nowhere but with us. **The version changes when a deployed file
would stop being readable**, not when the schema changes shape.

Applied four times on `menu/v1`: `steps` → `actions`, the flattening
`layers` → `elements`, the removal of `appearances` in favor of
display + `states` (ADR `element-display-and-states`), and the fold of
`menu/v2`/`menu/v3` (2026-09-17, see `schemas-codegen.md`) — two versions
that transformed no data, whose labels remain accepted on
read for files already written.

### 2.3 Migration framework

When you introduce a v2, you write a v1 → v2 **migration**. It only has a
reason to exist if it **transforms** data: a migration that merely
rewrites the `schema` field signals a version that should not have been
born (this is what happened to `menu/v2` and `menu/v3`, folded since).

```kotlin
// /plugin/src/main/kotlin/net/artisanmc/core/schemas/migrations/ShopV1ToV2.kt
class ShopV1ToV2 : SchemaMigration<JsonObject> {
    override val from = "shop/v1"
    override val to = "shop/v2"
    
    override fun migrate(data: JsonObject): JsonObject {
        // Migration logic: rename "size" → "dimensions", split layers...
        val result = data.deepCopy()
        result["schema"] = JsonPrimitive("shop/v2")
        result["dimensions"] = jsonObject {
            "rows" to (data["size"].asInt / 9)
            "type" to "chest"
        }
        result.remove("size")
        return result
    }
}
```

### 2.4 Registry and runtime

The core plugin registers all known migrations. When a menu loads:

```kotlin
class SchemaRegistry {
    private val migrations = mutableMapOf<String, SchemaMigration<JsonObject>>()
    
    fun register(migration: SchemaMigration<JsonObject>) {
        migrations[migration.from] = migration
    }
    
    fun loadToCurrent(json: JsonObject, currentVersion: String): JsonObject {
        var current = json
        var version = current["schema"].asString
        val visited = mutableSetOf<String>()
        
        while (version != currentVersion) {
            if (version in visited) throw CircularMigrationException(version)
            visited.add(version)
            
            val migration = migrations[version]
                ?: throw UnsupportedSchemaVersionException(version)
            current = migration.migrate(current)
            version = current["schema"].asString
        }
        return current
    }
}
```

Migrations are **chained automatically**: a `menu/v1` menu can go through v1 → v2 → v3 at load with no intervention.

### 2.5 Golden rules

- A migration is **write-once**: you never modify it after shipping. If there is a bug, you write a v2 → v2.1 migration.
- A migration is **idempotent**: running it twice on the same data = same result.
- A migration is **pure**: no side effects, no network calls, no DB writes. Just data → data.
- **Tests required**: each migration has a unit test with v1 input + expected v2 output.

### 2.6 Sunsetting old versions

A `menu/v1` version stays **supported indefinitely via migration** as long as the plugin runs. The migration is free to maintain once written.

**You NEVER delete** a migration. It is needed for servers that load legacy data.

---

## 3. Public Java API

### 3.1 Package separation

```
net.artisanmc.core
├── api/                          ← Public stable API (covered by SemVer)
│   ├── ArtisanAPI.kt
│   ├── ArtisanModule.kt
│   ├── DataSourceRegistry.kt
│   ├── CommandRegistry.kt
│   ├── SchemaRegistry.kt
│   ├── ModuleRegistry.kt
│   ├── declarations/
│   │   ├── DataSourceDeclaration.kt
│   │   └── CommandDeclaration.kt
│   ├── events/
│   │   ├── MenuOpenedEvent.kt
│   │   ├── CommandExecutedEvent.kt
│   │   └── ModuleEnabledEvent.kt
│   └── annotations/
│       ├── Stable.kt
│       ├── Beta.kt
│       ├── Internal.kt
│       └── Deprecated.kt
└── internal/                     ← Internals, may change without notice
    ├── engine/
    ├── sync/
    ├── storage/
    └── impl/
```

**Absolute rule**: modules **ONLY IMPORT** from `net.artisanmc.api.*`. Never from `net.artisanmc.internal.*`.

### 3.2 Stability annotations

`plugin/api` has been written **in Java** since API 2.0.0 (ADR `extensible-document-kinds`, "Language of
the public API"): interfaces, immutable classes, enums, `@FunctionalInterface` callbacks, no
`kotlin.*` type and no `kotlin-stdlib` in the POM. The annotations live in
`net.artisanmc.modules.api.annotations`:

```java
@Retention(RetentionPolicy.SOURCE) public @interface Stable {}    // covered by SemVer
@Retention(RetentionPolicy.SOURCE) public @interface Beta {}      // may change in a minor
@Retention(RetentionPolicy.SOURCE) public @interface Internal {}  // forbidden to modules

@Retention(RetentionPolicy.RUNTIME)
public @interface Sunset {                 // dated deprecation, replaces @Deprecated
    String reason();
    String removeInVersion();
    String replacement() default "";
}
```

`ApiSurfaceIsJavaFriendlyTest` fails if a Kotlin class appears in `plugin/api/src/main` or if
a `kotlin.*` type crosses a public signature.

### 3.3 Strict SemVer

The core's public API follows **strict SemVer**:

- **Patch (1.0.0 → 1.0.1)**: zero signature change. Internal bug fixes only.
- **Minor (1.0.0 → 1.1.0)**: additions of methods, classes, fields OK. No removal, no change to an existing signature.
- **Major (1.0.0 → 2.0.0)**: removal, breaking changes OK. Avoid as much as possible.

The published version is the highest `Since` value in `api-surface.md`: raising it in the PR is enough to publish the release at merge (`publish-api.yml`, details in `api-surface.md` § Published artifact).

### 3.4 Deprecation flow

When you want to remove an API in a major:

1. **N months before the major (where N ≥ 3)**: mark `@Sunset(reason=..., removeInVersion="3.0.0", replacement="newMethod()")`.
2. The compiler warns the modules that use it.
3. `@Sunset` appears in the CHANGELOG.
4. **At the major's release**: the method is removed.
5. Incompatible modules fail gracefully (see modules.md section 13).

### 3.5 Bytecode compatibility

Beyond source compatibility, **watch binary compatibility**:

- Do not change the signature of a public method (parameters, return types, exceptions)
- Do not add a required parameter to an existing method (add a Java overload)
- Do not remove a public constructor
- Do not reorder the elements of an enum

Tool: `japicmp` in CI to catch binary compat regressions before release.

---

## 4. WebSocket protocol

Since phase F (2026-10), the protocol links the hub (the editor's web server) to the network's
servers; there is no more backend, nor plugins of different ages facing a central service.
The risk remains: hub and leaves are distinct jars, updated at different times.

### 4.1 Version in the handshake

```json
{
  "type": "hello",
  "protocol_version": "1.4",
  "server_key": "<network secret>",
  "proxy_name": "survie2",
  "plugin_version": "1.0.42",
  "minecraft_version": "1.21.7",
  "installed_modules": [{ "id": "menus", "version": "1.0.42" }]
}
```

`ProtocolVersion.CURRENT` (`plugin/core/…/protocol/ProtocolVersion.kt`) :

- **Major**: changes when an existing message changes meaning. Major different from the
  hub's → server listed "update required" (`updateRequired`), the hub sends it nothing more,
  every route that targets it answers 503 `plugin_update_required`.
- **Minor**: adds fields or messages, which the other side ignores. A route that sends an
  added message checks the target server's minor and answers 501 `plugin_update_required` instead of
  waiting for a timeout (`1.1`: `project_create`, `project_delete`, `project_rename`). `1.2`
  (`EDITOR_BUNDLES`) adds `editor_bundle` to `installed_modules` and `editor_bundle_fetch`; an
  older leaf advertises no bundle, the `ui.js` route returns 404 without sending it anything.
  `1.3` (`TEMPLATES`) adds `templates` to `installed_modules`, `template_fetch`, `template_copy` and
  `project_origins_fetch`; an older leaf gets 501 on these three routes. `1.4`
  (`DOCUMENT_CHECKS`) adds `documents_check` (ADR `mcp-server`); the MCP tool `write_document`
  refuses to write into a draft of a Project whose server is older.
- **One release = one number** for all jars; update hub and leaves together.

The server that hosts the hub talks to it in process (`LocalServerLink`): never a version gap.

### 4.2 Unrecognized messages

A message with an unknown `type` or without a required field **is never a fatal error**:
`EditorRequest.parse` returns `null` on the server side, `RemoteServer.receive` ignores it on the hub side.

### 4.3 Evolving a message

Adding an optional field: minor. Renaming, removing or changing the meaning of a field: major.
`server_key` (network secret) and `proxy_name` (server name) keep their names inherited from the
backend for this reason.

---

## 5. REST API

Since phase F, the API is served by the hub and consumed by the editor embedded in the same jar: an API change and the editor that depends on it ship together. The `/api/v1/` prefix remains, the rules below only apply if an external client appears.

### 5.1 URL versioning

```
/api/v1/menus
/api/v1/commands
/api/v1/workspaces
/api/v1/modules/shop/items     ← module-scoped
```

No version in headers — always in the URL. Simpler, more visible, easier to debug.

### 5.2 Evolution within v1

**Within v1**, you can:

- ✅ Add new endpoints
- ✅ Add optional fields to the response
- ✅ Accept new optional params
- ❌ Change the type of an existing field in the response
- ❌ Remove a field from the response
- ❌ Make a param required that was optional

### 5.3 Bump to v2

When a change requires v2:

1. **You copy the v1 → v2 routes**.
2. **You modify v2** with the breaking changes.
3. **You mark v1 endpoints as deprecated**:

```typescript
fastify.get("/api/v1/menus/:id", async (req, reply) => {
    reply.header("Sunset", "Wed, 01 Jan 2027 00:00:00 GMT");
    reply.header("Deprecation", "true");
    reply.header("Link", '</api/v2/menus/${req.params.id}>; rel="successor-version"');
    // ... handler
});
```

4. **You maintain both versions in parallel for 6-12 months**.
5. **You sunset v1** on the announced date.

### 5.4 Compatibility check editor

Not applicable as long as the editor ships in the same jar as the hub that serves the API.

---

## 6. Database schema

No more PostgreSQL or Drizzle migrations since phase F (2026-10): the history of the 66
migrations is at commit `ccade092` (branch `v2`).

Artisan lends a database to the suite (`environment.yml` → `database.type: h2 | mysql | mariadb`,
`DatabaseApi`, ADR `suite-foundation-database`) but **creates no table in it**. Each plugin of
the suite prefixes its tables and brings its migrations; the forward-only rule (add, loosen,
never destroy data without a deprecation period) applies to each.

What Artisan persists lives on disk (Projects, drafts, `config.yml`, `environment.yml`,
see `entities.md`): its formats evolve through the versioned schemas (§2), not through SQL migration.

---

## 7. Resource pack format

### 7.1 Minecraft `pack.mcmeta`

The pack generated by Artisan includes a standard `pack.mcmeta`:

```json
{
  "pack": {
    "pack_format": 22,
    "description": "Artisan custom assets pack"
  }
}
```

`pack_format` 22 = Minecraft 1.21+. If you support several MC versions, you can ship version-specific packs (multi-pack approach).

### 7.2 Internal asset registry

At the pack root, an `artisan-assets/manifest.json` file:

```json
{
  "schema": "artisan-assets/v1",
  "artisan_version": "1.0.0",
  "generated_at": "2026-01-15T10:30:00Z",
  "workspace_id": "ws_abc123",
  "server_key": "sk_def456",
  "assets": [
    {
      "id": "asset_shop_btn_buy",
      "cmd_string": "artisan:shop_btn_buy",
      "hash": "sha256:abc...",
      "size_bytes": 1234
    },
    ...
  ]
}
```

The `cmd_string` is stable for a given asset. Once assigned, **you NEVER change it** — otherwise all deployed bundles become inconsistent.

### 7.3 CMD string stability

Golden rule:

- Asset upload → CMD string assigned deterministically (based on asset id + hash)
- Asset id stable for the life of the asset
- If the admin renames the asset, the id stays, the CMD stays, only the label changes
- If the admin deletes then recreates, it is a new asset id, new CMD

---

## 8. CHANGELOG.md discipline

### 8.1 Format Keep a Changelog

`/CHANGELOG.md` at the repo root. Standard format:

```markdown
# Changelog

All notable changes to Artisan Core will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- New `dialog/v1` schema for dialog system.
- `ArtisanAPI.dialogs` registry.

### Deprecated
- `Menu.size` integer field, use `Menu.dimensions` instead.
  Will be removed in 2.0.0 (estimated 2027-Q2).

### Removed
- Nothing yet.

### Fixed
- Hot-reload no longer crashes when MCModels pack is empty.

## [1.5.0] - 2026-03-15

### Added
- Module `shop/v1` with item management, prices, categories.
- AI migration from DeluxeMenus format (in addition to zMenu).

### Changed
- `ArtisanAPI.dataSources.fetch()` is now async. Old sync version still available as `fetchSync()` until 2.0.

## [1.0.0] - 2026-01-15

### Added
- Initial public release.
- `menu/v1`, `command/v1`, `translations/v1` schemas.
- WebSocket sync, live edit, multi-server.
- AI migration from zMenu.
```

### 8.2 Rules

- **Every PR that changes the public API adds an entry** — as a new file in `changelog.d/`, never
  by editing `CHANGELOG.md` (every PR prepending to `[Unreleased]` made every PR conflict).
  Format and naming: `changelog.d/README.md`. CI (`changelog.yml`) refuses lines added to `[Unreleased]`.
- At release time, `node tools/changelog/changelog.mjs release X.Y.Z` folds the fragments into
  `[Unreleased]`, which becomes `[X.Y.Z] - YYYY-MM-DD`, and deletes them.
- Categories: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.
- **Breaking changes** flagged in bold in the relevant category.
- GitHub link to the commit/PR for each entry (optional but useful).

### 8.3 One CHANGELOG per release artifact

- `/CHANGELOG.md` for the core
- `/modules/shop/CHANGELOG.md` for the shop plugin (V1.5+)
- `/modules/quests/CHANGELOG.md` for the quests plugin (V2+)
- etc.

Each .jar shipped on SpigotMC/BBV has its own CHANGELOG.

---

## 9. API surface documentation

`/docs/architecture/api-surface.md` — reference manual for plugin authors.

### 9.1 Proposed structure

```markdown
# Artisan Public API Surface (v1.x)

This document lists the **stable** API surface of Artisan Core that modules can safely depend on.
Anything not listed here is internal and may change without notice.

## Annotations

- `@Stable` — covered by SemVer
- `@Beta` — may change in minor versions
- `@Internal` — DO NOT USE
- `@Deprecated(reason, removeInVersion)` — will be removed

## Stable APIs (v1.x)

### `net.artisanmc.api.ArtisanAPI`
The main entry point exposed to modules.

| Member | Type | Since |
|---|---|---|
| `dataSources` | `DataSourceRegistry` | 1.0.0 |
| `commands` | `CommandRegistry` | 1.0.0 |
| `modules` | `ModuleRegistry` | 1.0.0 |
| `workspace` | `WorkspaceAccess` | 1.0.0 |
| `bootstrap` | `BootstrapManager` | 1.0.0 |
| `isCompatibleWith(version: String)` | `Boolean` | 1.0.0 |

### `net.artisanmc.api.ArtisanModule`
...

## Beta APIs (may change)

### `net.artisanmc.api.AIBridge` 
- **Beta since 1.0.0**, target stable 1.5.0
- Experimental, modules use at own risk.

## Deprecated APIs

### `ArtisanAPI.legacyMenu()` 
- **Deprecated since 1.2.0**, removed in 2.0.0
- Use `ArtisanAPI.menus.get()` instead.
```

### 9.2 Auto-generation

Eventually, you can auto-generate this doc from the Kotlin sources with a Gradle plugin that inspects the `@Stable`, `@Beta`, `@Deprecated` annotations. Not critical for V1.

---

## 10. Deprecation policy

### 10.1 Lifecycle of an API

```
@Stable → @Deprecated → removed (in next major)
   ↑           ↓
   |     (3-6 months minimum)
   |           ↓
   |     User communication
```

### 10.2 Deprecation steps

1. Mark `@Deprecated(reason, removeInVersion, replacement)`.
2. Add a `### Deprecated` entry to the CHANGELOG.
3. Announce on Discord + SpigotMC + public roadmap.
4. Log `WARN` when a module calls the deprecated API.
5. **Wait 3-6 months minimum**.
6. **Major version bump** + actual removal.
7. Incompatible modules fail gracefully (see modules.md section 13).

### 10.3 Special cases

- **Security issue in a stable API**: you can modify it in a patch if the fix does not change the signature. If it must change, you issue a security advisory + a quick major.
- **API never used by anyone**: if you know no module has called this API (zero usage analytics), you can remove it in a minor with a mention in the CHANGELOG. Acceptable risk.

---

## 11. Release checklist

For each release of the core or a module:

### 11.1 Pre-release

- [ ] All tests pass (unit + integration)
- [ ] `japicmp` check with no binary compat regression
- [ ] CHANGELOG.md updated, `[Unreleased]` becomes `[X.Y.Z] - YYYY-MM-DD`
- [ ] Version bumped in `build.gradle.kts` + `plugin.yml`
- [ ] If new API: `docs/architecture/api-surface.md` updated
- [ ] If new schema: `/docs/schema/{name}/v{N}/` created with types.ts + examples
- [ ] If migration needed: migration code + unit test
- [ ] If breaking change: Discord announcement made 3+ months before
- [ ] If Minecraft changed: "Packet menus" checklist run in game (`testing.md`)

### 11.2 Release

- [ ] Git tag `v{X.Y.Z}` on the release commit
- [ ] GitHub Release created with the CHANGELOG entries
- [ ] `.jar` uploaded to:
  - GitHub Releases
  - SpigotMC resource (free core) or Premium Resources (modules)
  - Modrinth (core)
  - BBV / Polymart (modules premium)
- [ ] The jar embeds the editor (`./gradlew shadowJar -PwithEditor`)
- [ ] `artisan-api` published (`maven-publish`)

### 11.3 Post-release

- [ ] Announcement in the Discord channel `#announcements`
- [ ] Tweet / Reddit r/admincraft if major release
- [ ] Email to Pro users if the update concerns their tier
- [ ] Monitor errors / Sentry for 24-48h

---

## 12. V1 implementation: what you do now

### 12.1 Concrete V1 investments (5-6 days total)

| Item | Effort |
|---|---|
| `api/` vs `internal/` package separation on the plugin side | 1 day (refactor) |
| `@Stable`, `@Beta`, `@Internal`, `@Deprecated` annotations | 0.5 day |
| `SchemaRegistry` with migration framework | 1-2 days |
| Protocol version + dispatch in the WS hub | 1 day |
| URL versioning `/api/v1/*` | 0.5 day |
| Initial `CHANGELOG.md` + commit rule in contribution.md | 0.1 day |
| `docs/architecture/api-surface.md` v1 | 0.5 day |

### 12.2 Do NOT over-invest in V1

At V1 launch you do **NOT** have:

- Multiple versions in parallel (just v1 everywhere)
- `japicmp` in CI (to add when you have a first external module)
- Deprecations to manage (everything is new)
- Auto-generated docs

You only put in **the foundations**. The rest comes organically when you need it.

### 12.3 The discipline that pays off later

- **Every commit that touches `net.artisanmc.api.*` must update the CHANGELOG**.
- **Every new schema version is created in a separate folder**, never by modifying an existing one.
- **Every change in the meaning of a WS message bumps the major of `ProtocolVersion`** (hub and leaves update together).
- **Every REST endpoint has a versioned URL**.

These 4 disciplines are enough to spare you 90% of future versioning headaches.

---

## 13. When you break these rules

Spoiler: you will break them, especially at the beginning.

**How to get out of it**:

- For a schema field renamed inadvertently: you write a v1.0 → v1.0 migration (idempotent) that renames. Not ideal but it works.
- For a public method signature that changed: you make the old one `@Deprecated` and add a new one. You maintain both.
- For a DB column removed too early: you recreate it with DEFAULT NULL and mark it `@Deprecated`.

**The worst thing to do**: ignore the problem and hope nobody notices. Always document it in the CHANGELOG `### Fixed` with "fixed inadvertent API break introduced in 1.2.0".

---

## Appendix: external resources

- [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
- [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html)
- [japicmp - Java API Comparison](https://github.com/siom79/japicmp)
- [JSON Schema migration patterns](https://json-schema.org/blog/posts/migration-strategies)

