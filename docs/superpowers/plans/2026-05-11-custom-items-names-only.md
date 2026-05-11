# Custom items library — names-only sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip custom-items sync to just `{id, label, category}`; remove texture/model bundling and replace 3D thumbnails with placeholders.

**Architecture:** Plugin's `CustomItemSource` implementations stop reading any zip / pack content. `CustomItemsManager.buildBundle()` produces a zip containing only `items.json`. Backend cleans up stale on-disk `textures/`/`models/` when a new-schema bundle arrives. Editor library + canvas render a generic placeholder for custom items.

**Tech Stack:** Plugin: Kotlin 2.0 + Paper 1.21.4. Backend: Bun + Hono + TypeScript. Editor: React 19 + Vite + Vitest.

---

## File Structure

**Plugin (modify):**
- `plugin/src/main/kotlin/gg/interfaze/plugin/customitems/CustomItemSource.kt` — drop `loadTexture()` from interface; shrink `CustomItemEntry`
- `plugin/src/main/kotlin/gg/interfaze/plugin/customitems/NexoSource.kt` — gut: keep only `itemNames()` enumeration
- `plugin/src/main/kotlin/gg/interfaze/plugin/customitems/OraxenSource.kt` — drop texture/model loaders
- `plugin/src/main/kotlin/gg/interfaze/plugin/customitems/ItemsAdderSource.kt` — drop texture/model loaders
- `plugin/src/main/kotlin/gg/interfaze/plugin/customitems/CustomItemsManager.kt` — bundle only `items.json`; hash only the names list
- `plugin/src/test/kotlin/gg/interfaze/plugin/CustomItemsManagerTest.kt` — rewrite tests for new bundle shape

**Backend (modify):**
- `backend/src/lib/customItems.ts` — clean up stale `textures/`/`models/` directories when a new bundle lacks them
- `backend/src/lib/customItems.test.ts` — new test covering cleanup behavior (file path is the existing test file if any; otherwise create one)

**Editor (modify):**
- `editor/src/lib/packApi.ts` — make `LibraryItem.texture` optional
- `editor/src/features/canvas/Library.tsx` — render placeholder tile when an item has neither `model` nor `texture`
- `editor/src/features/canvas/useTextureInit.ts` — skip `renderToCanvas` when an item has no `model`
- `editor/src/features/canvas/Library.test.tsx` — add a test asserting placeholder rendering for custom items

---

## Task 1: Shrink `CustomItemEntry` and remove `loadTexture` from the interface

**Files:**
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/customitems/CustomItemSource.kt`

- [ ] **Step 1: Replace file content**

Open the file. Replace its entire content with:

```kotlin
package gg.interfaze.plugin.customitems

interface CustomItemSource {
    val namespace: String
    fun isAvailable(): Boolean
    fun collectItems(): List<CustomItemEntry>
}

data class CustomItemEntry(
    val id: String,       // e.g. "nexo:iron_coin"
    val label: String,    // human-readable or = id when no label available
    val category: String, // namespace ("nexo", "oraxen", "itemsadder")
)
```

Note: callers in steps below stop using `texturePath`, `modelJson`, `loadTexture`. The `category()` helper method is removed because `category` is now an explicit field on the data class.

- [ ] **Step 2: Build to surface call sites that need fixing**

Run: `cd plugin && ./gradlew compileKotlin`
Expected: compile errors in `NexoSource.kt`, `OraxenSource.kt`, `ItemsAdderSource.kt`, `CustomItemsManager.kt`, and `CustomItemsManagerTest.kt`. These are the call sites the remaining tasks fix.

Don't commit yet — leave the compile broken; subsequent tasks complete the migration.

---

## Task 2: Strip `NexoSource` down to the name list

**Files:**
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/customitems/NexoSource.kt`

- [ ] **Step 1: Replace file content**

Replace the entire file content with:

