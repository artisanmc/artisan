# Custom Items Integration (Nexo / Oraxen / ItemsAdder) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to pick Nexo, Oraxen, and ItemsAdder items from the editor Library, with textures synced to the backend via a hash-based WS protocol and cached per server on disk.

**Architecture:** The plugin detects installed custom-item plugins at startup, builds a gzip-compressed ZIP bundle of item metadata and texture PNGs, and sends a hash in the `hello` message. The backend compares hashes; if different, it requests the full bundle, decompresses it, and writes it to `data/custom-items/{serverKeyId}/`. The editor fetches the cached list in parallel with vanilla items and merges them in the Library.

**Tech Stack:** Bun + Hono + fflate (backend), Kotlin 2 + OkHttp + java.util.zip (plugin), React 19 + Vitest (editor).

---

## File Map

**Create:**
- `backend/src/lib/customItems.ts` — bundle decode/write, cache read helpers
- `backend/src/lib/customItems.test.ts` — unit tests for bundle processing
- `plugin/src/main/kotlin/gg/interfaze/plugin/customitems/CustomItemSource.kt` — interface + data class
- `plugin/src/main/kotlin/gg/interfaze/plugin/customitems/CustomItemsManager.kt` — hash, bundle build, reload
- `plugin/src/main/kotlin/gg/interfaze/plugin/customitems/NexoSource.kt` — Nexo adapter
- `plugin/src/main/kotlin/gg/interfaze/plugin/customitems/OraxenSource.kt` — Oraxen adapter
- `plugin/src/main/kotlin/gg/interfaze/plugin/customitems/ItemsAdderSource.kt` — ItemsAdder adapter
- `plugin/src/test/kotlin/gg/interfaze/plugin/CustomItemsManagerTest.kt` — plugin unit tests

**Modify:**
- `backend/src/protocol.ts` — add 4 new WS message types, update HelloMessage
- `backend/src/ws/hub.ts` — handle `custom_items_changed`, `custom_items_bundle`; call hash check from `hello`
- `backend/src/routes/editorSession.ts` — add `GET /:token/custom-items` endpoint
- `backend/src/routes/textures.ts` — add `GET /custom/:serverKeyId/*` route
- `backend/src/routes/textures.test.ts` — add test for new custom route
- `plugin/src/main/kotlin/gg/interfaze/plugin/ws/WsClient.kt` — add `customItemsHash` param to hello
- `plugin/src/main/kotlin/gg/interfaze/plugin/provider/SyncedMenuProvider.kt` — wire CustomItemsManager, handle `custom_items_request`
- `plugin/build.gradle.kts` — add compileOnly deps for Nexo, Oraxen, ItemsAdder
- `editor/src/lib/packApi.ts` — add `fetchCustomItems`, `CustomItemsData`
- `editor/src/features/canvas/Library.tsx` — fetch custom items in parallel, merge, correct texture URL
- `editor/src/features/canvas/Library.test.tsx` — add custom items test

---

## Task 1: Backend — Protocol Types

**Files:**
- Modify: `backend/src/protocol.ts`

- [ ] **Step 1: Update `protocol.ts`**

Replace the existing `HelloMessage` interface and append the new types:

```typescript
export interface HelloMessage {
  type: "hello";
  server_key: string;
  plugin_version: string;
  minecraft_version: string;
  current_bundle_hash: string;
  local_pack_ids?: string[];
  custom_items_hash?: string;   // null/absent means no custom item plugin detected
}

// Plugin → backend: sent on hot-reload when custom items change
export interface CustomItemsChangedMessage {
  type: "custom_items_changed";
  hash: string;
}

// Backend → plugin: request the full bundle
export interface CustomItemsRequestMessage {
  type: "custom_items_request";
}

// Plugin → backend: compressed bundle payload
export interface CustomItemsBundleMessage {
  type: "custom_items_bundle";
  hash: string;
  data: string;  // base64(gzip(zip archive))
}
```

Also extend the union types at the bottom of the file:

```typescript
export type PluginToServerMessage =
  | HelloMessage
  | PongMessage
  | SetupRequestMessage
  | SetupClaimMessage
  | EditorSessionRequestMessage
  | EditorSessionRevokeMessage
  | EditorTrustRequestMessage
  | CustomItemsChangedMessage
  | CustomItemsBundleMessage;

export type ServerToPluginMessage =
  | HelloAckMessage
  | BundleAvailableMessage
  | DraftUpdateMessage
  | PingMessage
  | SetupCodeMessage
  | LinkConfirmedMessage
  | EditorSessionReadyMessage
  | CustomItemsRequestMessage;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd backend && rtk tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
rtk git add backend/src/protocol.ts
rtk git commit -m "feat(backend): add custom_items WS message types to protocol"
```

---

## Task 2: Backend — Custom Items Lib

**Files:**
- Create: `backend/src/lib/customItems.ts`
- Create: `backend/src/lib/customItems.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// backend/src/lib/customItems.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { zipSync, gzipSync } from "fflate";
import { processBundle, readCustomItems, readCustomItemsHash, customItemsCacheDir } from "./customItems";

const TMP = join(import.meta.dir, "../../data/custom-items/__test__");

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

function makeBundle(items: object[], textures: Record<string, string>): string {
  const files: Record<string, Uint8Array> = {
    "items.json": new TextEncoder().encode(JSON.stringify(items)),
  };
  for (const [path, content] of Object.entries(textures)) {
    files[`textures/${path}.png`] = new TextEncoder().encode(content);
  }
  const zipped = zipSync(files);
  const gzipped = gzipSync(zipped);
  return Buffer.from(gzipped).toString("base64");
}

describe("readCustomItemsHash", () => {
  test("returns empty string when no cache", async () => {
    expect(await readCustomItemsHash(TMP)).toBe("");
  });
});

describe("readCustomItems", () => {
  test("returns empty array when no cache", async () => {
    expect(await readCustomItems(TMP)).toEqual([]);
  });
});

describe("processBundle", () => {
  test("writes items.json and textures to the cache directory", async () => {
    const items = [{ id: "nexo:coin", label: "Coin", category: "nexo", texture: "nexo/coin" }];
    const data = makeBundle(items, { "nexo/coin": "fake-png-bytes" });

    await processBundle(TMP, "abc123", data);

    const writtenItems = await readCustomItems(TMP);
    expect(writtenItems).toEqual(items);
    expect(await readCustomItemsHash(TMP)).toBe("abc123");
    expect(existsSync(join(TMP, "textures/nexo/coin.png"))).toBe(true);
  });

  test("ignores paths outside items.json and textures/", async () => {
    const zip = zipSync({
      "items.json": new TextEncoder().encode("[]"),
      "../../evil.txt": new TextEncoder().encode("pwned"),
    });
    const data = Buffer.from(gzipSync(zip)).toString("base64");
    await processBundle(TMP, "safe", data);
    expect(existsSync(join(TMP, "../../evil.txt"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && bun test src/lib/customItems.test.ts
```

