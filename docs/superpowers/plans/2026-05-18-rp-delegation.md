# Resource Pack Delegation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plugin-only feature — when admin sets `resource-pack.delegate-to-dir` in `config.yml`, Interfaze extracts its RP contents into that directory (owning the `assets/interfaze/` subtree) and stops pushing its own RP to players. The host plugin (Oraxen/Nexo/ItemsAdder/etc.) then includes those files in its next pack rebuild.

**Architecture:** New `ResourcePackDelegator` component encapsulates download + SHA-1 verify + scoped extraction. `ResourcePackManager` gains an optional constructor arg; when non-null, `onUpdate` routes there and skips the player-push path. `InterfazePlugin` instantiates from config with a writability fallback. No backend or editor changes.

**Tech Stack:** Kotlin 2.0 + Paper 1.21.4 + JUnit 5 (`./gradlew test`). Standard library `java.util.zip.ZipInputStream` for extraction. Existing `OkHttpClient` already used elsewhere in the plugin for downloads (reuse via `httpClient` field on `SyncedMenuProvider` or import a fresh client — match existing pattern).

Spec: `docs/superpowers/specs/2026-05-18-rp-delegation-design.md`.

---

## Branch / hygiene

- Target branch: `main` (recent feature work has been merging here directly; previous textarea + auto-wrap plans both landed on main).
- Standing WIP across the tree stays untouched. The plugin files this plan modifies (`PluginConfig.kt`, `ResourcePackManager.kt`, `InterfazePlugin.kt`, `config.yml`) may carry pre-existing WIP — `git diff <path>` before each commit and write honest commit messages that cover both planned changes and any swept WIP. This is the same sweep-and-message-honestly strategy used by the prior plans on this branch.
- **Always use explicit `git add <paths>` per task.** Never `git add -A`.

## File structure overview

### Created

- `plugin/src/main/kotlin/gg/interfaze/plugin/resourcepack/ResourcePackDelegator.kt` — single responsibility: download zip + verify hash + extract `assets/interfaze/*` into target dir.
- `plugin/src/test/kotlin/gg/interfaze/plugin/ResourcePackDelegatorTest.kt` — unit tests targeting an in-memory `applyBytes(zipBytes, expectedHash)` seam.

### Modified

- `plugin/src/main/kotlin/gg/interfaze/plugin/config/PluginConfig.kt` — add `delegateToDir: String?` field to `ResourcePackConfig` + parse.
- `plugin/src/test/kotlin/gg/interfaze/plugin/PluginConfigTest.kt` — 3 new tests.
- `plugin/src/main/kotlin/gg/interfaze/plugin/resourcepack/ResourcePackManager.kt` — optional `delegator: ResourcePackDelegator? = null` constructor arg; `onUpdate` routes to delegator when set; `onJoin` short-circuits in delegate mode.
- `plugin/src/test/kotlin/gg/interfaze/plugin/ResourcePackManagerTest.kt` — 3 new tests.
- `plugin/src/main/kotlin/gg/interfaze/plugin/InterfazePlugin.kt` — instantiate delegator from config with writability fallback; pass to `ResourcePackManager`.
- `plugin/src/main/resources/config.yml` — add commented `delegate-to-dir:` entry with doc.
- `CLAUDE.md` — note delegation mode under the resource-pack section.

---

## Task 1: Config — `delegateToDir: String?` (TDD)

**Files:**
- Modify: `plugin/src/test/kotlin/gg/interfaze/plugin/PluginConfigTest.kt`
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/config/PluginConfig.kt`

- [ ] **Step 1: Write the failing parser tests**

Append to `PluginConfigTest.kt` (before the closing `}` of the class):

```kotlin
    @Test
    fun `parses resource-pack delegate-to-dir when set`() {
        val yaml = YamlConfiguration()
        yaml.loadFromString("""
            server_key: ""
            ws_url: "ws://x"
            resource-pack:
              enabled: true
              prompt: "<gold>x</gold>"
              send-on-join: true
              send-delay-ticks: 20
              delegate-to-dir: "/srv/mc/plugins/Oraxen/pack"
        """.trimIndent())
        val cfg = PluginConfig.from(yaml)
        assertEquals("/srv/mc/plugins/Oraxen/pack", cfg.resourcePack.delegateToDir)
    }

    @Test
    fun `resource-pack delegate-to-dir defaults to null when absent`() {
        val yaml = YamlConfiguration()
        yaml.loadFromString("""
            server_key: ""
            ws_url: "ws://x"
            resource-pack:
              enabled: true
        """.trimIndent())
        val cfg = PluginConfig.from(yaml)
        assertNull(cfg.resourcePack.delegateToDir)
    }

    @Test
    fun `resource-pack delegate-to-dir parses empty string as null`() {
        val yaml = YamlConfiguration()
        yaml.loadFromString("""
            server_key: ""
            ws_url: "ws://x"
            resource-pack:
              enabled: true
              delegate-to-dir: ""
        """.trimIndent())
        val cfg = PluginConfig.from(yaml)
        assertNull(cfg.resourcePack.delegateToDir)
    }
