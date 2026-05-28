# Resource Pack Delegation — Design Spec

**Date:** 2026-05-18
**Status:** Draft (post-brainstorm)
**Scope:** Plugin-only. Let the admin configure Artisan to extract its resource pack contents into a host plugin's pack directory (Oraxen / Nexo / ItemsAdder / anything that builds its own RP), instead of pushing its own RP to players.

## Goal

Today Artisan pushes its own RP to players via `addResourcePack` (multi-pack API, additive). This coexists technically with Oraxen/Nexo/ItemsAdder's RP — but at the cost of two prompts at login, two downloads, and namespace-conflict risk if both packs touch `assets/minecraft`.

Most servers already run one of Oraxen/Nexo/ItemsAdder for custom items. Those plugins build their own RP and push it themselves. This feature lets the admin point Artisan at the host plugin's pack-source directory, so Artisan's content gets merged into the host pack at the host's next rebuild — and Artisan stops sending its own pack.

## Non-goals

- **Auto-trigger of host rebuild** (`/oraxen reload`, `/iazip`, etc.). Admin runs it manually after each Artisan update. Programmatic per-plugin integration is a separate sub-project for later.
- **Auto-detect the host plugin's pack-dir.** Admin configures the path explicitly.
- **Merge of `pack.mcmeta`.** We skip ours; host owns it.
- **Multiple simultaneous targets.** Single `delegate-to-dir`.
- **Backend changes.** Bundle generation and serving are unchanged.
- **Editor changes.** None.

## Configuration

`plugin/src/main/resources/config.yml` gets a new optional key:

```yaml
resource-pack:
  enabled: true
  prompt: "<gold>Pack Artisan</gold>"
  send-on-join: true
  send-delay-ticks: 20
  # When set, Artisan stops pushing its own RP to players and extracts
  # its pack contents into this directory. The admin must configure the
  # host RP plugin to read from this location (or point this path at the
  # host plugin's pack-source dir) and trigger the host's rebuild after
  # each Artisan update.
  #
  # Path is filesystem-absolute or relative to the server root. Artisan
  # owns the `assets/artisan/` subtree inside it and wipes it before
  # every extraction.
  #
  # Default: unset (legacy mode — Artisan pushes its own RP).
  delegate-to-dir: ""
```

Empty string and unset both mean "legacy mode". Anything non-blank activates delegation.

Kotlin shape:

```kotlin
data class ResourcePackConfig(
    val enabled: Boolean,
    val prompt: String,
    val sendOnJoin: Boolean,
    val sendDelayTicks: Long,
    val delegateToDir: String?,
)
```

`PluginConfig.from(cfg)` extension:

```kotlin
delegateToDir = cfg.getString("resource-pack.delegate-to-dir")?.takeIf { it.isNotBlank() },
```

## Architecture

New component `ResourcePackDelegator` (sibling of `ResourcePackManager` in
`plugin/src/main/kotlin/net/artisanmc/plugin/resourcepack/`).

Single responsibility: download the Artisan RP zip from a URL, verify
its SHA-1, and extract the `assets/artisan/` subtree into a target
directory. Wipes the target's `assets/artisan/` first to handle
deleted/renamed files.

```kotlin
class ResourcePackDelegator(
    private val targetDir: File,
    private val logger: Logger?,
) {
    fun apply(downloadUrl: String, expectedHash: String) {
        val zipBytes = httpDownload(downloadUrl)
        verifyHash(zipBytes, expectedHash)
        val ifzDir = File(targetDir, "assets/artisan")
        ifzDir.deleteRecursively()
        ifzDir.mkdirs()
        extractZip(zipBytes, targetDir)
        logger?.info("[delegate] extracted Artisan pack into ${ifzDir.absolutePath}")
    }

    private fun extractZip(zipBytes: ByteArray, into: File) {
        ZipInputStream(zipBytes.inputStream()).use { zis ->
            var entry = zis.nextEntry
            while (entry != null) {
                if (acceptEntry(entry)) writeEntry(zis, entry, into)
                entry = zis.nextEntry
            }
        }
    }

    /**
     * Three guards:
     *  1. Entry must live under `assets/artisan/`. Everything else is
     *     skipped (including `pack.mcmeta` at the zip root — the host pack
     *     owns its own). Defends against namespace collisions on
     *     `assets/minecraft` if the backend ever emits there.
     *  2. Path traversal: canonical resolved path must stay inside
     *     `targetDir/assets/artisan/`. Defends against malicious or
     *     malformed entries like `assets/artisan/../../etc/passwd`.
     *  3. Directories are created, not written.
     */
    private fun acceptEntry(entry: ZipEntry): Boolean = ...
}
```