Expected: `Cannot find module './customItems'` or similar.

- [ ] **Step 3: Implement `customItems.ts`**

```typescript
// backend/src/lib/customItems.ts
import { join, dirname } from "path";
import { existsSync } from "fs";
import { mkdir, writeFile, readFile } from "fs/promises";
import { gunzipSync, unzipSync } from "fflate";

export interface CustomItemEntry {
  id: string;
  label: string;
  category: string;
  texture: string;
}

export function customItemsCacheDir(serverKeyId: string): string {
  const DATA_DIR = join(import.meta.dir, "../../data");
  return join(DATA_DIR, "custom-items", serverKeyId);
}

export async function readCustomItemsHash(cacheDir: string): Promise<string> {
  try {
    return (await readFile(join(cacheDir, "hash.txt"), "utf-8")).trim();
  } catch { return ""; }
}

export async function readCustomItems(cacheDir: string): Promise<CustomItemEntry[]> {
  try {
    const raw = await readFile(join(cacheDir, "items.json"), "utf-8");
    return JSON.parse(raw) as CustomItemEntry[];
  } catch { return []; }
}

export async function processBundle(cacheDir: string, hash: string, data: string): Promise<void> {
  const gzipped = Buffer.from(data, "base64");
  const zipped = gunzipSync(gzipped);
  const files = unzipSync(zipped);

  const writes: Promise<void>[] = [];
  for (const [path, bytes] of Object.entries(files)) {
    if (path !== "items.json" && !path.startsWith("textures/")) continue;
    const fullPath = join(cacheDir, path);
    writes.push(
      mkdir(dirname(fullPath), { recursive: true }).then(() => writeFile(fullPath, bytes)),
    );
  }
  await Promise.all(writes);
  await writeFile(join(cacheDir, "hash.txt"), hash);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && bun test src/lib/customItems.test.ts
```

Expected:
```
✓ readCustomItemsHash > returns empty string when no cache
✓ readCustomItems > returns empty array when no cache
✓ processBundle > writes items.json and textures to the cache directory
✓ processBundle > ignores paths outside items.json and textures/
```

- [ ] **Step 5: Commit**

```bash
rtk git add backend/src/lib/customItems.ts backend/src/lib/customItems.test.ts
rtk git commit -m "feat(backend): custom items cache lib with bundle processing"
```

---

## Task 3: Backend — Hub WS Handlers

**Files:**
- Modify: `backend/src/ws/hub.ts`
- Modify: `backend/src/routes/editorSession.test.ts` (add hub message tests)

- [ ] **Step 1: Write failing tests**

Add at the end of `backend/src/routes/editorSession.test.ts`:

```typescript
import { handlePluginMessage, connSenders, connToServerId } from "../ws/hub";
// (connToServerId is not exported yet — add export in step 3)

describe("custom_items_changed", () => {
  test("sends custom_items_request when hash differs from cache", async () => {
    // Arrange: register an authenticated plugin connection
    const connId = "conn_ci_test_" + crypto.randomUUID().slice(0, 8);
    const sent: string[] = [];
    connSenders.set(connId, (msg) => sent.push(msg));

    // Authenticate via hello
    const keyId = crypto.randomUUID();
    const hash = crypto.randomUUID().replace(/-/g, "");
    await db.insert(serverKeys).values({ id: keyId, hash, createdAt: new Date() });
    const rawKey = "rawkey_ci_" + keyId.slice(0, 8);
    const keyHash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey)))
    ).map(b => b.toString(16).padStart(2, "0")).join("");
    await db.update(serverKeys).set({ hash: keyHash }).where(eq(serverKeys.id, keyId));

    await handlePluginMessage(connId, JSON.stringify({
      type: "hello",
      server_key: rawKey,
      plugin_version: "1.0.0",
      minecraft_version: "1.21.4",
      current_bundle_hash: "",
      custom_items_hash: "nexo_hash_abc",
    }));

    sent.length = 0; // clear hello_ack

    // Act: send custom_items_changed with a different hash
    await handlePluginMessage(connId, JSON.stringify({
      type: "custom_items_changed",
      hash: "nexo_hash_xyz",
    }));

    // Assert: backend requested the bundle
    expect(sent.some((s) => JSON.parse(s).type === "custom_items_request")).toBe(true);

    connSenders.delete(connId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && bun test src/routes/editorSession.test.ts --grep "custom_items_changed"
```

Expected: test fails (no handler yet).

- [ ] **Step 3: Add hub handlers**

Add these imports at the top of `backend/src/ws/hub.ts`:

```typescript
import { customItemsCacheDir, readCustomItemsHash, processBundle } from "../lib/customItems";
import type { CustomItemsChangedMessage, CustomItemsBundleMessage, CustomItemsRequestMessage } from "../protocol";
```

Export `connToServerId` (add `export` keyword to the existing declaration):

```typescript
export const connToServerId = new Map<string, string>();
```

Add the `handleCustomItemsHash` helper function after the existing helpers (before `handlePluginMessage`):

```typescript
async function handleCustomItemsHash(serverKeyId: string, incomingHash: string | undefined): Promise<void> {
  if (!incomingHash) return;
  const cacheDir = customItemsCacheDir(serverKeyId);
  const cachedHash = await readCustomItemsHash(cacheDir);
  if (incomingHash === cachedHash) return;
  const request = JSON.stringify({ type: "custom_items_request" } satisfies CustomItemsRequestMessage);
  for (const [cId, sId] of connToServerId) {
    if (sId !== serverKeyId) continue;
    connSenders.get(cId)?.(request);
  }
}
```

In the `hello` handler, after `serverIdToMcVersion.set(keyId, hello.minecraft_version)`, add:

```typescript
handleCustomItemsHash(keyId, (hello as HelloMessage & { custom_items_hash?: string }).custom_items_hash).catch(() => {});
```

Add the two new message handlers inside `handlePluginMessage`, before the final `return { reply: null }`:

```typescript
// ── custom_items_changed: plugin hot-reload triggered a hash change ───────
if (msg.type === "custom_items_changed") {
  const serverId = connToServerId.get(connId);
  if (!serverId) return { reply: null };
  const changed = msg as CustomItemsChangedMessage;
  await handleCustomItemsHash(serverId, changed.hash);
  return { reply: null };
}

// ── custom_items_bundle: plugin sends compressed bundle ───────────────────
if (msg.type === "custom_items_bundle") {
  const serverId = connToServerId.get(connId);
  if (!serverId) return { reply: null };
  const bundle = msg as CustomItemsBundleMessage;
  const cacheDir = customItemsCacheDir(serverId);
  await processBundle(cacheDir, bundle.hash, bundle.data);
  return { reply: null };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && bun test src/routes/editorSession.test.ts --grep "custom_items"
```

Expected: test passes.

- [ ] **Step 5: Run full backend test suite**

```bash
cd backend && bun test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
rtk git add backend/src/ws/hub.ts backend/src/routes/editorSession.test.ts
rtk git commit -m "feat(backend): handle custom_items_changed and custom_items_bundle WS messages"
```

---

## Task 4: Backend — REST Endpoints

**Files:**
- Modify: `backend/src/routes/editorSession.ts`
- Modify: `backend/src/routes/textures.ts`
- Modify: `backend/src/routes/textures.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `backend/src/routes/textures.test.ts`:

```typescript
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