```

Add the missing imports at the top of the file:

```kotlin
import kotlin.test.assertNull
```

- [ ] **Step 2: Run tests to verify they fail**

From `plugin/`:
```
./gradlew test --tests "gg.interfaze.plugin.PluginConfigTest"
```
Expected: 3 new tests fail with "Unresolved reference: delegateToDir" (the field doesn't exist on `ResourcePackConfig` yet).

- [ ] **Step 3: Add field + parsing**

In `plugin/src/main/kotlin/gg/interfaze/plugin/config/PluginConfig.kt`, add `delegateToDir: String?` to `ResourcePackConfig`:

```kotlin
data class ResourcePackConfig(
    val enabled: Boolean,
    val prompt: String,
    val sendOnJoin: Boolean,
    val sendDelayTicks: Long,
    val delegateToDir: String?,
)
```

Then in `PluginConfig.from(cfg)`, extend the `ResourcePackConfig(...)` construction:

```kotlin
resourcePack      = ResourcePackConfig(
    enabled        = cfg.getBoolean("resource-pack.enabled", true),
    prompt         = cfg.getString("resource-pack.prompt", "<gold>Pack Interfaze</gold>") ?: "<gold>Pack Interfaze</gold>",
    sendOnJoin     = cfg.getBoolean("resource-pack.send-on-join", true),
    sendDelayTicks = cfg.getLong("resource-pack.send-delay-ticks", 20L),
    delegateToDir  = cfg.getString("resource-pack.delegate-to-dir")?.takeIf { it.isNotBlank() },
),
```

- [ ] **Step 4: Run tests to verify they pass**

```
./gradlew test --tests "gg.interfaze.plugin.PluginConfigTest"
```
Expected: 5 tests green (2 existing + 3 new).

Other test files (`ResourcePackManagerTest`) may fail to compile because they construct `ResourcePackConfig` positionally without `delegateToDir`. That's expected — they have a `config()` helper at line 28-29 that needs updating. Fix it now to keep the build green:

In `plugin/src/test/kotlin/gg/interfaze/plugin/ResourcePackManagerTest.kt`, find the `private fun config(...)` helper around line 28 and add `delegateToDir = null`:

```kotlin
    private fun config(enabled: Boolean = true, sendOnJoin: Boolean = true, delayTicks: Long = 0L) =
        ResourcePackConfig(
            enabled = enabled,
            prompt = "<gold>x</gold>",
            sendOnJoin = sendOnJoin,
            sendDelayTicks = delayTicks,
            delegateToDir = null,
        )
```

- [ ] **Step 5: Run full plugin suite to confirm green**

```
./gradlew test
```
Expected: BUILD SUCCESSFUL.

- [ ] **Step 6: Commit**

Inspect WIP first:
```
git diff plugin/src/main/kotlin/gg/interfaze/plugin/config/PluginConfig.kt plugin/src/test/kotlin/gg/interfaze/plugin/PluginConfigTest.kt plugin/src/test/kotlin/gg/interfaze/plugin/ResourcePackManagerTest.kt
```

Include observed WIP in the commit message honestly.

```bash
git add plugin/src/main/kotlin/gg/interfaze/plugin/config/PluginConfig.kt plugin/src/test/kotlin/gg/interfaze/plugin/PluginConfigTest.kt plugin/src/test/kotlin/gg/interfaze/plugin/ResourcePackManagerTest.kt
git commit -m "$(cat <<'EOF'
feat(plugin): ResourcePackConfig.delegateToDir — parse from config.yml

Empty string and unset both become null (= legacy push mode). Non-blank
string enables delegation. Existing test helper updated to pass null.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `ResourcePackDelegator` — new component (TDD)

**Files:**
- Create: `plugin/src/test/kotlin/gg/interfaze/plugin/ResourcePackDelegatorTest.kt`
- Create: `plugin/src/main/kotlin/gg/interfaze/plugin/resourcepack/ResourcePackDelegator.kt`

The HTTP path (`apply(downloadUrl, hash)`) is a thin wrapper around a unit-testable `applyBytes(zipBytes, expectedHash)` method. Tests target `applyBytes` exclusively — no HTTP simulation needed.

- [ ] **Step 1: Write the failing tests**

Create `plugin/src/test/kotlin/gg/interfaze/plugin/ResourcePackDelegatorTest.kt`:

```kotlin
package gg.interfaze.plugin

import gg.interfaze.plugin.resourcepack.ResourcePackDelegator
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.file.Files
import java.security.MessageDigest
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlin.test.*

class ResourcePackDelegatorTest {
    private lateinit var tempDir: File

    @BeforeTest
    fun setup() {
        tempDir = Files.createTempDirectory("ifz-delegator-test").toFile()
    }

    @AfterTest
    fun teardown() {
        tempDir.deleteRecursively()
    }

    /** Build an in-memory zip with the given (path → bytes) entries. */
    private fun buildZip(entries: Map<String, ByteArray>): ByteArray {
        val baos = ByteArrayOutputStream()
        ZipOutputStream(baos).use { zos ->
            for ((path, bytes) in entries) {
                zos.putNextEntry(ZipEntry(path))
                zos.write(bytes)
                zos.closeEntry()
            }
        }
        return baos.toByteArray()
    }

    /** Compute SHA-1 hex of bytes (matches the format produced by the backend). */
    private fun sha1Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-1").digest(bytes)
            .joinToString("") { "%02x".format(it) }

    @Test
    fun `applyBytes extracts assets-interfaze entries into target dir`() {
        val zip = buildZip(mapOf(
            "assets/interfaze/font/default.json" to "{}".toByteArray(),
            "assets/interfaze/textures/foo.png" to byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47),
        ))
        val delegator = ResourcePackDelegator(tempDir, logger = null)
        delegator.applyBytes(zip, sha1Hex(zip))

        val fontFile = File(tempDir, "assets/interfaze/font/default.json")
        val pngFile = File(tempDir, "assets/interfaze/textures/foo.png")
        assertTrue(fontFile.exists(), "font file not extracted")
        assertTrue(pngFile.exists(), "png file not extracted")
        assertEquals("{}", fontFile.readText())
    }

    @Test
    fun `applyBytes skips pack-mcmeta at zip root`() {
        val zip = buildZip(mapOf(
            "pack.mcmeta" to """{"pack":{"pack_format":64}}""".toByteArray(),
            "assets/interfaze/font/default.json" to "{}".toByteArray(),
        ))
        val delegator = ResourcePackDelegator(tempDir, logger = null)
        delegator.applyBytes(zip, sha1Hex(zip))

        assertFalse(File(tempDir, "pack.mcmeta").exists(), "pack.mcmeta should NOT be extracted")
        assertTrue(File(tempDir, "assets/interfaze/font/default.json").exists())
    }

    @Test
    fun `applyBytes skips entries outside assets-interfaze`() {
        val zip = buildZip(mapOf(
            "assets/minecraft/font/default.json" to "{}".toByteArray(),
            "assets/oraxen/textures/foo.png" to byteArrayOf(0x00),
            "assets/interfaze/textures/keep.png" to byteArrayOf(0x01),
        ))
        val delegator = ResourcePackDelegator(tempDir, logger = null)
        delegator.applyBytes(zip, sha1Hex(zip))

        assertFalse(File(tempDir, "assets/minecraft/font/default.json").exists())
        assertFalse(File(tempDir, "assets/oraxen/textures/foo.png").exists())
        assertTrue(File(tempDir, "assets/interfaze/textures/keep.png").exists())
    }

    @Test
    fun `applyBytes wipes assets-interfaze before extraction`() {
        // Pre-seed a stale file inside the namespace we own.
        val staleDir = File(tempDir, "assets/interfaze")
        staleDir.mkdirs()
        File(staleDir, "stale.png").writeBytes(byteArrayOf(0xFF.toByte()))

        val zip = buildZip(mapOf(
            "assets/interfaze/fresh.png" to byteArrayOf(0x01),
        ))
        val delegator = ResourcePackDelegator(tempDir, logger = null)
        delegator.applyBytes(zip, sha1Hex(zip))

        assertFalse(File(staleDir, "stale.png").exists(), "stale file should be wiped")
        assertTrue(File(staleDir, "fresh.png").exists())
    }

    @Test
    fun `applyBytes does NOT wipe content outside assets-interfaze`() {
        // Pre-seed host content alongside the interfaze subtree.
        val hostFile = File(tempDir, "assets/minecraft/font/default.json")
        hostFile.parentFile.mkdirs()
        hostFile.writeText("host content")
        val hostRoot = File(tempDir, "pack.mcmeta")
        hostRoot.writeText("""{"pack":{"pack_format":64}}""")

        val zip = buildZip(mapOf(
            "assets/interfaze/x.json" to "{}".toByteArray(),
        ))
        val delegator = ResourcePackDelegator(tempDir, logger = null)
        delegator.applyBytes(zip, sha1Hex(zip))

        assertEquals("host content", hostFile.readText(), "host file must not be touched")
        assertTrue(hostRoot.exists(), "host pack.mcmeta must not be touched")
    }

    @Test
    fun `applyBytes silently skips path traversal entries`() {
        val zip = buildZip(mapOf(
            "assets/interfaze/../../etc/passwd" to "evil".toByteArray(),
            "assets/interfaze/safe.png" to byteArrayOf(0x01),
        ))
        val delegator = ResourcePackDelegator(tempDir, logger = null)
        delegator.applyBytes(zip, sha1Hex(zip))

        // The safe entry lands, nothing escapes the target.
        assertTrue(File(tempDir, "assets/interfaze/safe.png").exists())
        // No file outside the target dir was created. We test by inspecting
        // the tempDir parent — only our subdir should appear there.
        val parent = tempDir.parentFile
        val unexpected = parent.list { _, name -> name == "etc" }
        assertTrue(unexpected == null || unexpected.isEmpty(), "path traversal escaped: $unexpected")
    }

    @Test
    fun `applyBytes throws on hash mismatch and does not touch target dir`() {
        val zip = buildZip(mapOf(
            "assets/interfaze/x.json" to "{}".toByteArray(),
        ))
        val wrongHash = "0".repeat(40)
        val delegator = ResourcePackDelegator(tempDir, logger = null)

        assertFails {
            delegator.applyBytes(zip, wrongHash)
        }
        assertFalse(File(tempDir, "assets/interfaze/x.json").exists(),
            "no file should be extracted when hash mismatches")
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```
./gradlew test --tests "gg.interfaze.plugin.ResourcePackDelegatorTest"
```
Expected: compile error — `ResourcePackDelegator` doesn't exist.

- [ ] **Step 3: Create `ResourcePackDelegator`**

Create `plugin/src/main/kotlin/gg/interfaze/plugin/resourcepack/ResourcePackDelegator.kt`:

```kotlin
package gg.interfaze.plugin.resourcepack