### Wiring into `ResourcePackManager`

The manager already owns the `onUpdate(info)` entry point that the WS
listener calls when the backend publishes a new RP. Wiring change: route
to the delegator when one is configured, skip player push.

```kotlin
open class ResourcePackManager(
    private val plugin: JavaPlugin,
    private val config: ResourcePackConfig,
    private val logger: Logger? = null,
    private val assetCatalog: AssetCatalog? = null,
    private val delegator: ResourcePackDelegator? = null,   // NEW
) : Listener {

    fun onUpdate(info: ResourcePackInfo?) {
        val oldInfo = currentPackInfo
        currentPackInfo = info
        if (info == null) {
            // Legacy cleanup path unchanged. In delegate mode there's
            // nothing to clean up on players (we never added a pack).
            if (delegator == null) {
                oldInfo?.let { old ->
                    for (player in plugin.server.onlinePlayers) removePackSafe(player, old.uuid)
                }
                previousUuid = null
            }
            return
        }
        assetCatalog?.let { cat -> updateCatalogAsync(cat, info) }
        if (delegator != null) {
            applyDelegateAsync(info)
            return
        }
        if (!config.enabled) return
        for (player in plugin.server.onlinePlayers) pushToPlayer(player)
        previousUuid = info.uuid
    }

    private fun applyDelegateAsync(info: ResourcePackInfo) {
        Thread {
            try {
                delegator!!.apply(info.downloadUrl, info.hash)
                logger?.info("[delegate] pack updated — reload the host RP plugin to apply")
            } catch (t: Throwable) {
                logger?.warning("[delegate] apply failed: ${t.message}")
            }
        }.apply { isDaemon = true; name = "artisan-rp-delegate"; start() }
    }

    // onJoin / pushToPlayer unchanged. onJoin short-circuits via `config.enabled`
    // which is honored as today, but with delegator set, sendOnJoin doesn't run
    // because nothing calls it for delegate mode. We update the check:

    fun onJoin(player: Player) {
        if (delegator != null) return
        if (!config.enabled || !config.sendOnJoin) return
        // ... existing path ...
    }
}
```

### Instantiation in `ArtisanPlugin`

At `onEnable()`, after reading the config:

```kotlin
val delegator: ResourcePackDelegator? = config.resourcePack.delegateToDir?.let { path ->
    val dir = File(path)
    if (!dir.exists()) dir.mkdirs()
    if (!dir.isDirectory || !dir.canWrite()) {
        logger.warning("[delegate] delegate-to-dir ${dir.absolutePath} is not a writable directory — falling back to legacy push mode")
        null
    } else {
        ResourcePackDelegator(dir, logger)
    }
}

val rpManager = ResourcePackManager(this, config.resourcePack, logger, assetCatalog, delegator)
```

