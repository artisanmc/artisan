# Custom Items Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render custom items (Nexo/Oraxen/ItemsAdder) as isometric 32×32 icons in the editor Library, matching the vanilla item rendering pipeline that already exists in `iconRenderer.ts`.

**Architecture:** Plugin bundles extend to include model JSONs alongside textures; backend runs the existing `iconRenderer.ts` pipeline on each custom item when the bundle arrives, writing pre-rendered icons to `cacheDir/textures/icons/`; editor fetches icons via the existing `/api/textures/custom/` endpoint unchanged.

**Tech Stack:** Kotlin 2.0 (plugin), Bun + TypeScript (backend), pngjs + fflate (already used), existing `iconRenderer.ts` + `gen-items.ts` patterns.

---

## File Map

**Modified (plugin):**
- `plugin/src/main/kotlin/net/artisanmc/plugin/customitems/CustomItemSource.kt` — Add `modelJson: ByteArray? = null` to `CustomItemEntry`
- `plugin/src/main/kotlin/net/artisanmc/plugin/customitems/CustomItemsManager.kt` — Extend `buildBundle()`/`buildData()`/hash computation to include models
- `plugin/src/main/kotlin/net/artisanmc/plugin/customitems/NexoSource.kt` — Add private `loadModelJson(itemId: String): ByteArray?`
- `plugin/src/main/kotlin/net/artisanmc/plugin/customitems/OraxenSource.kt` — Add private `loadModelJson(id: String): ByteArray?`
- `plugin/src/main/kotlin/net/artisanmc/plugin/customitems/ItemsAdderSource.kt` — Add private `loadModelJson(ns: String, name: String): ByteArray?`
- `plugin/src/test/kotlin/net/artisanmc/plugin/CustomItemsManagerTest.kt` — New tests for model JSON bundle, hash

**Created (backend):**
- `backend/src/lib/customItemRenderer.ts` — `renderCustomIconsWithPaths()` + `renderCustomIcons()`
- `backend/src/lib/customItemRenderer.test.ts` — Unit tests

**Modified (backend):**
- `backend/src/lib/customItems.ts` — Allow `models/` paths in `processBundle()`
- `backend/src/ws/hub.ts` — Call `renderCustomIcons()` after processBundle

---

## Task 1: Extend `CustomItemEntry` + `CustomItemsManager` bundle

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/customitems/CustomItemSource.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/customitems/CustomItemsManager.kt`
- Modify: `plugin/src/test/kotlin/net/artisanmc/plugin/CustomItemsManagerTest.kt`

- [ ] **Step 1: Write failing tests**

Add to `CustomItemsManagerTest.kt` (after the existing `stripColorCodes` test):

```kotlin
@Test
fun `buildBundle includes models entry for item with modelJson`() {
    val modelBytes = """{"parent":"item/generated","textures":{"layer0":"nexo:item/coin"}}""".toByteArray()
    val source = object : CustomItemSource {
        override val namespace = "nexo"
        override fun isAvailable() = true
        override fun collectItems() = listOf(
            CustomItemEntry("nexo:coin", "Coin", "nexo/coin", modelBytes)
        )
        override fun loadTexture(path: String) = "fake-png".toByteArray()
    }
    val mgr = CustomItemsManager(listOf(source))
    val (_, data) = assertNotNull(mgr.buildBundle())
    val decoded = Base64.getDecoder().decode(data)
    val entries = mutableSetOf<String>()
    ZipInputStream(GZIPInputStream(ByteArrayInputStream(decoded))).use { zip ->
        var e = zip.nextEntry
        while (e != null) { entries += e.name; e = zip.nextEntry }
    }
    assertTrue("models/nexo/coin.json" in entries)
    assertTrue("textures/nexo/coin.png" in entries)
}

@Test
fun `buildBundle omits models entry when modelJson is null`() {
    val mgr = CustomItemsManager(listOf(fakeSource("nexo", listOf("coin" to "Coin"))))
    val (_, data) = assertNotNull(mgr.buildBundle())
    val decoded = Base64.getDecoder().decode(data)
    val entries = mutableSetOf<String>()
    ZipInputStream(GZIPInputStream(ByteArrayInputStream(decoded))).use { zip ->
        var e = zip.nextEntry
        while (e != null) { entries += e.name; e = zip.nextEntry }
    }
    assertFalse(entries.any { it.startsWith("models/") })
}