describe("GET /api/textures/custom/:serverKeyId/*", () => {
  const TEST_SERVER_ID = "srv_tex_test_" + Date.now();
  const cacheDir = join(import.meta.dir, "../../data/custom-items", TEST_SERVER_ID, "textures");

  beforeEach(() => {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, "nexo", "coin.png").replace(/\/nexo\//, "/"), "PNG");
    mkdirSync(join(cacheDir, "nexo"), { recursive: true });
    writeFileSync(join(cacheDir, "nexo/coin.png"), Buffer.from([137, 80, 78, 71])); // PNG header
  });

  afterEach(() => {
    rmSync(join(import.meta.dir, "../../data/custom-items", TEST_SERVER_ID), { recursive: true, force: true });
  });

  test("serves cached PNG by serverKeyId and path", async () => {
    const res = await app.request(`/api/textures/custom/${TEST_SERVER_ID}/nexo/coin`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
  });

  test("returns 404 for missing texture", async () => {
    const res = await app.request(`/api/textures/custom/${TEST_SERVER_ID}/nexo/doesnt_exist`);
    expect(res.status).toBe(404);
  });
});
```

For the custom-items endpoint, add to `backend/src/routes/editorSession.test.ts`:

```typescript
describe("GET /:token/custom-items", () => {
  test("returns empty items array when no cache exists", async () => {
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "ci_ep_" + keyId.slice(0, 8), createdAt: new Date() });
    const token = generateEditorToken();
    await db.insert(editorSessions).values({
      token, serverKeyId: keyId, createdBy: "CONSOLE",
      createdAt: new Date(), expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    // Exchange for access token
    await app.request(`/api/editor-session/${token}/exchange`, { method: "POST" });
    const exchangeRes = await app.request(`/api/editor-session/${token}/exchange`, { method: "POST" });
    const { access_token } = await exchangeRes.json() as { access_token: string };

    const res = await app.request(`/api/editor-session/${access_token}/custom-items`);
    expect(res.status).toBe(200);
    const body = await res.json() as { serverKeyId: string; items: unknown[] };
    expect(body.serverKeyId).toBe(keyId);
    expect(body.items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && bun test --grep "custom-items|custom/:serverKeyId"
```

Expected: both tests fail (routes don't exist).

- [ ] **Step 3: Add the custom texture route to `textures.ts`**

Add before the existing `router.get("/:version/*", ...)` route:

```typescript
import { existsSync } from "fs";
import { join } from "path";
import { customItemsCacheDir } from "../lib/customItems";

router.get("/custom/:serverKeyId/*", async (c) => {
  const serverKeyId = c.req.param("serverKeyId");
  const fullPath = c.req.path;
  const prefix = `/custom/${serverKeyId}/`;
  const rest = fullPath.includes(prefix) ? fullPath.split(prefix)[1] : "";
  if (!rest) return c.newResponse(null, 404);

  const filePath = join(customItemsCacheDir(serverKeyId), "textures", rest + ".png");
  if (!existsSync(filePath)) return c.newResponse(null, 404);

  return new Response(Bun.file(filePath), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
  });
});
```

- [ ] **Step 4: Add the `custom-items` endpoint to `editorSession.ts`**

Add this route after the existing `/:token/items` route, before the closing `export`:

```typescript
import { customItemsCacheDir, readCustomItems } from "../lib/customItems";

router.get("/:token/custom-items", async (c) => {
  const token = c.req.param("token");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const cacheDir = customItemsCacheDir(session.serverKeyId);
  const items = await readCustomItems(cacheDir);
  return c.json({ serverKeyId: session.serverKeyId, items });
});
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && bun test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
rtk git add backend/src/routes/textures.ts backend/src/routes/textures.test.ts backend/src/routes/editorSession.ts backend/src/routes/editorSession.test.ts
rtk git commit -m "feat(backend): add /custom-items and /textures/custom REST endpoints"
```

---

## Task 5: Plugin — CustomItemSource Interface + CustomItemsManager Core

**Files:**
- Create: `plugin/src/main/kotlin/gg/interfaze/plugin/customitems/CustomItemSource.kt`
- Create: `plugin/src/main/kotlin/gg/interfaze/plugin/customitems/CustomItemsManager.kt`
- Create: `plugin/src/test/kotlin/gg/interfaze/plugin/CustomItemsManagerTest.kt`

- [ ] **Step 1: Write failing tests**

```kotlin
// plugin/src/test/kotlin/gg/interfaze/plugin/CustomItemsManagerTest.kt
package gg.interfaze.plugin

import gg.interfaze.plugin.customitems.CustomItemEntry
import gg.interfaze.plugin.customitems.CustomItemSource
import gg.interfaze.plugin.customitems.CustomItemsManager
import java.util.zip.GZIPInputStream
import java.util.zip.ZipInputStream
import java.io.ByteArrayInputStream
import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class CustomItemsManagerTest {

    private fun fakeSource(namespace: String, items: List<Pair<String, String>>): CustomItemSource =
        object : CustomItemSource {
            override val namespace = namespace
            override fun isAvailable() = true
            override fun collectItems() = items.map { (id, label) ->
                CustomItemEntry(id = "$namespace:$id", label = label, texturePath = "$namespace/$id")
            }
            override fun loadTexture(path: String) = "fake-png-$path".toByteArray()
        }

    private fun unavailableSource(): CustomItemSource =
        object : CustomItemSource {
            override val namespace = "missing"
            override fun isAvailable() = false
            override fun collectItems() = error("should not be called")
            override fun loadTexture(path: String) = null
        }

    @Test
    fun `computeHash returns empty string when no sources available`() {
        val mgr = CustomItemsManager(listOf(unavailableSource()))
        assertEquals("", mgr.computeHash())
    }

    @Test
    fun `computeHash returns empty string when sources are empty`() {
        val mgr = CustomItemsManager(listOf(fakeSource("nexo", emptyList())))
        assertEquals("", mgr.computeHash())
    }

    @Test
    fun `computeHash is stable for same items`() {
        val mgr = CustomItemsManager(listOf(fakeSource("nexo", listOf("coin" to "Coin", "gem" to "Gem"))))
        assertEquals(mgr.computeHash(), mgr.computeHash())
    }

    @Test
    fun `computeHash changes when item set changes`() {
        val mgr1 = CustomItemsManager(listOf(fakeSource("nexo", listOf("coin" to "Coin"))))
        val mgr2 = CustomItemsManager(listOf(fakeSource("nexo", listOf("gem" to "Gem"))))
        val h1 = mgr1.computeHash()
        val h2 = mgr2.computeHash()
        assertTrue(h1.isNotEmpty() && h2.isNotEmpty() && h1 != h2)
    }

    @Test
    fun `buildBundle returns null when no items available`() {
        val mgr = CustomItemsManager(listOf(unavailableSource()))
        assertEquals(null, mgr.buildBundle())
    }

    @Test
    fun `buildBundle returns valid base64 gzip zip with items json and textures`() {
        val mgr = CustomItemsManager(listOf(fakeSource("nexo", listOf("coin" to "Iron Coin"))))
        val result = assertNotNull(mgr.buildBundle())
        val (_, data) = result

        // Decode base64 → gunzip → zip entries
        val decoded = Base64.getDecoder().decode(data)
        val entries = mutableSetOf<String>()
        ZipInputStream(GZIPInputStream(ByteArrayInputStream(decoded))).use { zip ->
            var entry = zip.nextEntry
            while (entry != null) {
                entries += entry.name
                entry = zip.nextEntry
            }
        }
        assertTrue("items.json" in entries)
        assertTrue("textures/nexo/coin.png" in entries)
    }

    @Test
    fun `stripColorCodes removes section-sign sequences`() {
        val mgr = CustomItemsManager(emptyList())
        assertEquals("Iron Coin", mgr.stripColorCodes("§6Iron §rCoin"))
    }

    @Test
    fun `items with null texture are skipped`() {
        val sourceWithMissing = object : CustomItemSource {
            override val namespace = "nexo"
            override fun isAvailable() = true
            override fun collectItems() = listOf(
                CustomItemEntry("nexo:coin", "Coin", "nexo/coin"),
                CustomItemEntry("nexo:missing", "Missing", "nexo/missing"),
            )
            override fun loadTexture(path: String) = if (path == "nexo/coin") "png".toByteArray() else null
        }
        val mgr = CustomItemsManager(listOf(sourceWithMissing))
        val (_, data) = assertNotNull(mgr.buildBundle())

        val decoded = Base64.getDecoder().decode(data)
        val entries = mutableSetOf<String>()
        ZipInputStream(GZIPInputStream(ByteArrayInputStream(decoded))).use { zip ->
            var entry = zip.nextEntry
            while (entry != null) {
                entries += entry.name
                entry = zip.nextEntry
            }
        }
        assertTrue("textures/nexo/coin.png" in entries)
        assertTrue("textures/nexo/missing.png" !in entries)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd plugin && ./gradlew test --tests "gg.interfaze.plugin.CustomItemsManagerTest"
```

Expected: compilation failure (classes don't exist yet).

- [ ] **Step 3: Create `CustomItemSource.kt`**

```kotlin
// plugin/src/main/kotlin/gg/interfaze/plugin/customitems/CustomItemSource.kt
package gg.interfaze.plugin.customitems

interface CustomItemSource {
    val namespace: String
    fun isAvailable(): Boolean
    fun collectItems(): List<CustomItemEntry>
    fun loadTexture(texturePath: String): ByteArray?
}

data class CustomItemEntry(
    val id: String,           // e.g. "nexo:iron_coin"
    val label: String,
    val texturePath: String,  // e.g. "nexo/iron_coin" (no .png, relative to archive textures/)
) {
    fun category(): String = id.substringBefore(":")
}
```

- [ ] **Step 4: Create `CustomItemsManager.kt`**

```kotlin
// plugin/src/main/kotlin/gg/interfaze/plugin/customitems/CustomItemsManager.kt
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

    fun computeHash(): String {
        val pairs = collectWithTextures()
        if (pairs.isEmpty()) return ""
        val digest = MessageDigest.getInstance("SHA-256")
        for ((id, bytes) in pairs.sortedBy { it.first }) {
            digest.update(id.toByteArray(Charsets.UTF_8))
            digest.update(bytes)
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    fun buildBundle(): Pair<String, String>? {
        val items = mutableListOf<Map<String, String>>()
        val textures = mutableMapOf<String, ByteArray>()

        for (source in sources.filter { it.isAvailable() }) {
            for (entry in source.collectItems()) {
                val bytes = source.loadTexture(entry.texturePath) ?: continue
                items += mapOf(
                    "id"       to entry.id,
                    "label"    to stripColorCodes(entry.label),
                    "category" to entry.category(),
                    "texture"  to entry.texturePath,
                )
                textures[entry.texturePath] = bytes
            }
        }
        if (items.isEmpty()) return null

        val hash = computeHash()
        val data = buildData(items, textures)
        return Pair(hash, data)
    }

    fun stripColorCodes(s: String): String = s.replace(Regex("§[0-9a-fk-orA-FK-OR]"), "")

    private fun collectWithTextures(): List<Pair<String, ByteArray>> =
        sources.filter { it.isAvailable() }
            .flatMap { source ->
                source.collectItems().mapNotNull { entry ->
                    val bytes = source.loadTexture(entry.texturePath) ?: return@mapNotNull null
                    Pair(entry.id, bytes)
                }
            }

    private fun buildData(items: List<Map<String, String>>, textures: Map<String, ByteArray>): String {
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
        }
        val gzipped = ByteArrayOutputStream()
        GZIPOutputStream(gzipped).use { gz -> gz.write(zipBytes.toByteArray()) }
        return Base64.getEncoder().encodeToString(gzipped.toByteArray())
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd plugin && ./gradlew test --tests "gg.interfaze.plugin.CustomItemsManagerTest"
```

Expected: all 8 tests pass.

- [ ] **Step 6: Commit**

```bash
rtk git add plugin/src/main/kotlin/gg/interfaze/plugin/customitems/ plugin/src/test/kotlin/gg/interfaze/plugin/CustomItemsManagerTest.kt
rtk git commit -m "feat(plugin): CustomItemSource interface and CustomItemsManager core"
```

---

## Task 6: Plugin — WsClient + SyncedMenuProvider Wiring

**Files:**
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/ws/WsClient.kt`
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/provider/SyncedMenuProvider.kt`
- Modify: `plugin/src/main/resources/plugin.yml`

- [ ] **Step 1: Update `WsClient.kt` to include `customItemsHash` in hello**

Add `customItemsHash: String = ""` as a constructor parameter after `localPackIds`:

```kotlin
class WsClient(
    private val url: String,
    private val serverKey: String,
    private val mcVersion: String,
    private val currentBundleHash: String = "",
    private val localPackIds: List<String> = emptyList(),
    private val customItemsHash: String = "",
    private val onMessage: (String) -> Unit,
    private val logger: Logger? = null,
)
```

In `Listener.onOpen`, add the new field to the hello map:

```kotlin
val hello = mapOf(
    "type"                to "hello",
    "server_key"          to serverKey,
    "plugin_version"      to "1.0.0",
    "minecraft_version"   to mcVersion,
    "current_bundle_hash" to currentBundleHash,
    "local_pack_ids"      to localPackIds,
    "custom_items_hash"   to customItemsHash.ifEmpty { null },
)
```

- [ ] **Step 2: Wire `CustomItemsManager` into `SyncedMenuProvider`**

Add import at the top of `SyncedMenuProvider.kt`:

```kotlin
import gg.interfaze.plugin.customitems.CustomItemsManager
```

Add a field and initialize it in the class body (after the existing `@Volatile private var` fields):

```kotlin
@Volatile private var customItemsManager: CustomItemsManager = CustomItemsManager(emptyList())
```

In the `load()` method, replace the existing `WsClient(...)` constructor call to add the `customItemsHash` parameter:

```kotlin
val customHash = customItemsManager.computeHash()
val client = WsClient(
    url               = wsUrl,
    serverKey         = serverKey,
    mcVersion         = mcVersion,
    currentBundleHash = currentHash,
    localPackIds      = bundles.map { it.packId },
    customItemsHash   = customHash,
    onMessage         = ::handleMessage,
    logger            = logger,
)
```

Add `custom_items_request` handling inside `handleMessage`'s `when` block:

```kotlin
"custom_items_request" -> {
    httpClient.dispatcher.executorService.execute {
        val result = customItemsManager.buildBundle()
        if (result != null) {
            val (hash, data) = result
            wsClient?.send(mapOf(
                "type" to "custom_items_bundle",
                "hash" to hash,
                "data" to data,
            ))
        }
    }
}
```

Add a public method for hot-reload notification (used by adapters in Tasks 7–9):

```kotlin
fun notifyCustomItemsReload() {
    val newHash = customItemsManager.computeHash()
    if (newHash.isNotEmpty()) {
        wsClient?.send(mapOf("type" to "custom_items_changed", "hash" to newHash))
    }
}
```

Also add a method to replace the manager (used during plugin initialization):

```kotlin
fun setCustomItemsManager(manager: CustomItemsManager) {
    customItemsManager = manager
}
```

- [ ] **Step 3: Update `plugin.yml` soft-depends**

In `plugin/src/main/resources/plugin.yml`, add or update the `softdepend` field:

```yaml
softdepend: [Vault, PlaceholderAPI, WorldGuard, Nexo, Oraxen, ItemsAdder]
```

- [ ] **Step 4: Run plugin tests**

```bash
cd plugin && ./gradlew test
```

Expected: all existing tests still pass.

- [ ] **Step 5: Commit**

```bash
rtk git add plugin/src/main/kotlin/gg/interfaze/plugin/ws/WsClient.kt plugin/src/main/kotlin/gg/interfaze/plugin/provider/SyncedMenuProvider.kt plugin/src/main/resources/plugin.yml
rtk git commit -m "feat(plugin): wire CustomItemsManager into SyncedMenuProvider and WsClient hello"
```

---

## Task 7: Plugin — NexoSource Adapter

Nexo is a custom-item plugin available at `https://repo.nexomc.com/releases/`.

**Files:**
- Modify: `plugin/build.gradle.kts`
- Create: `plugin/src/main/kotlin/gg/interfaze/plugin/customitems/NexoSource.kt`
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/InterfazePlugin.kt`

- [ ] **Step 1: Add Nexo compileOnly dependency**

In `plugin/build.gradle.kts`, add to `repositories`:

```kotlin
maven("https://repo.nexomc.com/releases/")
```

Add to `dependencies`:

```kotlin
compileOnly("com.nexomc:nexo:0.9.0")  // verify latest version at repo.nexomc.com
```

- [ ] **Step 2: Write a failing test for `isAvailable()` when Nexo is absent**

Add to `CustomItemsManagerTest.kt`:

```kotlin
@Test
fun `NexoSource isAvailable returns false when plugin not on classpath`() {
    val source = gg.interfaze.plugin.customitems.NexoSource(java.io.File("/nonexistent"))
    assertFalse(source.isAvailable())
}
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd plugin && ./gradlew test --tests "gg.interfaze.plugin.CustomItemsManagerTest.NexoSource*"
```

Expected: compilation error — `NexoSource` doesn't exist yet.

- [ ] **Step 4: Create `NexoSource.kt`**

```kotlin
// plugin/src/main/kotlin/gg/interfaze/plugin/customitems/NexoSource.kt
package gg.interfaze.plugin.customitems

import org.bukkit.Bukkit
import java.io.File

class NexoSource(private val pluginsDir: File) : CustomItemSource {
    override val namespace = "nexo"

    override fun isAvailable(): Boolean =
        Bukkit.getPluginManager().getPlugin("Nexo") != null

    override fun collectItems(): List<CustomItemEntry> {
        if (!isAvailable()) return emptyList()
        return try {
            val nexoItems = Class.forName("com.nexomc.nexo.api.NexoItems")
            @Suppress("UNCHECKED_CAST")
            val names = nexoItems.getMethod("itemNames").invoke(null) as Collection<String>
            names.mapNotNull { id ->
                val itemObj = nexoItems.getMethod("itemFromId", String::class.java).invoke(null, id)
                    ?: return@mapNotNull null
                val displayName = try {
                    val stack = itemObj.javaClass.getMethod("itemStack").invoke(itemObj)
                    val meta = (stack as org.bukkit.inventory.ItemStack).itemMeta
                    meta?.displayName()?.let { net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer.plainText().serialize(it) }
                        ?: id
                } catch (_: Exception) { id }
                CustomItemEntry(id = "nexo:$id", label = displayName, texturePath = "nexo/$id")
            }
        } catch (_: Exception) { emptyList() }
    }

    override fun loadTexture(texturePath: String): ByteArray? {
        val id = texturePath.removePrefix("nexo/")
        // Nexo generates resource pack at plugins/Nexo/pack/
        // Textures follow: assets/nexo/textures/item/{id}.png
        val packDir = File(pluginsDir, "Nexo/pack")
        val candidates = listOf(
            File(packDir, "assets/nexo/textures/item/$id.png"),
            File(packDir, "assets/nexo/textures/$id.png"),
        )
        return candidates.firstOrNull { it.exists() }?.readBytes()
    }
}
```

- [ ] **Step 5: Register `NexoSource` in `InterfazePlugin.onEnable()`**

In `InterfazePlugin.kt`, after `menuProvider.load()`:

```kotlin
val pluginsDir = server.pluginsFolder
val customItemsManager = gg.interfaze.plugin.customitems.CustomItemsManager(
    listOf(gg.interfaze.plugin.customitems.NexoSource(pluginsDir))
)
(menuProvider as? gg.interfaze.plugin.provider.SyncedMenuProvider)?.setCustomItemsManager(customItemsManager)
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd plugin && ./gradlew test --tests "gg.interfaze.plugin.CustomItemsManagerTest"
```

Expected: all tests pass (including the `NexoSource.isAvailable` test which returns false in the test JVM where Nexo's plugin manager is mocked via MockBukkit).

- [ ] **Step 7: Commit**

```bash
rtk git add plugin/build.gradle.kts plugin/src/main/kotlin/gg/interfaze/plugin/customitems/NexoSource.kt plugin/src/main/kotlin/gg/interfaze/plugin/InterfazePlugin.kt plugin/src/test/kotlin/gg/interfaze/plugin/CustomItemsManagerTest.kt
rtk git commit -m "feat(plugin): NexoSource adapter for custom items integration"
```

---

## Task 8: Plugin — OraxenSource Adapter

**Files:**
- Modify: `plugin/build.gradle.kts`
- Create: `plugin/src/main/kotlin/gg/interfaze/plugin/customitems/OraxenSource.kt`
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/InterfazePlugin.kt`

- [ ] **Step 1: Add Oraxen compileOnly dependency**

In `plugin/build.gradle.kts`, add to `repositories`:

```kotlin
maven("https://repo.oraxen.com/releases/")
```

Add to `dependencies`:

```kotlin
compileOnly("io.th0rgal:oraxen:1.189.0")  // verify latest at repo.oraxen.com
```

- [ ] **Step 2: Write a failing test**

Add to `CustomItemsManagerTest.kt`:

```kotlin
@Test
fun `OraxenSource isAvailable returns false when plugin not installed`() {
    val source = gg.interfaze.plugin.customitems.OraxenSource(java.io.File("/nonexistent"))
    assertFalse(source.isAvailable())
}
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd plugin && ./gradlew test --tests "*OraxenSource*"
```

Expected: compilation error.

- [ ] **Step 4: Create `OraxenSource.kt`**

```kotlin
// plugin/src/main/kotlin/gg/interfaze/plugin/customitems/OraxenSource.kt
package gg.interfaze.plugin.customitems

import org.bukkit.Bukkit
import java.io.File

class OraxenSource(private val pluginsDir: File) : CustomItemSource {
    override val namespace = "oraxen"

    override fun isAvailable(): Boolean =
        Bukkit.getPluginManager().getPlugin("Oraxen") != null

    override fun collectItems(): List<CustomItemEntry> {
        if (!isAvailable()) return emptyList()
        return try {
            val oraxenItems = Class.forName("io.th0rgal.oraxen.api.OraxenItems")
            @Suppress("UNCHECKED_CAST")
            val entries = oraxenItems.getMethod("getEntries").invoke(null) as Set<Map.Entry<String, *>>
            entries.mapNotNull { (id, _) ->
                CustomItemEntry(id = "oraxen:$id", label = id, texturePath = "oraxen/$id")
            }
        } catch (_: Exception) { emptyList() }
    }

    override fun loadTexture(texturePath: String): ByteArray? {
        val id = texturePath.removePrefix("oraxen/")
        val packDir = File(pluginsDir, "Oraxen/pack")
        val candidates = listOf(
            File(packDir, "assets/oraxen/textures/item/$id.png"),
            File(packDir, "assets/oraxen/textures/$id.png"),
        )
        return candidates.firstOrNull { it.exists() }?.readBytes()
    }
}
```

- [ ] **Step 5: Add `OraxenSource` to the manager in `InterfazePlugin.kt`**

Replace the `CustomItemsManager` instantiation from Task 7 with:

```kotlin
val pluginsDir = server.pluginsFolder
val customItemsManager = gg.interfaze.plugin.customitems.CustomItemsManager(
    listOf(
        gg.interfaze.plugin.customitems.NexoSource(pluginsDir),
        gg.interfaze.plugin.customitems.OraxenSource(pluginsDir),
    )
)
(menuProvider as? gg.interfaze.plugin.provider.SyncedMenuProvider)?.setCustomItemsManager(customItemsManager)
```

- [ ] **Step 6: Run tests**

```bash
cd plugin && ./gradlew test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
rtk git add plugin/build.gradle.kts plugin/src/main/kotlin/gg/interfaze/plugin/customitems/OraxenSource.kt plugin/src/main/kotlin/gg/interfaze/plugin/InterfazePlugin.kt plugin/src/test/kotlin/gg/interfaze/plugin/CustomItemsManagerTest.kt
rtk git commit -m "feat(plugin): OraxenSource adapter for custom items integration"
```

---

## Task 9: Plugin — ItemsAdderSource Adapter

**Files:**
- Modify: `plugin/build.gradle.kts`
- Create: `plugin/src/main/kotlin/gg/interfaze/plugin/customitems/ItemsAdderSource.kt`
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/InterfazePlugin.kt`

- [ ] **Step 1: Add ItemsAdder compileOnly dependency**

In `plugin/build.gradle.kts`, JitPack is already in repositories. Add to `dependencies`:

```kotlin
compileOnly("com.github.LoneDev6:API-ItemsAdder:3.6.1-beta-r7")  // verify latest at github.com/LoneDev6/API-ItemsAdder
```

- [ ] **Step 2: Write a failing test**

Add to `CustomItemsManagerTest.kt`:

```kotlin
@Test
fun `ItemsAdderSource isAvailable returns false when plugin not installed`() {
    val source = gg.interfaze.plugin.customitems.ItemsAdderSource(java.io.File("/nonexistent"))
    assertFalse(source.isAvailable())
}
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd plugin && ./gradlew test --tests "*ItemsAdderSource*"
```

Expected: compilation error.

- [ ] **Step 4: Create `ItemsAdderSource.kt`**

```kotlin
// plugin/src/main/kotlin/gg/interfaze/plugin/customitems/ItemsAdderSource.kt
package gg.interfaze.plugin.customitems

import org.bukkit.Bukkit
import java.io.File

class ItemsAdderSource(private val pluginsDir: File) : CustomItemSource {
    override val namespace = "itemsadder"

    override fun isAvailable(): Boolean =
        Bukkit.getPluginManager().getPlugin("ItemsAdder") != null

    override fun collectItems(): List<CustomItemEntry> {
        if (!isAvailable()) return emptyList()
        return try {
            val csClass = Class.forName("dev.lone.itemsadder.api.CustomStack")
            @Suppress("UNCHECKED_CAST")
            val items = csClass.getMethod("getAllItems").invoke(null) as Collection<*>
            items.mapNotNull { stack ->
                val id = stack?.javaClass?.getMethod("getId")?.invoke(stack) as? String ?: return@mapNotNull null
                val namespace = id.substringBefore(":")
                val name = id.substringAfter(":")
                CustomItemEntry(
                    id = "itemsadder:$id",
                    label = name,
                    texturePath = "itemsadder/$namespace/$name",
                )
            }
        } catch (_: Exception) { emptyList() }
    }

    override fun loadTexture(texturePath: String): ByteArray? {
        // texturePath = "itemsadder/{namespace}/{name}"
        val parts = texturePath.removePrefix("itemsadder/").split("/", limit = 2)
        if (parts.size < 2) return null
        val (ns, name) = parts
        val packDir = File(pluginsDir, "ItemsAdder/data/resource_pack")
        val candidates = listOf(
            File(packDir, "assets/$ns/textures/item/$name.png"),
            File(packDir, "assets/$ns/textures/$name.png"),
        )
        return candidates.firstOrNull { it.exists() }?.readBytes()
    }
}
```

- [ ] **Step 5: Add `ItemsAdderSource` to the manager in `InterfazePlugin.kt`**

```kotlin
val customItemsManager = gg.interfaze.plugin.customitems.CustomItemsManager(
    listOf(
        gg.interfaze.plugin.customitems.NexoSource(pluginsDir),
        gg.interfaze.plugin.customitems.OraxenSource(pluginsDir),
        gg.interfaze.plugin.customitems.ItemsAdderSource(pluginsDir),
    )
)
```

- [ ] **Step 6: Run all plugin tests**

```bash
cd plugin && ./gradlew test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
rtk git add plugin/build.gradle.kts plugin/src/main/kotlin/gg/interfaze/plugin/customitems/ItemsAdderSource.kt plugin/src/main/kotlin/gg/interfaze/plugin/InterfazePlugin.kt plugin/src/test/kotlin/gg/interfaze/plugin/CustomItemsManagerTest.kt
rtk git commit -m "feat(plugin): ItemsAdderSource adapter for custom items integration"
```

---

## Task 10: Editor — Library Custom Items Support

**Files:**
- Modify: `editor/src/lib/packApi.ts`
- Modify: `editor/src/features/canvas/Library.tsx`
- Modify: `editor/src/features/canvas/Library.test.tsx`

- [ ] **Step 1: Write failing tests**

Add to `editor/src/features/canvas/Library.test.tsx`:

```typescript
import * as packApi from "@/lib/packApi";
import type { CustomItemsData } from "@/lib/packApi";

const MOCK_CUSTOM: CustomItemsData = {
  serverKeyId: "srv_test_123",
  items: [
    { id: "nexo:iron_coin", label: "Iron Coin", category: "nexo", texture: "nexo/iron_coin" },
  ],
};

describe("Library with custom items", () => {
  beforeEach(() => {
    vi.spyOn(packApi, "fetchItems").mockResolvedValue(MOCK_DATA);
    vi.spyOn(packApi, "fetchCustomItems").mockResolvedValue(MOCK_CUSTOM);
  });

  it("shows custom items alongside vanilla items", async () => {
    render(<Library />);
    expect(await screen.findByTitle("Diamond Sword")).toBeTruthy();
    expect(await screen.findByTitle("Iron Coin")).toBeTruthy();
  });

  it("shows nexo category chip", async () => {
    render(<Library />);
    await screen.findByTitle("Iron Coin");
    expect(screen.getByRole("button", { name: /nexo/i })).toBeTruthy();
  });

  it("filters custom items by category", async () => {
    render(<Library />);
    await screen.findByTitle("Iron Coin");
    fireEvent.click(screen.getByRole("button", { name: /nexo/i }));
    expect(screen.queryByTitle("Diamond Sword")).toBeNull();
    expect(screen.getByTitle("Iron Coin")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd editor && npx vitest run src/features/canvas/Library.test.tsx
```

Expected: failure — `fetchCustomItems` not exported from `packApi`.

- [ ] **Step 3: Add `fetchCustomItems` to `packApi.ts` and update existing test mock**

Also update the existing `describe("Library", ...)` `beforeEach` in `Library.test.tsx` to mock the new function so existing tests don't make live fetch calls:

```typescript
// Existing beforeEach inside describe("Library", ...)
beforeEach(() => {
  vi.spyOn(packApi, "fetchItems").mockResolvedValue(MOCK_DATA);
  vi.spyOn(packApi, "fetchCustomItems").mockResolvedValue({ serverKeyId: "", items: [] });
});
```

Add after the existing `LibraryData` interface in `packApi.ts`:

```typescript
export interface CustomItemsData {
  serverKeyId: string;
  items: LibraryItem[];
}

export async function fetchCustomItems(token: string): Promise<CustomItemsData> {
  try {
    const res = await fetch(`${API_URL}/api/editor-session/${token}/custom-items`);
    if (!res.ok) return { serverKeyId: "", items: [] };
    return res.json() as Promise<CustomItemsData>;
  } catch {
    return { serverKeyId: "", items: [] };
  }
}
```

- [ ] **Step 4: Update `Library.tsx`**

Add the import and state:

```typescript
import { type LibraryItem, type CustomItemsData, fetchItems, fetchCustomItems } from "@/lib/packApi";
```

Change `ItemTileProps` to accept a `textureBase` instead of `version`:

```typescript
interface ItemTileProps {
  item: LibraryItem;
  textureBase: string;
}

function ItemTile({ item, textureBase }: ItemTileProps) {
  const url = `${textureBase}/${item.texture}`;
  // ... rest unchanged
}
```

In the `Library` component, replace the `items` state and effect:

```typescript
const [items, setItems] = useState<LibraryItem[]>([]);
const [customData, setCustomData] = useState<CustomItemsData>({ serverKeyId: "", items: [] });
const [error, setError] = useState(false);

useEffect(() => {
  if (!token) return;
  Promise.all([fetchItems(token), fetchCustomItems(token)])
    .then(([vanilla, custom]) => {
      setTextureData(vanilla.version, vanilla.items);
      setItems(vanilla.items);
      setCustomData(custom);
    })
    .catch(() => setError(true));
}, [token, setTextureData]);
```

Replace the `categories` computation and the `filtered` computation:

```typescript
const allItems = [...items, ...customData.items];
const categories = ["all", ...Array.from(new Set(allItems.map((i) => i.category))).sort()];

const filtered = allItems.filter(
  (i) =>
    (category === "all" || i.category === category) &&
    (i.id.includes(search.toLowerCase()) || i.label.toLowerCase().includes(search.toLowerCase())),
);
```

In the render, pass `textureBase` to each `ItemTile`:

```typescript
{filtered.map((item) => {
  const isCustom = customData.items.some((c) => c.id === item.id);
  const textureBase = isCustom
    ? `${API_URL}/api/textures/custom/${customData.serverKeyId}`
    : `${API_URL}/api/textures/${version}`;
  return <ItemTile key={item.id} item={item} textureBase={textureBase} />;
})}
```

Also fix the `items.length === 0` empty-state check to use `allItems`:

```typescript
{allItems.length === 0 && !error && (
  <div className="w-full py-4 text-center text-xs text-zinc-500">{t("library.loading")}</div>
)}
{filtered.map(...)}
{allItems.length > 0 && filtered.length === 0 && (
  <div className="w-full py-4 text-center text-xs text-zinc-500">{t("library.noMatch")}</div>
)}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd editor && npx vitest run src/features/canvas/Library.test.tsx
```

Expected: all tests pass (existing + new custom items tests).

- [ ] **Step 6: Run full editor test suite**

```bash
cd editor && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
rtk git add editor/src/lib/packApi.ts editor/src/features/canvas/Library.tsx editor/src/features/canvas/Library.test.tsx
rtk git commit -m "feat(editor): display custom items (Nexo/Oraxen/ItemsAdder) in Library"
```

---

## Task 11: Plugin — Hot-Reload Listeners

When a third-party plugin reloads (e.g. `/n reload` in Nexo), its items and textures may change. Each plugin fires a Bukkit event on reload. This task registers listeners in `InterfazePlugin` so that `notifyCustomItemsReload()` is called automatically.

**Files:**
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/InterfazePlugin.kt`

- [ ] **Step 1: Add a helper that registers all available reload listeners**

In `InterfazePlugin.kt`, add a private helper after `onEnable`:

```kotlin
private fun registerCustomItemsReloadListeners(provider: gg.interfaze.plugin.provider.SyncedMenuProvider) {
    val mgr = server.pluginManager

    if (mgr.getPlugin("Nexo") != null) {
        mgr.registerEvents(object : org.bukkit.event.Listener {
            @org.bukkit.event.EventHandler
            fun on(event: com.nexomc.nexo.api.events.NexoReloadEvent) {
                provider.notifyCustomItemsReload()
            }
        }, this)
    }

    if (mgr.getPlugin("Oraxen") != null) {
        mgr.registerEvents(object : org.bukkit.event.Listener {
            @org.bukkit.event.EventHandler
            fun on(event: io.th0rgal.oraxen.api.events.OraxenItemsLoadedEvent) {
                provider.notifyCustomItemsReload()
            }
        }, this)
    }

    if (mgr.getPlugin("ItemsAdder") != null) {
        mgr.registerEvents(object : org.bukkit.event.Listener {
            @org.bukkit.event.EventHandler
            fun on(event: dev.lone.itemsadder.api.Events.CustomItemsLoadedEvent) {
                provider.notifyCustomItemsReload()
            }
        }, this)
    }
}
```

- [ ] **Step 2: Call the helper from `onEnable`**

At the end of the custom items manager block in `onEnable` (after `setCustomItemsManager(customItemsManager)`):

```kotlin
val syncedProvider = menuProvider as? gg.interfaze.plugin.provider.SyncedMenuProvider
if (syncedProvider != null) registerCustomItemsReloadListeners(syncedProvider)
```

- [ ] **Step 3: Run plugin tests**

```bash
cd plugin && ./gradlew test
```

Expected: all tests pass (no hot-reload unit test — Bukkit events are covered by existing MockBukkit integration test infrastructure).

- [ ] **Step 4: Commit**

```bash
rtk git add plugin/src/main/kotlin/gg/interfaze/plugin/InterfazePlugin.kt
rtk git commit -m "feat(plugin): register hot-reload listeners for Nexo, Oraxen, ItemsAdder"
```

---

## Final Verification

- [ ] **Build the plugin**

```bash
cd plugin && ./gradlew shadowJar
```

Expected: `BUILD SUCCESSFUL`, jar in `plugin/build/libs/`.

- [ ] **Run all backend tests**

```bash
cd backend && bun test
```

Expected: all tests pass.

- [ ] **Run all editor tests**

```bash
cd editor && npx vitest run
```

Expected: all tests pass.

- [ ] **Deploy and smoke-test** (requires Docker stack)

```bash
cd plugin && ./gradlew deploy
```

Start a Minecraft server with Nexo installed, open the editor, verify Nexo items appear in the Library with their textures.