```kotlin
package gg.interfaze.plugin.customitems

import org.bukkit.Bukkit
import java.io.File
import java.util.logging.Logger

private val log = Logger.getLogger("Interfaze")

class NexoSource(@Suppress("UNUSED_PARAMETER") pluginsDir: File) : CustomItemSource {
    override val namespace = "nexo"

    override fun isAvailable(): Boolean =
        runCatching { Bukkit.getPluginManager().getPlugin("Nexo") != null }.getOrDefault(false)

    override fun collectItems(): List<CustomItemEntry> {
        if (!isAvailable()) return emptyList()
        return try {
            val nexoItems = Class.forName("com.nexomc.nexo.api.NexoItems")
            @Suppress("UNCHECKED_CAST")
            val names = nexoItems.getMethod("itemNames").invoke(null) as Collection<String>
            log.info("[IFZ] NexoSource: ${names.size} item name(s) from Nexo")
            names.map { id -> CustomItemEntry(id = "nexo:$id", label = id, category = "nexo") }
        } catch (e: Exception) {
            log.warning("[IFZ] NexoSource.collectItems() failed: ${e.javaClass.name}: ${e.message}")
            emptyList()
        }
    }
}
```

The `pluginsDir` constructor parameter is kept for binary compatibility with callers (e.g. `InterfazePlugin.onEnable` which passes `server.pluginsFolder`). It's now unused.

- [ ] **Step 2: Compile**

Run: `cd plugin && ./gradlew compileKotlin`
Expected: `NexoSource.kt` now compiles. Other call sites still broken — addressed in following tasks.

---

## Task 3: Strip `OraxenSource` to the name list

**Files:**
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/customitems/OraxenSource.kt`

- [ ] **Step 1: Replace file content**

```kotlin
package gg.interfaze.plugin.customitems

import org.bukkit.Bukkit
import java.io.File

class OraxenSource(@Suppress("UNUSED_PARAMETER") pluginsDir: File) : CustomItemSource {
    override val namespace = "oraxen"

    override fun isAvailable(): Boolean =
        runCatching { Bukkit.getPluginManager().getPlugin("Oraxen") != null }.getOrDefault(false)

    override fun collectItems(): List<CustomItemEntry> {
        if (!isAvailable()) return emptyList()
        return try {
            val oraxenItems = Class.forName("io.th0rgal.oraxen.api.OraxenItems")
            @Suppress("UNCHECKED_CAST")
            val entries = oraxenItems.getMethod("getEntries").invoke(null) as Set<Map.Entry<String, *>>
            entries.map { (id, _) ->
                CustomItemEntry(id = "oraxen:$id", label = id, category = "oraxen")
            }
        } catch (_: Exception) { emptyList() }
    }
}
```

- [ ] **Step 2: Compile**

Run: `cd plugin && ./gradlew compileKotlin`
Expected: `OraxenSource.kt` compiles.

---

## Task 4: Strip `ItemsAdderSource` to the name list

**Files:**
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/customitems/ItemsAdderSource.kt`

- [ ] **Step 1: Replace file content**

```kotlin
package gg.interfaze.plugin.customitems

import org.bukkit.Bukkit
import java.io.File

class ItemsAdderSource(@Suppress("UNUSED_PARAMETER") pluginsDir: File) : CustomItemSource {
    override val namespace = "itemsadder"

    override fun isAvailable(): Boolean =
        runCatching { Bukkit.getPluginManager().getPlugin("ItemsAdder") != null }.getOrDefault(false)

    override fun collectItems(): List<CustomItemEntry> {
        if (!isAvailable()) return emptyList()
        return try {
            val csClass = Class.forName("dev.lone.itemsadder.api.CustomStack")
            @Suppress("UNCHECKED_CAST")
            val items = csClass.getMethod("getAllItems").invoke(null) as Collection<*>
            items.mapNotNull { stack ->
                val id = stack?.javaClass?.getMethod("getId")?.invoke(stack) as? String
                    ?: return@mapNotNull null
                CustomItemEntry(id = "itemsadder:$id", label = id, category = "itemsadder")
            }
        } catch (_: Exception) { emptyList() }
    }
}
```

- [ ] **Step 2: Compile**

Run: `cd plugin && ./gradlew compileKotlin`
Expected: `ItemsAdderSource.kt` compiles. `CustomItemsManager.kt` still broken.

---

## Task 5: Slim `CustomItemsManager` — names-only bundle + hash

**Files:**
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/customitems/CustomItemsManager.kt`

- [ ] **Step 1: Replace file content**

```kotlin
package gg.interfaze.plugin.customitems