@Test
fun `computeHash changes when modelJson changes`() {
    val bytes1 = """{"parent":"item/generated"}""".toByteArray()
    val bytes2 = """{"parent":"block/cube_all"}""".toByteArray()
    fun mgr(modelBytes: ByteArray) = CustomItemsManager(listOf(object : CustomItemSource {
        override val namespace = "nexo"
        override fun isAvailable() = true
        override fun collectItems() = listOf(CustomItemEntry("nexo:coin", "Coin", "nexo/coin", modelBytes))
        override fun loadTexture(path: String) = "fake-png".toByteArray()
    }))
    val h1 = mgr(bytes1).computeHash()
    val h2 = mgr(bytes2).computeHash()
    assertTrue(h1.isNotEmpty() && h2.isNotEmpty() && h1 != h2)
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd plugin && ./gradlew test --tests "net.artisanmc.plugin.CustomItemsManagerTest" 2>&1 | tail -30
```

Expected: compilation errors (modelJson field doesn't exist yet).

- [ ] **Step 3: Add `modelJson` field to `CustomItemEntry`**

Replace the `CustomItemEntry` data class in `CustomItemSource.kt`:

```kotlin
data class CustomItemEntry(
    val id: String,           // e.g. "nexo:iron_coin"
    val label: String,
    val texturePath: String,  // e.g. "nexo/iron_coin" (no .png, relative to archive textures/)
    val modelJson: ByteArray? = null,  // raw model JSON bytes, null = flat item
) {
    fun category(): String = id.substringBefore(":")
}
```

- [ ] **Step 4: Update `CustomItemsManager.kt` — add models to buildBundle and hash**

Replace the entire `CustomItemsManager.kt` with:

```kotlin
package net.artisanmc.plugin.customitems

import com.fasterxml.jackson.databind.ObjectMapper
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.Base64
import java.util.zip.GZIPOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class CustomItemsManager(private val sources: List<CustomItemSource>) {

    private val jsonMapper = ObjectMapper()

    companion object {
        val PLACEHOLDER_PNG: ByteArray = java.util.Base64.getDecoder().decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg=="
        )
    }

    fun availableSources(): List<String> = sources.filter { it.isAvailable() }.map { it.namespace }

    fun rawItemCount(): Int =
        sources.filter { it.isAvailable() }.sumOf { runCatching { it.collectItems().size }.getOrDefault(0) }

    fun computeHash(): String {
        val triples = collectWithModels()
        if (triples.isEmpty()) return ""
        val digest = MessageDigest.getInstance("SHA-256")
        for ((id, textureBytes, modelJson) in triples.sortedBy { it.first }) {
            digest.update(id.toByteArray(Charsets.UTF_8))
            digest.update(textureBytes)
            if (modelJson != null) digest.update(modelJson)
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    fun buildBundle(): Pair<String, String>? {
        val items = mutableListOf<Map<String, String>>()
        val textures = mutableMapOf<String, ByteArray>()
        val models = mutableMapOf<String, ByteArray>()

        for (source in sources.filter { it.isAvailable() }) {
            for (entry in source.collectItems()) {
                val bytes = source.loadTexture(entry.texturePath) ?: PLACEHOLDER_PNG
                items += mapOf(
                    "id"       to entry.id,
                    "label"    to stripColorCodes(entry.label),
                    "category" to entry.category(),
                    "texture"  to entry.texturePath,
                )
                textures[entry.texturePath] = bytes
                entry.modelJson?.let { models[entry.texturePath] = it }
            }
        }
        if (items.isEmpty()) return null

        val digest = MessageDigest.getInstance("SHA-256")
        for (item in items.sortedBy { it["id"]!! }) {
            val texturePath = item["texture"]!!
            val texBytes = textures[texturePath] ?: continue
            digest.update(item["id"]!!.toByteArray(Charsets.UTF_8))
            digest.update(texBytes)
            models[texturePath]?.let { digest.update(it) }
        }
        val hash = digest.digest().joinToString("") { "%02x".format(it) }

        val data = buildData(items, textures, models)
        return Pair(hash, data)
    }

    internal fun stripColorCodes(s: String): String = s.replace(Regex("§[0-9a-fk-orA-FK-OR]"), "")

    private fun collectWithModels(): List<Triple<String, ByteArray, ByteArray?>> =
        sources.filter { it.isAvailable() }
            .flatMap { source ->
                source.collectItems().map { entry ->
                    Triple(entry.id, source.loadTexture(entry.texturePath) ?: PLACEHOLDER_PNG, entry.modelJson)
                }
            }

    private fun buildData(
        items: List<Map<String, String>>,
        textures: Map<String, ByteArray>,
        models: Map<String, ByteArray>,
    ): String {
        val zipBytes = ByteArrayOutputStream()
        ZipOutputStream(zipBytes).use { zip ->
            zip.putNextEntry(ZipEntry("items.json"))
            zip.write(jsonMapper.writeValueAsBytes(items))
            zip.closeEntry()
            for ((path, bytes) in textures) {
                zip.putNextEntry(ZipEntry("textures/$path.png"))
                zip.write(bytes)
                zip.closeEntry()
            }
            for ((path, bytes) in models) {
                zip.putNextEntry(ZipEntry("models/$path.json"))
                zip.write(bytes)
                zip.closeEntry()
            }
        }
        val gzipped = ByteArrayOutputStream()
        GZIPOutputStream(gzipped).use { gz -> gz.write(zipBytes.toByteArray()) }
        return Base64.getEncoder().encodeToString(gzipped.toByteArray())
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd plugin && ./gradlew test --tests "net.artisanmc.plugin.CustomItemsManagerTest" 2>&1 | tail -30
```

Expected: all tests pass (28 total).

- [ ] **Step 6: Run full plugin test suite**

```bash
cd plugin && ./gradlew test 2>&1 | tail -20
```

Expected: BUILD SUCCESSFUL, 28 tests.

- [ ] **Step 7: Commit**

```bash
cd plugin
rtk git add src/main/kotlin/net/artisanmc/plugin/customitems/CustomItemSource.kt
rtk git add src/main/kotlin/net/artisanmc/plugin/customitems/CustomItemsManager.kt
rtk git add src/test/kotlin/net/artisanmc/plugin/CustomItemsManagerTest.kt
rtk git commit -m "feat(plugin): extend custom items bundle with model JSONs"
```

---

## Task 2: NexoSource — extract model JSON

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/customitems/NexoSource.kt`

No new automated tests needed — NexoSource requires Bukkit runtime. The model JSON pipeline is already tested through the fakeSource tests in Task 1. Manual verification: Nexo items should show icons in the editor after completing all tasks.

- [ ] **Step 1: Add `loadModelJson` private method to `NexoSource`**

Add the following private method after `loadViaModel()`:

```kotlin
private fun loadModelJson(itemId: String): ByteArray? {
    for (zip in cachedZips) {
        runCatching {
            java.util.zip.ZipFile(zip).use { z ->
                z.entries().asSequence()
                    .firstOrNull { !it.isDirectory && it.name.endsWith("models/item/$itemId.json") }
                    ?.let { z.getInputStream(it).readBytes() }
            }
        }.getOrNull()?.let { return it }
    }
    return null
}
```

- [ ] **Step 2: Populate `modelJson` in `collectItems()`**

In `collectItems()`, change the line that creates `CustomItemEntry` from:

```kotlin
CustomItemEntry(id = "nexo:$id", label = displayName, texturePath = "nexo/$id")
```

to:

```kotlin
CustomItemEntry(
    id = "nexo:$id",
    label = displayName,
    texturePath = "nexo/$id",
    modelJson = loadModelJson(id),
)
```

Note: `loadModelJson` uses `cachedZips` which is already populated at the start of `collectItems()` before the items loop. The ordering is correct.

- [ ] **Step 3: Verify the plugin compiles**

```bash
cd plugin && ./gradlew classes 2>&1 | tail -10
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 4: Run plugin tests (no regressions)**

```bash
cd plugin && ./gradlew test 2>&1 | tail -10
```

Expected: 28 tests, BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
cd plugin
rtk git add src/main/kotlin/net/artisanmc/plugin/customitems/NexoSource.kt
rtk git commit -m "feat(plugin): NexoSource extracts model JSON from pack zip"
```

---

## Task 3: OraxenSource — extract model JSON

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/customitems/OraxenSource.kt`

- [ ] **Step 1: Add `loadModelJson` private method**

Add after `loadTexture()` in `OraxenSource`:

```kotlin
private fun loadModelJson(id: String): ByteArray? {
    val packDir = File(pluginsDir, "Oraxen/pack")
    val candidates = listOf(
        File(packDir, "assets/oraxen/models/item/$id.json"),
        File(packDir, "assets/oraxen/models/$id.json"),
    )
    return candidates.firstOrNull { it.exists() }?.readBytes()
}
```

- [ ] **Step 2: Populate `modelJson` in `collectItems()`**

Change the return inside `collectItems()` from:

```kotlin
entries.mapNotNull { (id, _) ->
    CustomItemEntry(id = "oraxen:$id", label = id, texturePath = "oraxen/$id")
}
```

to:

```kotlin
entries.mapNotNull { (id, _) ->
    CustomItemEntry(
        id = "oraxen:$id",
        label = id,
        texturePath = "oraxen/$id",
        modelJson = loadModelJson(id),
    )
}
```

- [ ] **Step 3: Verify and test**

```bash
cd plugin && ./gradlew test 2>&1 | tail -10
```

Expected: 28 tests, BUILD SUCCESSFUL.

- [ ] **Step 4: Commit**

```bash
cd plugin
rtk git add src/main/kotlin/net/artisanmc/plugin/customitems/OraxenSource.kt
rtk git commit -m "feat(plugin): OraxenSource extracts model JSON from pack directory"
```

---

## Task 4: ItemsAdderSource — extract model JSON

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/customitems/ItemsAdderSource.kt`

- [ ] **Step 1: Add `loadModelJson` private method**

Add after `loadTexture()` in `ItemsAdderSource`:

```kotlin
private fun loadModelJson(ns: String, name: String): ByteArray? {
    val packDir = File(pluginsDir, "ItemsAdder/data/resource_pack")
    val candidates = listOf(
        File(packDir, "assets/$ns/models/item/$name.json"),
        File(packDir, "assets/$ns/models/$name.json"),
    )
    return candidates.firstOrNull { it.exists() }?.readBytes()
}
```

- [ ] **Step 2: Populate `modelJson` in `collectItems()`**

Change the `CustomItemEntry` construction inside `collectItems()` from:

```kotlin
CustomItemEntry(
    id = "itemsadder:$id",
    label = name,
    texturePath = "itemsadder/$ns/$name",
)
```

to:

```kotlin
CustomItemEntry(
    id = "itemsadder:$id",
    label = name,
    texturePath = "itemsadder/$ns/$name",
    modelJson = loadModelJson(ns, name),
)
```

- [ ] **Step 3: Verify and test**

```bash
cd plugin && ./gradlew test 2>&1 | tail -10
```

Expected: 28 tests, BUILD SUCCESSFUL.

- [ ] **Step 4: Commit**

```bash
cd plugin
rtk git add src/main/kotlin/net/artisanmc/plugin/customitems/ItemsAdderSource.kt
rtk git commit -m "feat(plugin): ItemsAdderSource extracts model JSON from resource pack"
```

---

## Task 5: Backend — `customItemRenderer.ts` + tests

**Files:**
- Create: `backend/src/lib/customItemRenderer.ts`
- Create: `backend/src/lib/customItemRenderer.test.ts`

### Background on the rendering approach

The renderer mirrors `gen-items.ts:resolveItem()`. Given a custom item:
1. Read the model JSON from `cacheDir/models/{texture}.json` (e.g. `cacheDir/models/nexo/coin.json`)
2. Resolve parent chain from vanilla MC assets models (e.g. `item/generated`, `block/cube_all`)
3. Determine rendering strategy:
   - **`item/generated` or `item/handheld` ancestor, or no block ancestor**: flat — leave `texture` unchanged
   - **`CUBE_PARENTS` ancestor**: isometric cube via `renderIsometricIcon()`
   - **Has `block/` ancestor AND has `elements`**: element-based via `renderFromElements()`
4. For texture resolution in steps 3b/3c, try `cacheDir/textures/{namespace}/{last-path-component}.png` then `vanillaTexturesDir/{resolved-path}.png`
5. Write icon to `cacheDir/textures/icons/{texture-with-slash-to-double-underscore}.png`
   - e.g. `nexo/coin` → `cacheDir/textures/icons/nexo__coin.png`
6. Re-write `items.json` updating `texture` to `icons/nexo__coin`

The editor's `/api/textures/custom/{serverId}/{texture}.png` endpoint serves from `cacheDir/textures/`, so `icons/nexo__coin` → `cacheDir/textures/icons/nexo__coin.png` works without any endpoint changes.

- [ ] **Step 1: Write failing tests**

Create `backend/src/lib/customItemRenderer.test.ts`:

```ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { renderCustomIconsWithPaths } from "./customItemRenderer";

const TMP_CACHE = join(import.meta.dir, "../../data/custom-items/__renderer_test__");
const TMP_VANILLA = join(import.meta.dir, "../../data/custom-items/__vanilla_test__");

const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg==",
  "base64"
);

beforeEach(() => {
  mkdirSync(join(TMP_CACHE, "textures/nexo"), { recursive: true });
  mkdirSync(join(TMP_CACHE, "models/nexo"), { recursive: true });
  mkdirSync(join(TMP_VANILLA, "models/item"), { recursive: true });
  mkdirSync(join(TMP_VANILLA, "models/block"), { recursive: true });
  mkdirSync(join(TMP_VANILLA, "textures/block"), { recursive: true });
});
afterEach(() => {
  rmSync(TMP_CACHE, { recursive: true, force: true });
  rmSync(TMP_VANILLA, { recursive: true, force: true });
});

describe("renderCustomIconsWithPaths", () => {
  test("no-op when items.json missing", async () => {
    await renderCustomIconsWithPaths(TMP_CACHE, TMP_VANILLA); // must not throw
  });

  test("skips item with no model file — no icon created, texture unchanged", async () => {
    writeFileSync(
      join(TMP_CACHE, "items.json"),
      JSON.stringify([{ id: "nexo:coin", label: "Coin", category: "nexo", texture: "nexo/coin" }])
    );
    await renderCustomIconsWithPaths(TMP_CACHE, TMP_VANILLA);
    expect(existsSync(join(TMP_CACHE, "textures/icons/nexo__coin.png"))).toBe(false);
    const items = JSON.parse(readFileSync(join(TMP_CACHE, "items.json"), "utf-8"));
    expect(items[0].texture).toBe("nexo/coin");
  });

  test("flat item (item/generated parent) — no icon, texture unchanged", async () => {
    writeFileSync(
      join(TMP_VANILLA, "models/item/generated.json"),
      JSON.stringify({ display: {} })
    );
    writeFileSync(
      join(TMP_CACHE, "models/nexo/coin.json"),
      JSON.stringify({ parent: "item/generated", textures: { layer0: "nexo:item/coin" } })
    );
    writeFileSync(
      join(TMP_CACHE, "items.json"),
      JSON.stringify([{ id: "nexo:coin", label: "Coin", category: "nexo", texture: "nexo/coin" }])
    );

    await renderCustomIconsWithPaths(TMP_CACHE, TMP_VANILLA);

    expect(existsSync(join(TMP_CACHE, "textures/icons/nexo__coin.png"))).toBe(false);
    const items = JSON.parse(readFileSync(join(TMP_CACHE, "items.json"), "utf-8"));
    expect(items[0].texture).toBe("nexo/coin");
  });

  test("unknown custom parent chain — flat fallthrough, no crash", async () => {
    writeFileSync(
      join(TMP_CACHE, "models/nexo/widget.json"),
      JSON.stringify({ parent: "nexo:item/widget_base", textures: { layer0: "nexo:item/widget" } })
    );
    writeFileSync(
      join(TMP_CACHE, "items.json"),
      JSON.stringify([{ id: "nexo:widget", label: "Widget", category: "nexo", texture: "nexo/widget" }])
    );

    await renderCustomIconsWithPaths(TMP_CACHE, TMP_VANILLA); // must not throw
    expect(existsSync(join(TMP_CACHE, "textures/icons/nexo__widget.png"))).toBe(false);
  });

  test("cube block model — icon written, items.json texture updated", async () => {
    writeFileSync(
      join(TMP_VANILLA, "models/block/cube_all.json"),
      JSON.stringify({
        elements: [{
          from: [0, 0, 0], to: [16, 16, 16],
          faces: {
            up:    { texture: "#all", uv: [0, 0, 16, 16] },
            west:  { texture: "#all", uv: [0, 0, 16, 16] },
            south: { texture: "#all", uv: [0, 0, 16, 16] },
          },
        }],
      })
    );
    writeFileSync(join(TMP_VANILLA, "textures/block/stone.png"), PLACEHOLDER_PNG);
    writeFileSync(
      join(TMP_CACHE, "models/nexo/stone_block.json"),
      JSON.stringify({ parent: "block/cube_all", textures: { all: "block/stone" } })
    );
    // Primary texture stored under nexo namespace
    writeFileSync(join(TMP_CACHE, "textures/nexo/stone_block.png"), PLACEHOLDER_PNG);
    writeFileSync(
      join(TMP_CACHE, "items.json"),
      JSON.stringify([{ id: "nexo:stone_block", label: "Stone Block", category: "nexo", texture: "nexo/stone_block" }])
    );

    await renderCustomIconsWithPaths(TMP_CACHE, TMP_VANILLA);

    expect(existsSync(join(TMP_CACHE, "textures/icons/nexo__stone_block.png"))).toBe(true);
    const items = JSON.parse(readFileSync(join(TMP_CACHE, "items.json"), "utf-8"));
    expect(items[0].texture).toBe("icons/nexo__stone_block");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend && bun test src/lib/customItemRenderer.test.ts 2>&1 | tail -20
```

Expected: Error: Cannot find module `./customItemRenderer`.

- [ ] **Step 3: Create `backend/src/lib/customItemRenderer.ts`**

```ts
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { mkdir, writeFile, readFile } from "fs/promises";
import { PNG } from "pngjs";
import { assetsRoot } from "./mcAssets";
import { renderIsometricIcon, renderFromElements, type ModelElement } from "./iconRenderer";
import type { CustomItemEntry } from "./customItems";

const CUBE_PARENTS = new Set([
  "block/cube_all",
  "block/cube",
  "block/cube_column",
  "block/cube_column_horizontal",
  "block/cube_bottom_top",
  "block/cube_directional",
  "block/cube_mirrored_all",
  "block/cube_all_directional",
  "block/leaves",
  "block/template_glass",
  "block/template_glazed_terracotta",
  "item/template_shulker_box",
  "item/template_chest",
]);

type ModelJson = Record<string, unknown>;

function readModelJson(path: string): ModelJson | null {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { return null; }
}

function resolveVar(textures: Record<string, string>, key: string, depth = 0): string | null {
  if (depth > 8) return null;
  const v = textures[key];
  if (!v) return null;
  if (v.startsWith("#")) return resolveVar(textures, v.slice(1), depth + 1);
  return v.replace(/^minecraft:/, "");
}

function getCubeTextures(textures: Record<string, string>): { top: string; side: string } | null {
  const r = (key: string) => resolveVar(textures, key);
  const top = r("up") ?? r("top") ?? r("end") ?? r("all") ?? r("particle");
  const side = r("side") ?? r("north") ?? r("east") ?? r("west") ?? r("all") ?? r("particle") ?? top;
  if (!top || !side) return null;
  return { top, side };
}

type ResolvedParent = {
  textures: Record<string, string>;
  ancestors: Set<string>;
  elements: ModelElement[] | null;
};

/** Resolve a vanilla model's parent chain from the vanilla models directory. */
function resolveVanillaParent(
  modelPath: string,
  vanillaModelsDir: string,
  depth = 0,
): ResolvedParent {
  const empty: ResolvedParent = { textures: {}, ancestors: new Set([modelPath]), elements: null };
  if (depth > 8) return empty;
  const m = readModelJson(join(vanillaModelsDir, modelPath + ".json"));
  if (!m) return empty;

  let textures: Record<string, string> = {};
  let elements: ModelElement[] | null = null;
  const ancestors = new Set([modelPath]);

  if (m.textures && typeof m.textures === "object")
    textures = m.textures as Record<string, string>;
  if (Array.isArray(m.elements) && m.elements.length > 0)
    elements = m.elements as ModelElement[];

  if (typeof m.parent === "string") {
    const pp = m.parent.replace(/^minecraft:/, "");
    ancestors.add(pp);
    const pr = resolveVanillaParent(pp, vanillaModelsDir, depth + 1);
    for (const a of pr.ancestors) ancestors.add(a);
    textures = { ...pr.textures, ...textures };
    if (elements === null && pr.elements) elements = pr.elements;
  }
  return { textures, ancestors, elements };
}

function loadPng(path: string): PNG | null {
  if (!existsSync(path)) return null;
  try { return PNG.sync.read(readFileSync(path)); }
  catch { return null; }
}

/**
 * Build a texture map for rendering.
 * For each texture variable, tries:
 *   1. cacheDir/textures/{namespace}/{last-path-component}.png
 *   2. vanillaTexturesDir/{resolved-path}.png
 */
function buildTextureMap(
  textures: Record<string, string>,
  cacheTexturesDir: string,
  vanillaTexturesDir: string,
): Map<string, PNG> {
  const map = new Map<string, PNG>();
  for (const [key] of Object.entries(textures)) {
    const resolved = resolveVar(textures, key);
    if (!resolved) continue;
    // Strip namespace (e.g. "nexo:item/coin" → "item/coin", "block/stone" → "block/stone")
    const noNs = resolved.includes(":") ? resolved.split(":")[1]! : resolved;
    const lastComponent = noNs.split("/").pop()!;
    // Try custom cache: namespace of the resolved ref, last path component
    const nsPart = resolved.includes(":") ? resolved.split(":")[0]! : "";
    const customPath = nsPart
      ? join(cacheTexturesDir, nsPart, lastComponent + ".png")
      : join(cacheTexturesDir, lastComponent + ".png");
    const png = loadPng(customPath) ?? loadPng(join(vanillaTexturesDir, noNs + ".png"));
    if (png) map.set(key, png);
  }
  return map;
}

/** Exported for testing with custom vanilla root path. */
export async function renderCustomIconsWithPaths(
  cacheDir: string,
  vanillaRoot: string,
): Promise<void> {
  const itemsPath = join(cacheDir, "items.json");
  if (!existsSync(itemsPath)) return;

  const items: CustomItemEntry[] = JSON.parse(readFileSync(itemsPath, "utf8"));
  const vanillaModelsDir = join(vanillaRoot, "models");
  const vanillaTexturesDir = join(vanillaRoot, "textures");
  const cacheTexturesDir = join(cacheDir, "textures");
  const iconsDir = join(cacheDir, "textures", "icons");

  await mkdir(iconsDir, { recursive: true });

  let changed = false;
  for (const item of items) {
    const modelPath = join(cacheDir, "models", item.texture + ".json");
    if (!existsSync(modelPath)) continue;

    const modelJson = readModelJson(modelPath);
    if (!modelJson) continue;

    let textures: Record<string, string> =
      modelJson.textures && typeof modelJson.textures === "object"
        ? (modelJson.textures as Record<string, string>)
        : {};
    let elements: ModelElement[] | null =
      Array.isArray(modelJson.elements) && modelJson.elements.length > 0
        ? (modelJson.elements as ModelElement[])
        : null;
    const ancestors = new Set<string>();

    if (typeof modelJson.parent === "string") {
      // Strip any custom namespace prefix (e.g. "nexo:item/generated" → "item/generated")
      const parentPath = modelJson.parent.includes(":")
        ? modelJson.parent.split(":")[1]!
        : modelJson.parent;
      ancestors.add(parentPath);
      const pr = resolveVanillaParent(parentPath, vanillaModelsDir);
      for (const a of pr.ancestors) ancestors.add(a);
      textures = { ...pr.textures, ...textures };
      if (elements === null && pr.elements) elements = pr.elements;
    }

    const isBlockModel = [...ancestors].some(a => a.startsWith("block/"));
    if (!isBlockModel) continue; // flat item — leave texture as-is

    const iconName = item.texture.replace(/\//g, "__");
    const iconPath = join(iconsDir, iconName + ".png");
    let rendered = false;

    if (elements && elements.length > 0) {
      const textureMap = buildTextureMap(textures, cacheTexturesDir, vanillaTexturesDir);
      if (textureMap.size > 0) {
        try {
          const buf = renderFromElements(elements, textureMap);
          await writeFile(iconPath, buf);
          rendered = true;
        } catch { /* fall through */ }
      }
    }

    if (!rendered) {
      for (const a of ancestors) {
        if (!CUBE_PARENTS.has(a)) continue;
        const faces = getCubeTextures(textures);
        if (!faces) break;
        const topFile = join(vanillaTexturesDir, faces.top + ".png");
        const sideFile = join(vanillaTexturesDir, faces.side + ".png");
        const topPng = loadPng(topFile) ?? loadPng(join(cacheTexturesDir, faces.top.split("/").pop()! + ".png"));
        const sidePng = loadPng(sideFile) ?? loadPng(join(cacheTexturesDir, faces.side.split("/").pop()! + ".png"));
        if (topPng && sidePng) {
          const topTmp = join(iconsDir, "_top_tmp.png");
          const sideTmp = join(iconsDir, "_side_tmp.png");
          await writeFile(topTmp, PNG.sync.write(topPng));
          await writeFile(sideTmp, PNG.sync.write(sidePng));
          try {
            const buf = renderIsometricIcon(topTmp, sideTmp);
            await writeFile(iconPath, buf);
            rendered = true;
          } catch { /* fall through */ }
          // clean up tmp files
          try { (await import("fs")).unlinkSync(topTmp); } catch { /**/ }
          try { (await import("fs")).unlinkSync(sideTmp); } catch { /**/ }
        }
        break;
      }
    }

    if (rendered) {
      item.texture = `icons/${iconName}`;
      changed = true;
    }
  }

  if (changed) {
    await writeFile(itemsPath, JSON.stringify(items));
  }
}

/** Production entry point: resolves vanilla root from mcVersion. */
export async function renderCustomIcons(cacheDir: string, mcVersion: string): Promise<void> {
  return renderCustomIconsWithPaths(cacheDir, assetsRoot(mcVersion));
}
```

- [ ] **Step 4: Run the tests**

```bash
cd backend && bun test src/lib/customItemRenderer.test.ts 2>&1 | tail -30
```

Expected: All 5 tests pass.

- [ ] **Step 5: Run full backend test suite**

```bash
cd backend && bun test 2>&1 | tail -20
```

Expected: All tests pass (no regressions).

- [ ] **Step 6: Commit**

```bash
cd backend
rtk git add src/lib/customItemRenderer.ts src/lib/customItemRenderer.test.ts
rtk git commit -m "feat(backend): add custom item icon renderer pipeline"
```

---

## Task 6: Backend — `processBundle` models/ + hub integration

**Files:**
- Modify: `backend/src/lib/customItems.ts`
- Modify: `backend/src/ws/hub.ts`
- Modify: `backend/src/lib/customItems.test.ts`

- [ ] **Step 1: Write failing test for models/ extraction in processBundle**

Add to `backend/src/lib/customItems.test.ts` (inside the `processBundle` describe block):

```ts
test("extracts models/ entries alongside textures", async () => {
  const modelJson = JSON.stringify({ parent: "item/generated" });
  const items = [{ id: "nexo:coin", label: "Coin", category: "nexo", texture: "nexo/coin" }];
  const files: Record<string, Uint8Array> = {
    "items.json": new TextEncoder().encode(JSON.stringify(items)),
    "textures/nexo/coin.png": new TextEncoder().encode("fake-png"),
    "models/nexo/coin.json": new TextEncoder().encode(modelJson),
  };
  const data = Buffer.from(gzipSync(zipSync(files))).toString("base64");

  await processBundle(TMP, "hash-models", data);

  expect(existsSync(join(TMP, "models/nexo/coin.json"))).toBe(true);
  const written = new TextDecoder().decode(
    readFileSync(join(TMP, "models/nexo/coin.json"))
  );
  expect(written).toBe(modelJson);
});
```

You also need to add this import to the top of `customItems.test.ts`:

```ts
import { readFileSync } from "fs";
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd backend && bun test src/lib/customItems.test.ts 2>&1 | tail -20
```

Expected: Test fails — models/ entry not written (currently filtered out).

- [ ] **Step 3: Update `processBundle` to allow `models/` paths**

In `backend/src/lib/customItems.ts`, change line:

```ts
if (path !== "items.json" && !path.startsWith("textures/")) continue;
```

to:

```ts
if (path !== "items.json" && !path.startsWith("textures/") && !path.startsWith("models/")) continue;
```

- [ ] **Step 4: Run tests to confirm passing**

```bash
cd backend && bun test src/lib/customItems.test.ts 2>&1 | tail -20
```

Expected: All tests pass.

- [ ] **Step 5: Update `hub.ts` to call `renderCustomIcons` after processBundle**

In `backend/src/ws/hub.ts`, add import at the top (with other lib imports):

```ts
import { renderCustomIcons } from "../lib/customItemRenderer";
```

Then find the `custom_items_bundle` handler:

```ts
// ── custom_items_bundle: plugin sends compressed bundle ───────────────────
if (msg.type === "custom_items_bundle") {
  const serverId = connToServerId.get(connId);
  if (!serverId) return { reply: null };
  const bundle = msg as CustomItemsBundleMessage;
  const cacheDir = customItemsCacheDir(serverId);
  try {
    await processBundle(cacheDir, bundle.hash, bundle.data);
  } catch (err) {
    console.error(`[custom-items] Failed to process bundle for server ${serverId}:`, err);
  }
  return { reply: null };
}
```

Replace with:

```ts
// ── custom_items_bundle: plugin sends compressed bundle ───────────────────
if (msg.type === "custom_items_bundle") {
  const serverId = connToServerId.get(connId);
  if (!serverId) return { reply: null };
  const bundle = msg as CustomItemsBundleMessage;
  const cacheDir = customItemsCacheDir(serverId);
  try {
    await processBundle(cacheDir, bundle.hash, bundle.data);
    const mcVersion = await getMcVersion(serverId) ?? "1.21.4";
    await renderCustomIcons(cacheDir, mcVersion).catch((err) =>
      console.error(`[custom-items] Icon render failed for server ${serverId}:`, err)
    );
  } catch (err) {
    console.error(`[custom-items] Failed to process bundle for server ${serverId}:`, err);
  }
  return { reply: null };
}
```

- [ ] **Step 6: Run full backend test suite**

```bash
cd backend && bun test 2>&1 | tail -20
```

Expected: All tests pass. The hub test may need a check — if `getMcVersion` is called in the test, ensure it doesn't break. The call is wrapped in `catch()` so failures won't affect hub test behavior.

- [ ] **Step 7: Build the plugin JAR and verify compilation**

```bash
cd plugin && ./gradlew shadowJar 2>&1 | tail -10
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 8: Update CLAUDE.md test counts**

In `CLAUDE.md` (at repo root), update the Tests table to reflect the new test counts:
- Plugin unit count: 28 → **31** (3 new tests in CustomItemsManagerTest)
- Backend unit count: update to reflect new customItemRenderer tests (+5)

- [ ] **Step 9: Commit**

```bash
cd backend
rtk git add src/lib/customItems.ts src/lib/customItems.test.ts src/ws/hub.ts
rtk git commit -m "feat(backend): integrate icon renderer into custom items pipeline"
```

```bash
# Then from repo root
rtk git add CLAUDE.md
rtk git commit -m "docs: update test counts after custom items renderer"
```

---

## Self-Review

**Spec coverage:**
- Section 1 (Bundle protocol): Tasks 1–4 ✓
- Section 2 (Plugin sources): Tasks 2–4 ✓
- Section 3 (Backend renderer): Task 5 ✓
- Section 3 (Integration into processBundle): Task 6 ✓
- Section 4 (Editor — no changes): Confirmed no editor changes needed ✓
- Section 5 (Testing): Plugin tests in Task 1, backend tests in Tasks 5–6 ✓

**Placeholder scan:** No TBD/TODO/fill-in-details found.

**Type consistency:**
- `renderCustomIconsWithPaths(cacheDir, vanillaRoot)` — consistent across Task 5 definition and Task 5 test calls ✓
- `renderCustomIcons(cacheDir, mcVersion)` — consistent between Task 5 implementation and Task 6 hub import ✓
- `modelJson: ByteArray? = null` on `CustomItemEntry` — used consistently in Tasks 1–4 ✓
- `CustomItemEntry` is imported by both `customItems.ts` (backend) and Kotlin — the backend type already has `texture: string`, no change needed ✓

**Icon path**: Icons stored at `cacheDir/textures/icons/nexo__coin.png`. The existing `/api/textures/custom/{serverId}/{texture}` endpoint serves from `cacheDir/textures/`, so `icons/nexo__coin` → `cacheDir/textures/icons/nexo__coin.png` ✓ No endpoint changes needed.

**renderIsometricIcon workaround**: The `renderIsometricIcon` function takes file paths (not PNG objects). For the cube path in `renderCustomIconsWithPaths`, we write temp files then call it. This is slightly awkward but keeps compatibility with `iconRenderer.ts`'s interface unchanged. An alternative would be to add an overload to `iconRenderer.ts`, but that's out of scope.