When `delegateToDir` is set but the directory is unusable (path
unwritable, isn't a directory), log a warning and fall back to legacy
push mode rather than refusing to start. The admin sees the warning and
can fix the path.

## Behavior summary

| Mode | When | What happens |
|---|---|---|
| Legacy (today) | `delegate-to-dir` unset | Plugin pushes its own RP to each player via `addResourcePack` on join + on every update |
| Delegate | `delegate-to-dir` set | Plugin extracts `assets/artisan/*` into `<dir>/assets/artisan/` on every update; players are not pushed anything; admin manually reloads the host plugin |

Cleanup of `assets/artisan/` before each extraction is unconditional —
deleted/renamed files don't accumulate. `pack.mcmeta` and anything
outside `assets/artisan/` are skipped to avoid clobbering host content.

## Edge cases

- **`delegateToDir` is set but path doesn't exist** → `mkdirs()`. If still not writable, log warn + fall back to legacy push.
- **Hash mismatch on downloaded zip** → throw, log warn, do NOT touch the target directory. Next update retries.
- **Zip contains a path-traversal entry** → silently skip that entry, continue with the rest.
- **Backend serves a zip with `assets/minecraft/...` someday** → silently skipped (we own only `assets/artisan/`).
- **`enabled: false` AND `delegate-to-dir` set** → delegation runs anyway. The `enabled` flag is the legacy on/off for player push; in delegate mode we never push, so the flag is moot for delegate behavior.
- **Plugin reload mid-extraction** → daemon thread; on shutdown it dies. Next start triggers a fresh extraction on the next backend update.

## Tests (write first, TDD)

### `PluginConfigTest` (extend)

- `parses resource-pack.delegate-to-dir when set` → string round-trips into `delegateToDir`.
- `resource-pack.delegate-to-dir defaults to null when absent`.
- `resource-pack.delegate-to-dir parses empty string as null`.

### `ResourcePackDelegatorTest` (new)

Uses JUnit temp dirs. Builds in-memory zips via `ZipOutputStream` over a `ByteArrayOutputStream`. A tiny HTTP stub is overkill; instead, refactor `apply` to take either `(downloadUrl, hash)` (production path that does HTTP) OR expose a test seam `applyBytes(zipBytes, hash)` that the unit tests target directly. The HTTP-download wrapper is a thin shim around the bytes path.

- `applyBytes extracts assets/artisan entries into target dir` — zip has `assets/artisan/font/default.json` + `assets/artisan/textures/foo.png`; both end up on disk under `<target>/assets/artisan/`.
- `applyBytes skips pack.mcmeta at zip root` — zip has root `pack.mcmeta`; after apply, no `<target>/pack.mcmeta` exists.
- `applyBytes skips entries outside assets/artisan/` — zip has `assets/minecraft/font/default.json`; not extracted.
- `applyBytes wipes assets/artisan before extraction` — pre-seed `<target>/assets/artisan/stale.png`; apply a zip not containing it; stale.png is gone.
- `applyBytes rejects path traversal entries` — zip has `assets/artisan/../../etc/passwd`; nothing outside target is touched, no exception.
- `applyBytes throws on hash mismatch` — bytes with hash X, apply with expected hash Y; throws and does not touch `targetDir`.

### `ResourcePackManagerTest` (extend)

- `onUpdate in delegate mode invokes delegator and does NOT push to players` — mock `Player.addResourcePack` (existing test seam `addPack` override) is never called. Mock delegator's `apply` is called with matching `downloadUrl + hash`.
- `onUpdate with info=null in delegate mode does NOT iterate online players` — in legacy mode it does (cleanup); in delegate mode the cleanup path is skipped.
- `onJoin in delegate mode is a no-op` — `addPack` test seam not called.
- (Sanity) `legacy mode unchanged when delegator is null` — existing tests cover this; no new assertion needed but the existing suite must remain green.

## File touch list

**Plugin (created):**
- `plugin/src/main/kotlin/net/artisanmc/plugin/resourcepack/ResourcePackDelegator.kt`
- `plugin/src/test/kotlin/net/artisanmc/plugin/ResourcePackDelegatorTest.kt`

**Plugin (modified):**
- `plugin/src/main/kotlin/net/artisanmc/plugin/config/PluginConfig.kt` — add `delegateToDir: String?` to `ResourcePackConfig` + parse.
- `plugin/src/main/kotlin/net/artisanmc/plugin/resourcepack/ResourcePackManager.kt` — accept optional `delegator`, route `onUpdate` to it, short-circuit `onJoin`.
- `plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt` — instantiate delegator from config with writability check + fallback warn; pass to manager constructor.
- `plugin/src/main/resources/config.yml` — add commented `delegate-to-dir:` entry with doc.
- `plugin/src/test/kotlin/net/artisanmc/plugin/PluginConfigTest.kt` — 3 new tests.
- `plugin/src/test/kotlin/net/artisanmc/plugin/ResourcePackManagerTest.kt` — 3 new tests.

**Docs:**
- `CLAUDE.md` — add a "Delegation mode" note to the resource-pack section. Describe the admin workflow: set `delegate-to-dir` → restart plugin → host plugin sees Artisan files → admin runs host's reload command after every Artisan update.

**Backend:** no changes.
**Editor:** no changes.

## Out of scope (future work)

- Programmatic auto-rebuild of the host plugin (call Oraxen's / Nexo's / ItemsAdder's API via reflection in `SoftDepRegistry` pattern). Big win on UX but couples to per-plugin APIs.
- Auto-detect the host plugin's pack-source dir (scan well-known paths).
- Multiple simultaneous targets.
- Optionally read the zip from the local backend-download cache instead of re-downloading. AssetCatalog already downloads the zip — `ResourcePackDelegator` could reuse those bytes. Skipped for v1 (saves a few hundred KB of disk read per update at the cost of cross-component coupling).