import com.fasterxml.jackson.databind.ObjectMapper
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.Base64
import java.util.zip.GZIPOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class CustomItemsManager(private val sources: List<CustomItemSource>) {

    private val jsonMapper = ObjectMapper()

    fun availableSources(): List<String> = sources.filter { it.isAvailable() }.map { it.namespace }

    /**
     * Stable SHA-256 of the sorted (id|label) list across all available sources.
     * Texture/model content is intentionally NOT hashed — bundles no longer carry it.
     * Returns "" when no sources produce any items.
     */
    fun computeHash(): String {
        val entries = collect()
        if (entries.isEmpty()) return ""
        val digest = MessageDigest.getInstance("SHA-256")
        for (e in entries.sortedBy { it.id }) {
            digest.update(e.id.toByteArray(Charsets.UTF_8))
            digest.update(0)
            digest.update(e.label.toByteArray(Charsets.UTF_8))
            digest.update(0)
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    /**
     * Returns (hash, base64(gzip(zip))) where the zip contains a single `items.json`
     * entry. Returns null when no items are available.
     */
    fun buildBundle(): Pair<String, String>? {
        val entries = collect()
        if (entries.isEmpty()) return null

        val items = entries.sortedBy { it.id }.map { e ->
            mapOf(
                "id"       to e.id,
                "label"    to stripColorCodes(e.label),
                "category" to e.category,
            )
        }
        val hash = computeHash()
        val data = encode(items)
        return Pair(hash, data)
    }

    internal fun stripColorCodes(s: String): String = s.replace(Regex("§[0-9a-fk-orA-FK-OR]"), "")

    private fun collect(): List<CustomItemEntry> =
        sources.filter { it.isAvailable() }.flatMap { it.collectItems() }

    private fun encode(items: List<Map<String, String>>): String {
        val zipBytes = ByteArrayOutputStream()
        ZipOutputStream(zipBytes).use { zip ->
            zip.putNextEntry(ZipEntry("items.json"))
            zip.write(jsonMapper.writeValueAsBytes(items))
            zip.closeEntry()
        }
        val gzipped = ByteArrayOutputStream()
        GZIPOutputStream(gzipped).use { gz -> gz.write(zipBytes.toByteArray()) }
        return Base64.getEncoder().encodeToString(gzipped.toByteArray())
    }
}
```

Notes:
- `PLACEHOLDER_PNG` constant is removed (no textures bundled).
- `rawItemCount()` is removed (was already removed from `SyncedMenuProvider.load()`; no remaining callers).
- The hash uses `0` byte separators between `id` and `label` so that `"abc"+"de"` does not collide with `"ab"+"cde"`.

- [ ] **Step 2: Compile**

Run: `cd plugin && ./gradlew compileKotlin`
Expected: production code compiles. Tests still broken — fixed next task.

---

## Task 6: Rewrite `CustomItemsManagerTest` for the new bundle shape

**Files:**
- Modify: `plugin/src/test/kotlin/gg/interfaze/plugin/CustomItemsManagerTest.kt`

- [ ] **Step 1: Replace file content**

```kotlin
package gg.interfaze.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import gg.interfaze.plugin.customitems.CustomItemEntry
import gg.interfaze.plugin.customitems.CustomItemSource
import gg.interfaze.plugin.customitems.CustomItemsManager
import java.io.ByteArrayInputStream
import java.util.Base64
import java.util.zip.GZIPInputStream
import java.util.zip.ZipInputStream
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CustomItemsManagerTest {

    private val jsonMapper = ObjectMapper()

    private fun fakeSource(ns: String, items: List<Pair<String, String>>): CustomItemSource =
        object : CustomItemSource {
            override val namespace = ns
            override fun isAvailable() = true
            override fun collectItems() = items.map { (id, label) ->
                CustomItemEntry(id = "$ns:$id", label = label, category = ns)
            }
        }

    private fun unavailableSource(): CustomItemSource =
        object : CustomItemSource {
            override val namespace = "missing"
            override fun isAvailable() = false
            override fun collectItems() = error("should not be called")
        }

    private fun decodeBundle(data: String): Pair<Set<String>, List<Map<String, String>>?> {
        val decoded = Base64.getDecoder().decode(data)
        val entries = mutableSetOf<String>()
        var itemsJson: ByteArray? = null
        ZipInputStream(GZIPInputStream(ByteArrayInputStream(decoded))).use { zip ->
            var e = zip.nextEntry
            while (e != null) {
                entries += e.name
                if (e.name == "items.json") itemsJson = zip.readBytes()
                e = zip.nextEntry
            }
        }
        val items: List<Map<String, String>>? = itemsJson?.let {
            @Suppress("UNCHECKED_CAST")
            jsonMapper.readValue(it, List::class.java) as List<Map<String, String>>
        }
        return entries to items
    }

    @Test fun `computeHash returns empty string when no sources available`() {
        val mgr = CustomItemsManager(listOf(unavailableSource()))
        assertEquals("", mgr.computeHash())
    }

    @Test fun `computeHash returns empty string when sources are empty`() {
        val mgr = CustomItemsManager(listOf(fakeSource("nexo", emptyList())))
        assertEquals("", mgr.computeHash())
    }

    @Test fun `computeHash is stable for same items`() {
        val mgr = CustomItemsManager(listOf(fakeSource("nexo", listOf("coin" to "Coin", "gem" to "Gem"))))
        assertEquals(mgr.computeHash(), mgr.computeHash())
    }

    @Test fun `computeHash changes when item set changes`() {
        val a = CustomItemsManager(listOf(fakeSource("nexo", listOf("coin" to "Coin"))))
        val b = CustomItemsManager(listOf(fakeSource("nexo", listOf("gem" to "Gem"))))
        assertTrue(a.computeHash() != b.computeHash())
    }

    @Test fun `computeHash changes when only label changes`() {
        val a = CustomItemsManager(listOf(fakeSource("nexo", listOf("coin" to "Coin"))))
        val b = CustomItemsManager(listOf(fakeSource("nexo", listOf("coin" to "Iron Coin"))))
        assertTrue(a.computeHash() != b.computeHash())
    }

    @Test fun `computeHash does not collide between concatenated ids`() {
        // "ab"+"cd" should NOT hash the same as "abc"+"d".
        val a = CustomItemsManager(listOf(fakeSource("nexo", listOf("ab" to "cd"))))
        val b = CustomItemsManager(listOf(fakeSource("nexo", listOf("abc" to "d"))))
        assertTrue(a.computeHash() != b.computeHash())
    }

    @Test fun `buildBundle returns null when no items available`() {
        assertNull(CustomItemsManager(listOf(unavailableSource())).buildBundle())
    }

    @Test fun `buildBundle zip contains only items_json — no textures or models`() {
        val mgr = CustomItemsManager(listOf(fakeSource("nexo", listOf("coin" to "Iron Coin"))))
        val (_, data) = assertNotNull(mgr.buildBundle())
        val (entries, items) = decodeBundle(data)

        assertEquals(setOf("items.json"), entries)
        assertNotNull(items)
        assertEquals(1, items!!.size)
        assertEquals("nexo:coin", items[0]["id"])
        assertEquals("Iron Coin", items[0]["label"])
        assertEquals("nexo", items[0]["category"])
    }

    @Test fun `buildBundle strips color codes from labels`() {
        val mgr = CustomItemsManager(listOf(fakeSource("nexo", listOf("coin" to "§6Iron §rCoin"))))
        val (_, data) = assertNotNull(mgr.buildBundle())
        val (_, items) = decodeBundle(data)
        assertEquals("Iron Coin", items!![0]["label"])
    }

    @Test fun `buildBundle merges items from multiple sources sorted by id`() {
        val mgr = CustomItemsManager(listOf(
            fakeSource("oraxen", listOf("a" to "A")),
            fakeSource("nexo", listOf("z" to "Z", "a" to "A")),
        ))
        val (_, data) = assertNotNull(mgr.buildBundle())
        val (_, items) = decodeBundle(data)
        assertEquals(listOf("nexo:a", "nexo:z", "oraxen:a"), items!!.map { it["id"] })
    }

    @Test fun `stripColorCodes removes section-sign sequences`() {
        val mgr = CustomItemsManager(emptyList())
        assertEquals("Iron Coin", mgr.stripColorCodes("§6Iron §rCoin"))
    }

    @Test fun `NexoSource isAvailable returns false when Nexo plugin not installed`() {
        val source = gg.interfaze.plugin.customitems.NexoSource(java.io.File("/nonexistent"))
        assertFalse(source.isAvailable())
    }

    @Test fun `OraxenSource isAvailable returns false when Oraxen plugin not installed`() {
        val source = gg.interfaze.plugin.customitems.OraxenSource(java.io.File("/nonexistent"))
        assertFalse(source.isAvailable())
    }

    @Test fun `ItemsAdderSource isAvailable returns false when ItemsAdder plugin not installed`() {
        val source = gg.interfaze.plugin.customitems.ItemsAdderSource(java.io.File("/nonexistent"))
        assertFalse(source.isAvailable())
    }
}
```

- [ ] **Step 2: Run the test suite**

Run: `cd plugin && ./gradlew test`
Expected: all plugin tests pass. (~190 tests total; CustomItemsManagerTest has 13 tests after this rewrite.)

- [ ] **Step 3: Commit plugin changes**

```bash
git add plugin/src/main/kotlin/gg/interfaze/plugin/customitems/CustomItemSource.kt plugin/src/main/kotlin/gg/interfaze/plugin/customitems/NexoSource.kt plugin/src/main/kotlin/gg/interfaze/plugin/customitems/OraxenSource.kt plugin/src/main/kotlin/gg/interfaze/plugin/customitems/ItemsAdderSource.kt plugin/src/main/kotlin/gg/interfaze/plugin/customitems/CustomItemsManager.kt plugin/src/test/kotlin/gg/interfaze/plugin/CustomItemsManagerTest.kt
git commit -m "$(cat <<'EOF'
refactor(plugin): custom items bundle = names only

Drop texture/model extraction from all CustomItemSource implementations.
Bundle is now a single items.json with {id, label, category} entries.
Eliminates 1700-item zip indexing at startup and the file-handle races
with Nexo's PackGenerator.
EOF
)"
```

---

## Task 7: Backend cleanup — remove stale `textures/` and `models/` on new-schema bundle

**Files:**
- Modify: `backend/src/lib/customItems.ts`
- Create or modify: `backend/src/lib/customItems.test.ts`

- [ ] **Step 1: Write the failing test**

If `backend/src/lib/customItems.test.ts` doesn't exist, create it:

```ts
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { gzipSync, zipSync, strToU8 } from "fflate";
import { processBundle } from "./customItems";

function makeBundleZip(items: unknown[]): string {
  const itemsJson = strToU8(JSON.stringify(items));
  const zipBytes = zipSync({ "items.json": itemsJson });
  const gz = gzipSync(zipBytes);
  return Buffer.from(gz).toString("base64");
}

describe("processBundle — names-only schema", () => {
  let cacheDir: string;
  beforeEach(async () => {
    cacheDir = join(tmpdir(), `ifz-test-${Date.now()}-${Math.random()}`);
    await mkdir(cacheDir, { recursive: true });
  });
  afterEach(async () => { await rm(cacheDir, { recursive: true, force: true }); });

  it("writes items.json and hash.txt", async () => {
    const data = makeBundleZip([{ id: "nexo:coin", label: "Coin", category: "nexo" }]);
    await processBundle(cacheDir, "abc123", data);
    expect(existsSync(join(cacheDir, "items.json"))).toBe(true);
    expect(existsSync(join(cacheDir, "hash.txt"))).toBe(true);
  });

  it("removes stale textures/ and models/ when new bundle has none", async () => {
    // Seed stale data from a previous (old-schema) bundle.
    await mkdir(join(cacheDir, "textures", "nexo"), { recursive: true });
    await mkdir(join(cacheDir, "models", "nexo"), { recursive: true });
    await writeFile(join(cacheDir, "textures", "nexo", "coin.png"), Buffer.from([0]));
    await writeFile(join(cacheDir, "models", "nexo", "coin.json"), "{}");

    const data = makeBundleZip([{ id: "nexo:coin", label: "Coin", category: "nexo" }]);
    await processBundle(cacheDir, "abc123", data);

    expect(existsSync(join(cacheDir, "textures"))).toBe(false);
    expect(existsSync(join(cacheDir, "models"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && bun test src/lib/customItems.test.ts`
Expected: second test FAILS — stale `textures/` and `models/` directories are still present after `processBundle`.

- [ ] **Step 3: Implement cleanup**

Replace `backend/src/lib/customItems.ts` with:

```ts
import { join, dirname, resolve, relative } from "path";
import { existsSync } from "fs";
import { mkdir, writeFile, readFile, rm } from "fs/promises";
import { gunzipSync, unzipSync } from "fflate";

export interface CustomItemEntry {
  id: string;
  label: string;
  category: string;
}

export function customItemsCacheDir(serverKeyId: string): string {
  const DATA_DIR = join(import.meta.dir, "../../data");
  return join(DATA_DIR, "custom-items", serverKeyId);
}

export async function readCustomItemsHash(cacheDir: string): Promise<string> {
  try {
    return (await readFile(join(cacheDir, "hash.txt"), "utf-8")).trim();
  } catch {
    return "";
  }
}

export async function readCustomItems(cacheDir: string): Promise<CustomItemEntry[]> {
  try {
    const raw = await readFile(join(cacheDir, "items.json"), "utf-8");
    return JSON.parse(raw) as CustomItemEntry[];
  } catch {
    return [];
  }
}

export async function processBundle(cacheDir: string, hash: string, data: string): Promise<void> {
  const gzipped = Buffer.from(data, "base64");
  const zipped = gunzipSync(gzipped);
  const files = unzipSync(zipped);

  let hasTextures = false;
  let hasModels = false;
  const writes: Promise<void>[] = [];
  for (const [path, bytes] of Object.entries(files)) {
    if (path !== "items.json" && !path.startsWith("textures/") && !path.startsWith("models/")) continue;
    if (path.startsWith("textures/")) hasTextures = true;
    if (path.startsWith("models/")) hasModels = true;
    const fullPath = join(cacheDir, path);
    if (relative(resolve(cacheDir), resolve(fullPath)).startsWith("..")) continue;
    writes.push(
      mkdir(dirname(fullPath), { recursive: true }).then(() => writeFile(fullPath, bytes)),
    );
  }
  await Promise.all(writes);

  // Migration cleanup: a new-schema bundle carries items.json only. Wipe any
  // textures/models left from a previous full-schema bundle so 404 responses
  // are consistent with what the plugin reports.
  if (!hasTextures && existsSync(join(cacheDir, "textures"))) {
    await rm(join(cacheDir, "textures"), { recursive: true, force: true });
  }
  if (!hasModels && existsSync(join(cacheDir, "models"))) {
    await rm(join(cacheDir, "models"), { recursive: true, force: true });
  }

  await writeFile(join(cacheDir, "hash.txt"), hash);
}
```

- [ ] **Step 4: Run the test again**

Run: `cd backend && bun test src/lib/customItems.test.ts`
Expected: both tests PASS.

- [ ] **Step 5: Run the full backend test suite**

Run: `cd backend && bun test`
Expected: all backend tests pass (the 2 pre-existing failures noted in CLAUDE.md may remain).

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/customItems.ts backend/src/lib/customItems.test.ts
git commit -m "$(cat <<'EOF'
fix(backend): clean stale textures/models on names-only bundle

When a bundle carries items.json only (new schema), wipe any leftover
textures/ and models/ directories from a previous full-schema bundle.
EOF
)"
```

---

## Task 8: Editor — make `LibraryItem.texture` optional and skip render for items without `model`

**Files:**
- Modify: `editor/src/lib/packApi.ts`
- Modify: `editor/src/features/canvas/useTextureInit.ts`

- [ ] **Step 1: Loosen the type**

Open `editor/src/lib/packApi.ts`. In the `LibraryItem` interface, change `texture: string;` to `texture?: string;`:

```ts
export interface LibraryItem {
  id: string;
  label: string;
  category: string;
  texture?: string;
  model?: string;
  tints?: Record<number, string>;
}
```

- [ ] **Step 2: Type-check**

Run: `cd editor && npx tsc --noEmit`
Expected: surfaces any spots that assumed `item.texture` is non-null. They'll be addressed in Task 9.

- [ ] **Step 3: Verify useTextureInit already short-circuits**

Open `editor/src/features/canvas/useTextureInit.ts`. The existing loop already does `if (!item.model) continue;` — no change needed. Verify by reading lines 33-40. If the guard is missing, add it before `renderToCanvas` is called.

- [ ] **Step 4: Commit the type change**

```bash
git add editor/src/lib/packApi.ts
git commit -m "chore(editor): LibraryItem.texture is optional (names-only custom items)"
```

---

## Task 9: Editor — render placeholder tile for items without `texture`/`model`

**Files:**
- Modify: `editor/src/features/canvas/Library.tsx`
- Modify: `editor/src/features/canvas/Library.test.tsx`

- [ ] **Step 1: Write the failing test**

In `editor/src/features/canvas/Library.test.tsx`, add a test verifying that a custom item without `texture` or `model` renders a placeholder element instead of an `<img>` with a broken URL. Append the following test to the existing `describe("Library", ...)` block (or create the block if absent):

```tsx
it("renders a placeholder for custom items without texture or model", () => {
  // Seed the texture store with a custom item that has no texture and no model.
  useTextureStore.setState({
    libraryItems: [],
    libraryCustomData: {
      serverKeyId: "sk_test",
      items: [{ id: "nexo:forest_sword", label: "forest_sword", category: "nexo" }],
    },
    libraryBundleReady: true,
    libraryError: false,
  });

  render(<Library />);
  // The tile renders with the item label as title, and uses the placeholder
  // marker `data-placeholder` instead of an <img> with a broken src.
  const tile = screen.getByTitle("forest_sword");
  expect(tile.querySelector("[data-placeholder]")).not.toBeNull();
  expect(tile.querySelector("img")).toBeNull();
});
```

Imports to add at the top of the test file if not already present:

```tsx
import { render, screen } from "@testing-library/react";
import { useTextureStore } from "@/features/canvas/textureStore";
import { Library } from "@/features/canvas/Library";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd editor && npx vitest run src/features/canvas/Library.test.tsx`
Expected: new test FAILS — `<img>` is rendered with a broken `src`, no `[data-placeholder]` element.

- [ ] **Step 3: Update `ItemTile` to render a placeholder when no texture and no model**

In `editor/src/features/canvas/Library.tsx`, modify the body of `ItemTile`. Replace the current `<img ... />` element with a conditional render:

```tsx
const hasVisual = Boolean(renderedSrc || item.texture);
// ... inside the JSX:
{hasVisual ? (
  <img
    src={renderedSrc ?? `${textureBase}/${item.texture}`}
    alt={item.label}
    loading="lazy"
    draggable={false}
    className="h-full w-full object-contain p-1"
    style={{ imageRendering: renderedSrc ? "auto" : "pixelated" }}
    onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }}
  />
) : (
  <span
    data-placeholder
    className="flex h-full w-full items-center justify-center text-xs font-medium uppercase text-zinc-400"
    aria-hidden="true"
  >
    {item.category.charAt(0)}
  </span>
)}
```

The `flatUrl` local variable can be inlined as shown above (no separate const needed) since it's only referenced in the `<img>` branch. Remove the `const flatUrl = ...;` line.

- [ ] **Step 4: Run tests**

Run: `cd editor && npx vitest run src/features/canvas/Library.test.tsx`
Expected: the new test PASSES. Existing tests still pass.

- [ ] **Step 5: Full editor test suite**

Run: `cd editor && npm test`
Expected: 400+ tests pass (Library test count goes up by 1).

- [ ] **Step 6: Commit**

```bash
git add editor/src/features/canvas/Library.tsx editor/src/features/canvas/Library.test.tsx
git commit -m "$(cat <<'EOF'
feat(editor): placeholder tile for custom items without texture

Custom items now sync as names only. Library shows a category-letter
placeholder where the 3D / flat thumbnail used to render.
EOF
)"
```

---

## Task 10: Manual end-to-end smoke

**Files:** none (manual verification)

- [ ] **Step 1: Deploy the plugin**

Run: `cd plugin && ./gradlew deploy`
Expected: container restarts; no "zip file closed" warning during startup.

- [ ] **Step 2: Watch logs**

Watch the Minecraft server logs for ~30 seconds after restart. Expected lines:
- `[IFZ] Custom item sources available: [nexo]` (or whatever plugins are installed)
- 10 s after server "Done": `[IFZ] NexoSource: <N> item name(s) from Nexo`
- Shortly after: `[IFZ] Sending custom items bundle — hash=...`

Should NOT see:
- `zip file closed`
- `NexoItemRenderer.buildStack failed`
- Server hang > 5 s on Nexo-related work during enable

- [ ] **Step 3: Editor verification**

Open the editor, hard-refresh (Ctrl+Shift+R). In the Library:
- Custom items appear by name (`nexo:forest_sword`, etc.) with a small letter placeholder (`N`/`O`/`I`).
- Search/filter still works.
- Dropping a custom item on the canvas places it (placeholder shows in the slot).

- [ ] **Step 4: In-game verification**

Open a menu that uses a Nexo item. The item still renders correctly in-game (`MenuRenderer.buildItem` is unchanged — `NexoItemRenderer.buildStack` already covers this).