import java.io.File
import java.net.URL
import java.security.MessageDigest
import java.util.logging.Logger
import java.util.zip.ZipInputStream

/**
 * Extracts the `assets/interfaze/` subtree of the Interfaze resource pack into
 * a target directory owned by a host plugin (Oraxen / Nexo / ItemsAdder / etc.).
 *
 * Used when the admin sets `resource-pack.delegate-to-dir` in `config.yml`.
 * In that mode the plugin does NOT push its own RP to players — the host pack
 * plugin is expected to merge our files into its own RP at its next rebuild.
 *
 * Owns the `<targetDir>/assets/interfaze/` namespace entirely:
 *  - Wipes it recursively before each extraction (deleted/renamed files
 *    don't accumulate).
 *  - Refuses to write anything outside that subtree, even if the zip
 *    contains such entries (defense in depth — see [acceptEntry]).
 *
 * `pack.mcmeta` at the zip root is silently skipped — the host pack owns
 * its own metadata.
 */
open class ResourcePackDelegator(
    private val targetDir: File,
    private val logger: Logger?,
) {
    /**
     * Download the zip from [downloadUrl], verify its SHA-1 matches
     * [expectedHash], then extract.
     *
     * Use only on a background thread — the HTTP read blocks.
     */
    open fun apply(downloadUrl: String, expectedHash: String) {
        val bytes = URL(downloadUrl).openStream().use { it.readBytes() }
        applyBytes(bytes, expectedHash)
    }

    /**
     * Same as [apply] but takes the bytes directly. Used by tests; production
     * code uses [apply] which downloads.
     */
    open fun applyBytes(zipBytes: ByteArray, expectedHash: String) {
        val actualHash = sha1Hex(zipBytes)
        if (!actualHash.equals(expectedHash, ignoreCase = true)) {
            throw IllegalStateException(
                "[delegate] hash mismatch: expected=$expectedHash actual=$actualHash"
            )
        }
        val ifzRoot = File(targetDir, "assets/interfaze")
        ifzRoot.deleteRecursively()
        ifzRoot.mkdirs()
        val ifzCanonical = ifzRoot.canonicalPath
        ZipInputStream(zipBytes.inputStream()).use { zis ->
            while (true) {
                val entry = zis.nextEntry ?: break
                if (!acceptEntry(entry.name)) {
                    zis.closeEntry()
                    continue
                }
                val outFile = File(targetDir, entry.name)
                // Path traversal defense: canonical path must stay inside
                // our owned subtree.
                if (!outFile.canonicalPath.startsWith(ifzCanonical)) {
                    logger?.warning("[delegate] rejected path-traversal entry: ${entry.name}")
                    zis.closeEntry()
                    continue
                }
                if (entry.isDirectory) {
                    outFile.mkdirs()
                } else {
                    outFile.parentFile?.mkdirs()
                    outFile.outputStream().use { os -> zis.copyTo(os) }
                }
                zis.closeEntry()
            }
        }
        logger?.info("[delegate] extracted Interfaze pack into ${ifzRoot.absolutePath}")
    }

    private fun acceptEntry(name: String): Boolean =
        name.startsWith("assets/interfaze/")

    private fun sha1Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-1").digest(bytes)
            .joinToString("") { "%02x".format(it) }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
./gradlew test --tests "gg.interfaze.plugin.ResourcePackDelegatorTest"
```
Expected: all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add plugin/src/main/kotlin/gg/interfaze/plugin/resourcepack/ResourcePackDelegator.kt plugin/src/test/kotlin/gg/interfaze/plugin/ResourcePackDelegatorTest.kt
git commit -m "$(cat <<'EOF'
feat(plugin): ResourcePackDelegator — extract Interfaze RP to host plugin dir

Owns assets/interfaze/ under the target directory: wipes before each
extraction, rejects path traversal, skips pack.mcmeta and entries
outside the interfaze namespace. SHA-1 verified against the
backend-supplied expected hash before any disk write.

Public entry points: apply(downloadUrl, hash) for production
(downloads bytes via URL.openStream) and applyBytes(bytes, hash) for
tests (in-memory zips).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire delegator into `ResourcePackManager` (TDD)

**Files:**
- Modify: `plugin/src/test/kotlin/gg/interfaze/plugin/ResourcePackManagerTest.kt`
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/resourcepack/ResourcePackManager.kt`

- [ ] **Step 1: Write the failing tests**

In `plugin/src/test/kotlin/gg/interfaze/plugin/ResourcePackManagerTest.kt`, add a recording delegator and 3 new tests. Append BEFORE the closing `}` of the class:

```kotlin
    /**
     * Records `apply()` invocations. Overrides the production HTTP path so
     * tests never make a network call. Returns silently — no extraction in
     * tests; we only care that the manager calls us.
     */
    private class RecordingDelegator : gg.interfaze.plugin.resourcepack.ResourcePackDelegator(
        targetDir = java.io.File("."),  // unused — apply is overridden
        logger = null,
    ) {
        data class Call(val url: String, val hash: String)
        val calls = mutableListOf<Call>()
        override fun apply(downloadUrl: String, expectedHash: String) {
            calls += Call(downloadUrl, expectedHash)
        }
    }

    @Test
    fun `onUpdate in delegate mode calls delegator and skips player push`() {
        val player = server.addPlayer()
        val delegator = RecordingDelegator()
        val mgr = RecordingManager(plugin, config(), plugin.logger).also {
            // Field injection via reflection would be ugly. Instead we'll
            // construct via the new constructor signature added in this task.
        }
        // Reconstruct with delegator now that the constructor accepts it:
        val mgrWithDelegate = object : RecordingManager(plugin, config(), plugin.logger) {
            // Same recording behavior, plus delegator injected via the open property.
        }
        // The simplest path is to construct via the new constructor — the test
        // below uses the production class with the delegator slot:
        val delegateMgr = gg.interfaze.plugin.resourcepack.ResourcePackManager(
            plugin = plugin,
            config = config(),
            logger = plugin.logger,
            delegator = delegator,
        )

        val info = ResourcePackInfo.from("http://x", SAMPLE_HASH, "<gold>x</gold>")
        delegateMgr.onUpdate(info)

        // Delegator was called with the expected URL + hash.
        assertEquals(1, delegator.calls.size)
        assertEquals("http://x", delegator.calls[0].url)
        assertEquals(SAMPLE_HASH, delegator.calls[0].hash)
        // No player push happened. We can't easily intercept on the production
        // ResourcePackManager (no test seam exposed without a recording subclass),
        // but the player has no resource pack status events fired by MockBukkit
        // unless addResourcePack is actually called. We assert the manager's
        // pre-condition: currentPackInfo is still set, but the player's pack
        // state is undisturbed. The strongest assertion is that no exception
        // was thrown (MockBukkit's Player.addResourcePack throws
        // UnimplementedOperationException — if we'd called it, the test would
        // have failed).
        assertEquals(info, delegateMgr.currentPackInfo)
    }

    @Test
    fun `onUpdate with null in delegate mode does NOT iterate online players`() {
        // In legacy mode, onUpdate(null) loops online players to remove the old
        // pack from their stack. In delegate mode there's nothing on their
        // stack — skip the loop.
        val player = server.addPlayer()
        val delegator = RecordingDelegator()
        val delegateMgr = gg.interfaze.plugin.resourcepack.ResourcePackManager(
            plugin = plugin,
            config = config(),
            logger = plugin.logger,
            delegator = delegator,
        )
        val info = ResourcePackInfo.from("http://x", SAMPLE_HASH, "<gold>x</gold>")
        delegateMgr.onUpdate(info)
        // Reset call recorder and null out the pack.
        delegator.calls.clear()
        delegateMgr.onUpdate(null)
        // Delegator is NOT called on null (nothing to extract).
        assertTrue(delegator.calls.isEmpty())
        // currentPackInfo is cleared.
        assertNull(delegateMgr.currentPackInfo)
    }

    @Test
    fun `onJoin in delegate mode is a no-op`() {
        val player = server.addPlayer()
        val delegator = RecordingDelegator()
        val delegateMgr = gg.interfaze.plugin.resourcepack.ResourcePackManager(
            plugin = plugin,
            config = config(sendOnJoin = true, delayTicks = 0L),
            logger = plugin.logger,
            delegator = delegator,
        )
        val info = ResourcePackInfo.from("http://x", SAMPLE_HASH, "<gold>x</gold>")
        delegateMgr.onUpdate(info)
        delegator.calls.clear()

        delegateMgr.onJoin(player)
        // Delegator is NOT called on join — apply only runs from onUpdate.
        assertTrue(delegator.calls.isEmpty())
        // MockBukkit's Player.addResourcePack would throw if called. Reaching
        // this line means it wasn't called.
    }
```

- [ ] **Step 2: Run tests to verify they fail**

From `plugin/`:
```
./gradlew test --tests "gg.interfaze.plugin.ResourcePackManagerTest"
```
Expected: 3 new tests fail with "Unresolved reference: delegator" or "No value passed for parameter 'delegator'" — the constructor doesn't accept that arg yet.

- [ ] **Step 3: Extend `ResourcePackManager` constructor + route `onUpdate`**

In `plugin/src/main/kotlin/gg/interfaze/plugin/resourcepack/ResourcePackManager.kt`:

(a) Extend the constructor signature (find the `open class ResourcePackManager(` declaration around line 14):

```kotlin
open class ResourcePackManager(
    private val plugin: JavaPlugin,
    private val config: ResourcePackConfig,
    private val logger: Logger? = null,
    private val assetCatalog: AssetCatalog? = null,
    private val delegator: ResourcePackDelegator? = null,
) : Listener {
```

(b) Route `onUpdate` to the delegator when set. Find the current `fun onUpdate(info: ResourcePackInfo?)` (around line 60) and replace its body:

```kotlin
    fun onUpdate(info: ResourcePackInfo?) {
        val oldInfo = currentPackInfo
        currentPackInfo = info
        if (info == null) {
            // In delegate mode there's nothing on player packs to clean up
            // (we never added). Skip the per-player removal loop.
            if (delegator == null) {
                oldInfo?.let { old ->
                    for (player in plugin.server.onlinePlayers) {
                        removePackSafe(player, old.uuid)
                    }
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
        for (player in plugin.server.onlinePlayers) {
            pushToPlayer(player)
        }
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
        }.apply {
            isDaemon = true
            name = "interfaze-rp-delegate"
            start()
        }
    }
```

(c) Short-circuit `onJoin` when in delegate mode. Find `fun onJoin(player: Player)` (around line 154) and add the guard at the top:

```kotlin
    fun onJoin(player: Player) {
        if (delegator != null) return
        if (!config.enabled || !config.sendOnJoin) return
        if (config.sendDelayTicks <= 0L) {
            pushToPlayer(player)
        } else {
            plugin.server.scheduler.runTaskLater(plugin, Runnable { pushToPlayer(player) }, config.sendDelayTicks)
        }
    }
```

(d) Add the `ResourcePackDelegator` import at the top of the file if not already present (since it's in the same package, no import needed — but verify).

- [ ] **Step 4: Run tests to verify they pass**

```
./gradlew test --tests "gg.interfaze.plugin.ResourcePackManagerTest"
```
Expected: all green (existing tests + 3 new).

Note the new test `onUpdate in delegate mode calls delegator and skips player push` runs `applyDelegateAsync` which spawns a background thread. The thread calls `delegator.apply` which is overridden in `RecordingDelegator` to just record (no HTTP). The recording happens synchronously inside the thread, but the test asserts on `delegator.calls` immediately. This could race.

To eliminate the race, wait briefly for the thread or override `applyDelegateAsync` for tests. Simplest fix: in the production code, make `applyDelegateAsync` call `delegator.apply` directly when running synchronously is acceptable. But we DO want async in production (to not block the WS callback thread).

Cleanest fix: in `ResourcePackManager`, extract the thread-spawn into an `open protected fun runDelegate(action: () -> Unit)` test seam:

```kotlin
    /** Test seam — override to run inline rather than spawn a daemon thread. */
    protected open fun runDelegate(action: () -> Unit) {
        Thread {
            try { action() } catch (t: Throwable) { logger?.warning("[delegate] apply failed: ${t.message}") }
        }.apply { isDaemon = true; name = "interfaze-rp-delegate"; start() }
    }

    private fun applyDelegateAsync(info: ResourcePackInfo) {
        runDelegate {
            delegator!!.apply(info.downloadUrl, info.hash)
            logger?.info("[delegate] pack updated — reload the host RP plugin to apply")
        }
    }
```

Then in the test, subclass `ResourcePackManager` and override `runDelegate` to run inline:

```kotlin
    private class InlineManager(
        plugin: JavaPlugin,
        config: ResourcePackConfig,
        logger: Logger?,
        delegator: ResourcePackDelegator?,
    ) : ResourcePackManager(plugin, config, logger, delegator = delegator) {
        public override fun runDelegate(action: () -> Unit) { action() }
    }
```

And the 3 new tests use `InlineManager` instead of the production class. Update the 3 new tests' `delegateMgr` to use `InlineManager(plugin, config(), plugin.logger, delegator)`.

- [ ] **Step 5: Run tests to verify they pass (no race)**

```
./gradlew test --tests "gg.interfaze.plugin.ResourcePackManagerTest"
```
Expected: all green.

- [ ] **Step 6: Run full plugin suite**

```
./gradlew test
```
Expected: BUILD SUCCESSFUL.

- [ ] **Step 7: Commit**

```bash
git add plugin/src/main/kotlin/gg/interfaze/plugin/resourcepack/ResourcePackManager.kt plugin/src/test/kotlin/gg/interfaze/plugin/ResourcePackManagerTest.kt
git commit -m "$(cat <<'EOF'
feat(plugin): ResourcePackManager — route to delegator when configured

New optional constructor arg `delegator: ResourcePackDelegator? = null`.
When non-null: onUpdate(info) calls delegator.apply() on a daemon thread
and SKIPS the per-player push; onUpdate(null) skips the player-cleanup
loop (nothing was added); onJoin short-circuits.

Extracted `runDelegate` test seam so tests can run the daemon-thread
body inline and assert without races.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Instantiate delegator in `InterfazePlugin`

**Files:**
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/InterfazePlugin.kt`

- [ ] **Step 1: Read the current `onEnable` resource-pack section**

Find the `val resourcePackManager = gg.interfaze.plugin.resourcepack.ResourcePackManager(...)` block (around line 65). Currently:

```kotlin
        val resourcePackManager = gg.interfaze.plugin.resourcepack.ResourcePackManager(
            plugin = this,
            config = cfg.resourcePack,
            logger = logger,
            assetCatalog = assetCatalog,
        )
```

- [ ] **Step 2: Build the delegator before constructing the manager**

Replace the block with:

```kotlin
        val delegator: gg.interfaze.plugin.resourcepack.ResourcePackDelegator? =
            cfg.resourcePack.delegateToDir?.let { path ->
                val dir = File(path)
                if (!dir.exists()) dir.mkdirs()
                if (!dir.isDirectory || !dir.canWrite()) {
                    logger.warning(
                        "[delegate] delegate-to-dir ${dir.absolutePath} is not a writable directory — " +
                        "falling back to legacy push mode"
                    )
                    null
                } else {
                    logger.info("[delegate] delegation enabled, target dir: ${dir.absolutePath}")
                    gg.interfaze.plugin.resourcepack.ResourcePackDelegator(dir, logger)
                }
            }
        val resourcePackManager = gg.interfaze.plugin.resourcepack.ResourcePackManager(
            plugin = this,
            config = cfg.resourcePack,
            logger = logger,
            assetCatalog = assetCatalog,
            delegator = delegator,
        )
```

The `File` import already exists at the top of the file (line 12). No new imports needed.

- [ ] **Step 3: Verify compilation**

```
./gradlew compileKotlin
```
Expected: BUILD SUCCESSFUL.

- [ ] **Step 4: Run full plugin suite to confirm nothing regressed**

```
./gradlew test
```
Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add plugin/src/main/kotlin/gg/interfaze/plugin/InterfazePlugin.kt
git commit -m "$(cat <<'EOF'
feat(plugin): InterfazePlugin — instantiate ResourcePackDelegator from config

When `resource-pack.delegate-to-dir` is set, build a delegator targeting
that directory and inject it into ResourcePackManager. If the directory
isn't writable, log a warning and fall back to legacy push mode rather
than refusing to start.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Update `config.yml` template + `CLAUDE.md`

**Files:**
- Modify: `plugin/src/main/resources/config.yml`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the documented entry to `config.yml`**

Open `plugin/src/main/resources/config.yml`. After the existing `send-delay-ticks: 20` line in the `resource-pack:` block, append:

```yaml
  # When set, Interfaze stops pushing its own RP to players and extracts its
  # pack contents into this directory. The admin configures the host RP
  # plugin (Oraxen / Nexo / ItemsAdder / etc.) to read from this path, then
  # runs the host's reload command after every Interfaze update.
  #
  # Path is filesystem-absolute or relative to the server root. Interfaze
  # owns the `assets/interfaze/` subtree inside it and wipes it before
  # every extraction. Other files in the dir are left untouched.
  #
  # Default: empty (legacy mode — Interfaze pushes its own RP to players).
  delegate-to-dir: ""
```

- [ ] **Step 2: Add a note to `CLAUDE.md`**

Open `CLAUDE.md`. Find the section that documents resource-pack behavior (search for `RESOURCE_PACK_BASE_URL` — it's referenced in the env-vars table). After that section, add a new subsection:

```markdown
### Resource pack distribution modes

Two modes, switched by the plugin config `resource-pack.delegate-to-dir`:

| Mode | When | Behavior |
|---|---|---|
| Legacy (default) | `delegate-to-dir` empty | Plugin pushes its own RP via `addResourcePack` on join + on every update. Coexists with other RP plugins via the multi-pack stack (each pack has its own UUID). Two prompts at login when a host plugin also pushes. |
| Delegation | `delegate-to-dir: <path>` | Plugin extracts `assets/interfaze/*` into `<path>/assets/interfaze/` on every update. Skips player push. Admin manually reloads the host RP plugin (`/oraxen reload`, `/iazip`, etc.) after each update. Single download for the player (host pack only). |

The delegation path owns the `assets/interfaze/` subtree only — `pack.mcmeta` and anything outside that namespace is skipped, so it's safe to point at Oraxen/Nexo/ItemsAdder/etc. pack-source directories.
```

- [ ] **Step 3: Commit**

Inspect WIP first via `git diff CLAUDE.md plugin/src/main/resources/config.yml`. Sweep WIP honestly if any.

```bash
git add plugin/src/main/resources/config.yml CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: resource-pack delegate-to-dir — config entry + CLAUDE.md modes table

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Full-suite green check + manual smoke

- [ ] **Step 1: Run the full plugin suite**

```
./gradlew test
```
Expected: BUILD SUCCESSFUL. Plugin test count up by ~13 (3 config + 7 delegator + 3 manager).

- [ ] **Step 2: Rebuild + redeploy the plugin JAR**

```
./gradlew deploy
```
Rebuilds the shadowJar and restarts `interfaze-minecraft-1`. The new code is now live in the dev container.

- [ ] **Step 3: Manual smoke — legacy mode unchanged**

- Leave `resource-pack.delegate-to-dir` unset / empty in `plugins/Interfaze/config.yml`.
- Connect a Minecraft client.
- Confirm the Interfaze RP prompt appears at login (legacy behavior).

- [ ] **Step 4: Manual smoke — delegation mode**

- Stop the server.
- Edit `plugins/Interfaze/config.yml`: set `delegate-to-dir: "plugins/Interfaze/_delegate_test/"` (relative path, server-root-resolved).
- Start the server. Watch the log for `[delegate] delegation enabled, target dir: ...` (Task 4 step 2).
- Trigger a resource-pack rebuild (e.g. from the editor: change an asset, save, deploy).
- Watch the log for `[delegate] extracted Interfaze pack into ...` followed by `[delegate] pack updated — reload the host RP plugin to apply`.
- Check the disk: `plugins/Interfaze/_delegate_test/assets/interfaze/` should now contain `font/default.json` + the asset textures + (if any) custom font directories.
- Confirm no `pack.mcmeta` exists at `plugins/Interfaze/_delegate_test/pack.mcmeta`.
- Connect a Minecraft client: no Interfaze pack prompt should appear.

- [ ] **Step 5: Manual smoke — fallback on bad path**

- Set `delegate-to-dir: "/proc/1/root/forbidden"` (a path that's not writable).
- Restart server. Watch log for `[delegate] ... is not a writable directory — falling back to legacy push mode`.
- Confirm legacy behavior: Interfaze RP prompt reappears at login.

- [ ] **Step 6: Stop**

Plan complete. Do not commit anything in this task — verification only.

---

## Self-review checklist

**Spec coverage:**

- [x] Section "Configuration" (config flag + Kotlin shape) → Task 1.
- [x] Section "Architecture" — `ResourcePackDelegator` component → Task 2.
- [x] Section "Architecture" — `ResourcePackManager` wiring → Task 3.
- [x] Section "Architecture" — `InterfazePlugin` instantiation with writability fallback → Task 4.
- [x] Section "Behavior summary" — modes table → Task 5 (docs in CLAUDE.md).
- [x] Section "Edge cases" — hash mismatch / path traversal / non-writable dir → covered in Tasks 2 + 4 (tests + fallback).
- [x] Section "Tests" — all listed tests assigned to a task.
- [x] Section "File touch list" — every file in the spec list is touched by some task.

**Placeholder scan:** No "TBD", no "implement later", no "add appropriate error handling". Every code step shows the actual code.

**Type consistency:**

- `ResourcePackConfig.delegateToDir: String?` — used identically in Tasks 1, 4.
- `ResourcePackDelegator` constructor: `(targetDir: File, logger: Logger?)` — used identically in Tasks 2, 3 (recording subclass), 4 (production instantiation).
- `ResourcePackDelegator.apply(downloadUrl: String, expectedHash: String)` and `applyBytes(zipBytes: ByteArray, expectedHash: String)` — signatures consistent across Tasks 2 (definition + tests), 3 (manager calls `apply`).
- `ResourcePackManager` constructor: `delegator: ResourcePackDelegator? = null` — defined in Task 3, used in Task 4.
- `runDelegate` test seam: declared `protected open` in Task 3, overridden `public override` in Task 3 test subclass.
