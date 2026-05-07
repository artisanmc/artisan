# Library Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display all vanilla Minecraft inventory items with their textures in the editor's Library panel, pulling item data and textures from the backend which proxies mcasset.cloud.

**Architecture:** The plugin already sends `minecraft_version` in `hello` (hardcoded `"1.21.4"`). We make it dynamic, then have the backend store it per server. Two new backend endpoints serve the item list (`/api/editor-session/:token/items`) and proxy textures (`/api/textures/:version/*`). The existing `Library.tsx` (which already has search + @dnd-kit drag) is updated to fetch from these endpoints instead of build-time bundled assets. `itemTextures.ts` and bundled PNGs are untouched — they continue to serve canvas slot rendering throughout the editor.

**Tech Stack:** Kotlin 2.0 / Bukkit, Bun + Hono, TypeScript, Zustand, React 19, @dnd-kit

---

## File Map

| Action | File | What changes |
|--------|------|--------------|
| Modify | `plugin/src/main/kotlin/gg/interfaze/plugin/ws/WsClient.kt` | Add `mcVersion: String` param; use in hello |
| Modify | `plugin/src/main/kotlin/gg/interfaze/plugin/provider/SyncedMenuProvider.kt` | Pass `Bukkit.getServer().minecraftVersion` |
| Modify | `backend/src/ws/hub.ts` | Add `serverIdToMcVersion` map; export `getMcVersion()` |
| Modify | `backend/src/ws/hub.test.ts` | Add test: hello stores mc_version |
| Create | `backend/scripts/gen-items.ts` | One-shot script to generate items JSON from mcmeta |
| Create | `backend/data/items/1.21.4.json` | Generated items registry (committed) |
| Modify | `backend/src/routes/editorSession.ts` | Add `GET /:token/items` route |
| Create | `backend/src/routes/textures.ts` | Proxy route: `/api/textures/:version/*` |
| Create | `backend/src/routes/textures.test.ts` | Tests for proxy route |
| Modify | `backend/src/app.ts` | Register textures router |
| Modify | `editor/src/lib/packApi.ts` | Add `fetchItems()` + `LibraryItem`/`LibraryData` types |
| Modify | `editor/src/features/canvas/Library.tsx` | Use API items + category chips + API texture URLs |

---

## Task 1: Plugin — dynamic MC version

The WsClient currently hardcodes `"minecraft_version" to "1.21.4"`. Make it use the actual running server version.

**Files:**
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/ws/WsClient.kt`
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/provider/SyncedMenuProvider.kt`

- [ ] **Step 1: Add `mcVersion` parameter to WsClient**

In `WsClient.kt`, add the parameter and use it in the hello payload. The existing test `WsClientTest` constructs a WsClient — you'll need to add the arg there too.

```kotlin
class WsClient(
    private val url: String,
    private val serverKey: String,
    private val mcVersion: String,              // new: dynamic MC version
    private val currentBundleHash: String = "",
    private val onMessage: (String) -> Unit,
    private val logger: Logger? = null,
) {
```

Inside `Listener.onOpen`, replace the hardcoded string:

```kotlin
val hello = mapOf(
    "type" to "hello",
    "server_key" to serverKey,
    "plugin_version" to "1.0.0",
    "minecraft_version" to mcVersion,          // was: "1.21.4"
    "current_bundle_hash" to currentBundleHash,
)
```

- [ ] **Step 2: Pass the MC version when constructing WsClient in SyncedMenuProvider**

In `SyncedMenuProvider.kt`, around line 70, the WsClient constructor call becomes:

```kotlin
val client = WsClient(
    url               = wsUrl,
    serverKey         = serverKey,
    mcVersion         = org.bukkit.Bukkit.getServer().minecraftVersion,
    currentBundleHash = currentHash,
    onMessage         = ::handleMessage,
    logger            = logger,
)
```

- [ ] **Step 3: Update WsClientTest to pass the new parameter**

In `plugin/src/test/kotlin/gg/interfaze/plugin/WsClientTest.kt`, find the WsClient constructor call and add `mcVersion = "1.21.4"`.

- [ ] **Step 4: Run plugin tests**

```bash
cd plugin && ./gradlew test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugin/src/main/kotlin/gg/interfaze/plugin/ws/WsClient.kt
git add plugin/src/main/kotlin/gg/interfaze/plugin/provider/SyncedMenuProvider.kt
git add plugin/src/test/kotlin/gg/interfaze/plugin/WsClientTest.kt
git commit -m "feat(plugin): send dynamic minecraft_version in hello message"
```

---

## Task 2: Backend — store mc_version from hello

The backend receives `minecraft_version` in every hello message (it's already in the `HelloMessage` interface in `protocol.ts`) but never stores it. We need to look it up later when the editor requests items.

**Files:**
- Modify: `backend/src/ws/hub.ts`
- Modify: `backend/src/ws/hub.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `backend/src/ws/hub.test.ts`, importing `getMcVersion` (doesn't exist yet):

```typescript
import { handlePluginMessage, registerConn, registerEditorConn, cleanupEditorConn, broadcastDraftUpdate, getMcVersion } from "./hub";
```

Add this test case inside `describe("handlePluginMessage", ...)`:

```typescript
test("hello stores minecraft_version, getMcVersion returns it", async () => {
  const createRes = await app.request("/api/server-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label: "mc-version-test" }),
  });
  const { key } = (await createRes.json()) as { key: string };

  const hello: HelloMessage = {
    type: "hello",
    server_key: key,
    plugin_version: "1.0.0",
    minecraft_version: "1.21.99",
    current_bundle_hash: "",
  };
  const result = await handlePluginMessage("conn-mcver", JSON.stringify(hello));
  expect(result.reply).not.toBeNull();
  const ack = JSON.parse(result.reply!) as HelloAckMessage;
  expect(getMcVersion(ack.server_id)).toBe("1.21.99");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && bun test src/ws/hub.test.ts
```

Expected: compilation error — `getMcVersion` is not exported from hub.

- [ ] **Step 3: Implement `serverIdToMcVersion` map and `getMcVersion` export**

In `backend/src/ws/hub.ts`, after the `connToServerId` declaration (line 36):

```typescript
// serverKeyId → minecraft version (set on hello, used by /api/items)
const serverIdToMcVersion = new Map<string, string>();
```

In the hello handler (`if (msg.type === "hello") { ... }`), after `connToServerId.set(connId, keyId)` (line 97):

```typescript
serverIdToMcVersion.set(keyId, hello.minecraft_version);
```

At the end of the file, export the lookup function:

```typescript
export function getMcVersion(serverKeyId: string): string | undefined {
  return serverIdToMcVersion.get(serverKeyId);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && bun test src/ws/hub.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/ws/hub.ts backend/src/ws/hub.test.ts
git commit -m "feat(backend): store minecraft_version from hello, export getMcVersion"
```

---

## Task 3: Backend — generate items data file

Write a one-shot script that fetches the vanilla item registry from mcmeta and outputs a JSON file.

**Files:**
- Create: `backend/scripts/gen-items.ts`
- Create: `backend/data/items/1.21.4.json` (generated, then committed)

- [ ] **Step 1: Create the `data/items/` directory**

```bash
mkdir -p backend/data/items
```

- [ ] **Step 2: Write the generator script**

Create `backend/scripts/gen-items.ts`:

```typescript
#!/usr/bin/env bun
/**
 * Usage: bun backend/scripts/gen-items.ts [version]
 * Fetches the Minecraft item registry from mcmeta and writes
 * backend/data/items/{version}.json with id, label, category, texture fields.
 */

const VERSION = process.argv[2] ?? "1.21.4";
const REGISTRY_URL = `https://raw.githubusercontent.com/misode/mcmeta/${VERSION}/registries/item/data.json`;
const OUT_PATH = new URL(`../data/items/${VERSION}.json`, import.meta.url).pathname;

interface McMetaRegistry { entries: Record<string, unknown> }

const res = await fetch(REGISTRY_URL);
if (!res.ok) throw new Error(`Failed to fetch registry for ${VERSION}: ${res.status} ${REGISTRY_URL}`);
const registry = await res.json() as McMetaRegistry;

const ids = Object.keys(registry.entries).map(k => k.replace("minecraft:", ""));

const ARMOR_SUFFIXES = ["_helmet", "_chestplate", "_leggings", "_boots", "elytra", "turtle_helmet", "wolf_armor"];
const COMBAT_PARTS = ["_sword", "bow", "crossbow", "trident", "shield", "arrow", "_axe"];
const TOOL_PARTS = ["_pickaxe", "_shovel", "_hoe", "fishing_rod", "flint_and_steel", "shears", "compass", "clock", "lead", "name_tag", "carrot_on_a_stick", "warped_fungus_on_a_stick"];
const POTION_PARTS = ["potion", "tipped_arrow"];
const FOOD_IDS = new Set([
  "bread", "apple", "cooked_beef", "cooked_porkchop", "cooked_chicken", "cooked_cod",
  "cooked_salmon", "cooked_rabbit", "cooked_mutton", "beef", "porkchop", "chicken",
  "cod", "salmon", "tropical_fish", "pufferfish", "rabbit", "mutton",
  "mushroom_stew", "rabbit_stew", "beetroot_soup", "suspicious_stew",
  "honey_bottle", "milk_bucket", "carrot", "potato", "baked_potato", "poisonous_potato",
  "melon_slice", "pumpkin_pie", "cake", "cookie", "dried_kelp", "sweet_berries",
  "glow_berries", "chorus_fruit", "golden_carrot", "golden_apple", "enchanted_golden_apple",
  "spider_eye", "fermented_spider_eye", "rotten_flesh",
]);

function categorize(id: string): string {
  if (ARMOR_SUFFIXES.some(s => id.endsWith(s))) return "armor";
  if (COMBAT_PARTS.some(s => id.includes(s))) return "combat";
  if (TOOL_PARTS.some(s => id.includes(s))) return "tools";
  if (POTION_PARTS.some(s => id.includes(s))) return "potions";
  if (FOOD_IDS.has(id)) return "food";
  return "misc";
}

function toLabel(id: string): string {
  return id.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

const SKIP = new Set(["air"]);

const items = ids
  .filter(id => !SKIP.has(id))
  .map(id => ({
    id,
    label: toLabel(id),
    category: categorize(id),
    texture: `item/${id}`,
  }));

await Bun.write(OUT_PATH, JSON.stringify(items, null, 2) + "\n");
console.log(`Wrote ${items.length} items → ${OUT_PATH}`);
```

- [ ] **Step 3: Run the script to generate `1.21.4.json`**

```bash
cd backend && bun scripts/gen-items.ts 1.21.4
```

Expected output: `Wrote N items → .../backend/data/items/1.21.4.json` (N should be ~1000+).

If the fetch fails (wrong branch name), try:
```bash
bun scripts/gen-items.ts
```
and inspect the error. The mcmeta branch for 1.21.4 might be named `1.21.4` or `summary`. If `summary` is needed, change `VERSION` in the URL to just `"summary"`.

- [ ] **Step 4: Verify the output**

```bash
head -20 backend/data/items/1.21.4.json
```

Should show items like:
```json
[
  {
    "id": "stone",
    "label": "Stone",
    "category": "misc",
    "texture": "item/stone"
  },
  ...
```

Check the count:
```bash
cat backend/data/items/1.21.4.json | bun -e "const d=await Bun.stdin.text(); console.log(JSON.parse(d).length + ' items')"
```

- [ ] **Step 5: Commit the script and generated data**

```bash
git add backend/scripts/gen-items.ts backend/data/items/1.21.4.json
git commit -m "feat(backend): add gen-items script and vanilla 1.21.4 item registry"
```

---

## Task 4: Backend — GET /:token/items endpoint

Add a route that returns the item list for the server's MC version.

**Files:**
- Modify: `backend/src/routes/editorSession.ts`

- [ ] **Step 1: Write the failing test**

In `backend/src/routes/editorSession.test.ts` (the existing test file), add a new describe block at the end. This test requires a real WS hello to register the mc_version, so it uses `handlePluginMessage` directly.

Add these imports at the top of the file if not already present:
```typescript
import { handlePluginMessage, getMcVersion } from "../ws/hub";
import type { HelloAckMessage, HelloMessage } from "../protocol";
import { db } from "../db/index";
import { editorSessions, serverKeys } from "../db/schema";
```

(The file already imports `db`, `editorSessions`, `serverKeys` — only add the missing ones.)

Add the new test:
```typescript
describe("GET /:token/items", () => {
  test("returns 503 when server is offline (no mc_version registered)", async () => {
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "items-test-" + keyId.slice(0, 8), createdAt: new Date() });

    const token = "items_tok_" + crypto.randomUUID().slice(0, 8);
    await db.insert(editorSessions).values({
      token,
      serverKeyId: keyId,
      createdBy: "test",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    const res = await app.request(`/api/editor-session/${token}/items`);
    expect(res.status).toBe(503);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("server_offline");
  });

  test("returns 404 for unknown mc_version", async () => {
    const createRes = await app.request("/api/server-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "items-ver-test" }),
    });
    const { key: serverKey } = (await createRes.json()) as { key: string };

    // Do hello to register mc_version
    const hello: HelloMessage = {
      type: "hello",
      server_key: serverKey,
      plugin_version: "1.0.0",
      minecraft_version: "99.99.99",   // version that has no data file
      current_bundle_hash: "",
    };
    const helloRes = await handlePluginMessage("conn-items-test", JSON.stringify(hello));
    const ack = JSON.parse(helloRes.reply!) as HelloAckMessage;

    // Create editor session for this server
    const token = "items_tok2_" + crypto.randomUUID().slice(0, 8);
    await db.insert(editorSessions).values({
      token,
      serverKeyId: ack.server_id,
      createdBy: "test",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    const res = await app.request(`/api/editor-session/${token}/items`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && bun test src/routes/editorSession.test.ts
```

Expected: tests fail because the route doesn't exist yet (404 for everything).

- [ ] **Step 3: Implement the route**

In `backend/src/routes/editorSession.ts`, add this import at the top:
```typescript
import { join } from "path";
import { getMcVersion } from "../ws/hub";
```

Add the route before `export { router as editorSessionRouter }`:
```typescript
router.get("/:token/items", async (c) => {
  const token = c.req.param("token");
  const session = await validateEditorToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const version = getMcVersion(session.serverKeyId);
  if (!version) return c.json({ error: "server_offline" }, 503);

  const dataPath = join(import.meta.dir, "../../data/items", `${version}.json`);
  let items: unknown[];
  try {
    const file = Bun.file(dataPath);
    items = await file.json() as unknown[];
  } catch {
    return c.json({ error: "unknown_version" }, 404);
  }

  return c.json({ version, items });
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && bun test src/routes/editorSession.test.ts
```

Expected: all tests pass, including the two new ones.

- [ ] **Step 5: Run all backend tests to check for regressions**

```bash
cd backend && bun test
```

Expected: all 11+ tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/editorSession.ts backend/src/routes/editorSession.test.ts
git commit -m "feat(backend): GET /:token/items returns vanilla item list for server MC version"
```

---

## Task 5: Backend — GET /api/textures/:version/* proxy

Proxy texture requests to mcasset.cloud. The editor calls e.g. `/api/textures/1.21.4/item/diamond_sword` and the backend fetches `https://mcasset.cloud/1.21.4/assets/minecraft/textures/item/diamond_sword.png`.

**Files:**
- Create: `backend/src/routes/textures.ts`
- Create: `backend/src/routes/textures.test.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/routes/textures.test.ts`:

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { app } from "../app";

describe("GET /api/textures/:version/*", () => {
  const PNG_BYTES = new Uint8Array([137, 80, 78, 71]); // PNG magic bytes
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("diamond_sword")) {
        return new Response(PNG_BYTES, {
          status: 200,
          headers: { "Content-Type": "image/png" },
        });
      }
      return new Response(null, { status: 404 });
    }) as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("proxies known texture and adds Cache-Control", async () => {
    const res = await app.request("/api/textures/1.21.4/item/diamond_sword");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body).toEqual(PNG_BYTES);
  });

  test("returns 404 when upstream returns 404", async () => {
    const res = await app.request("/api/textures/1.21.4/item/does_not_exist");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && bun test src/routes/textures.test.ts
```

Expected: fail — route not registered yet.

- [ ] **Step 3: Create the textures route**

Create `backend/src/routes/textures.ts`:

```typescript
import { Hono } from "hono";

const router = new Hono();

router.get("/:version/*", async (c) => {
  const version = c.req.param("version");
  const rest = c.req.param("*");   // path after /:version/
  const url = `https://mcasset.cloud/${version}/assets/minecraft/textures/${rest}.png`;

  let upstream: Response;
  try {
    upstream = await fetch(url);
  } catch {
    return c.newResponse(null, 502);
  }

  if (!upstream.ok) return c.newResponse(null, upstream.status as 404 | 502);

  const body = await upstream.arrayBuffer();
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  });
});

export { router as texturesRouter };
```

- [ ] **Step 4: Register the route in app.ts**

In `backend/src/app.ts`, add the import:
```typescript
import { texturesRouter } from "./routes/textures";
```

Add the route registration after the other `app.route(...)` calls:
```typescript
app.route("/api/textures", texturesRouter);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && bun test src/routes/textures.test.ts
```

Expected: both tests pass.

- [ ] **Step 6: Run all backend tests**

```bash
cd backend && bun test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/textures.ts backend/src/routes/textures.test.ts backend/src/app.ts
git commit -m "feat(backend): GET /api/textures/:version/* proxy to mcasset.cloud"
```

---

## Task 6: Editor — fetchItems in packApi

Add the API call and shared types for the Library.

**Files:**
- Modify: `editor/src/lib/packApi.ts`

- [ ] **Step 1: Write the failing test**

Create `editor/src/lib/packApi.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchItems } from "./packApi";

describe("fetchItems", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns parsed LibraryData on success", async () => {
    const mockData = {
      version: "1.21.4",
      items: [
        { id: "diamond_sword", label: "Diamond Sword", category: "combat", texture: "item/diamond_sword" },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
    }));

    const result = await fetchItems("test-token");
    expect(result.version).toBe("1.21.4");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe("diamond_sword");
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(fetchItems("test-token")).rejects.toThrow("503");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd editor && npx vitest run src/lib/packApi.test.ts
```

Expected: fail — `fetchItems` not exported.

- [ ] **Step 3: Add types and `fetchItems` to packApi.ts**

In `editor/src/lib/packApi.ts`, add at the top after the `API_URL` declaration:

```typescript
export interface LibraryItem {
  id: string;
  label: string;
  category: string;
  texture: string;
}

export interface LibraryData {
  version: string;
  items: LibraryItem[];
}
```

Add the function before the last line:

```typescript
export async function fetchItems(token: string): Promise<LibraryData> {
  const res = await fetch(`${API_URL}/api/editor-session/${token}/items`);
  if (!res.ok) throw new Error(`fetchItems failed: ${res.status}`);
  return res.json() as Promise<LibraryData>;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd editor && npx vitest run src/lib/packApi.test.ts
```

Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add editor/src/lib/packApi.ts editor/src/lib/packApi.test.ts
git commit -m "feat(editor): add fetchItems + LibraryItem/LibraryData types to packApi"
```

---

## Task 7: Editor — update Library to use API items

Replace `knownMaterials()` / `itemTextureUrl()` in `Library.tsx` with API-backed data. Add category filter chips. Keep the existing `@dnd-kit` drag behaviour and `armedMaterial` click-to-arm.

**Important:** `itemTextures.ts` and the bundled PNG assets are NOT changed. They are still used by `MenuGroup.tsx`, `Stage.tsx`, `FlowCanvas.tsx`, etc. for canvas slot rendering. Only `Library.tsx` switches to the API.

**Files:**
- Modify: `editor/src/features/canvas/Library.tsx`

- [ ] **Step 1: Write the failing test**

Create `editor/src/features/canvas/Library.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Library } from "./Library";
import * as packApi from "@/lib/packApi";
import type { LibraryData } from "@/lib/packApi";

// Minimal Zustand mocks
vi.mock("@/state/uiStore", () => ({
  useUiStore: (sel: (s: { armedMaterial: null; setArmedMaterial: () => void }) => unknown) =>
    sel({ armedMaterial: null, setArmedMaterial: () => {} }),
}));
vi.mock("@/state/sessionStore", () => ({
  useSessionStore: (sel: (s: { token: string }) => unknown) => sel({ token: "test-token" }),
}));
vi.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, isDragging: false }),
}));

const MOCK_DATA: LibraryData = {
  version: "1.21.4",
  items: [
    { id: "diamond_sword", label: "Diamond Sword", category: "combat", texture: "item/diamond_sword" },
    { id: "stone",         label: "Stone",         category: "misc",   texture: "item/stone" },
    { id: "bread",         label: "Bread",         category: "food",   texture: "item/bread" },
  ],
};

describe("Library", () => {
  beforeEach(() => {
    vi.spyOn(packApi, "fetchItems").mockResolvedValue(MOCK_DATA);
  });

  it("renders all items when no filter", async () => {
    render(<Library />);
    expect(await screen.findByTitle("Diamond Sword")).toBeTruthy();
    expect(screen.getByTitle("Stone")).toBeTruthy();
    expect(screen.getByTitle("Bread")).toBeTruthy();
  });

  it("filters by search query", async () => {
    render(<Library />);
    await screen.findByTitle("Diamond Sword");
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "diamond" } });
    expect(screen.getByTitle("Diamond Sword")).toBeTruthy();
    expect(screen.queryByTitle("Stone")).toBeNull();
  });

  it("filters by category chip", async () => {
    render(<Library />);
    await screen.findByTitle("Diamond Sword");
    fireEvent.click(screen.getByRole("button", { name: /food/i }));
    expect(screen.queryByTitle("Diamond Sword")).toBeNull();
    expect(screen.getByTitle("Bread")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd editor && npx vitest run src/features/canvas/Library.test.tsx
```

Expected: fail — Library still uses `knownMaterials()`.

- [ ] **Step 3: Rewrite Library.tsx**

Replace the entire contents of `editor/src/features/canvas/Library.tsx`:

```typescript
import { Input } from "@/components/ui/input";
import { cx } from "@/lib/cx";
import { type LibraryItem, fetchItems } from "@/lib/packApi";
import { useSessionStore } from "@/state/sessionStore";
import { useUiStore } from "@/state/uiStore";
import { useDraggable } from "@dnd-kit/core";
import { type CSSProperties, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/** ID prefix for Library items inside the top-level DndContext. */
export const LIBRARY_DRAG_PREFIX = "lib:";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

interface ItemTileProps {
  item: LibraryItem;
  version: string;
}

function ItemTile({ item, version }: ItemTileProps) {
  const url = `${API_URL}/api/textures/${version}/${item.texture}`;
  const armed = useUiStore((s) => s.armedMaterial === item.id);
  const setArmedMaterial = useUiStore((s) => s.setArmedMaterial);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${LIBRARY_DRAG_PREFIX}${item.id}`,
    data: { material: item.id },
  });
  const style: CSSProperties = { opacity: isDragging ? 0.4 : 1 };

  return (
    <button
      ref={setNodeRef}
      type="button"
      style={style}
      onClick={() => setArmedMaterial(armed ? null : item.id)}
      title={item.label}
      {...listeners}
      {...attributes}
      className={cx(
        "group relative flex h-12 w-12 shrink-0 select-none touch-none items-center justify-center",
        "rounded border bg-zinc-900 active:cursor-grabbing",
        armed
          ? "border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500"
          : "border-zinc-800 cursor-grab hover:border-zinc-600",
      )}
    >
      <img
        src={url}
        alt={item.label}
        draggable={false}
        className="pixelated h-3/4 w-3/4 object-contain"
        style={{ imageRendering: "pixelated" }}
        onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }}
      />
    </button>
  );
}

export function Library() {
  const token = useSessionStore((s) => s.token);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [version, setVersion] = useState("");
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [error, setError] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    if (!token) return;
    fetchItems(token)
      .then((data) => { setVersion(data.version); setItems(data.items); })
      .catch(() => setError(true));
  }, [token]);

  const categories = ["all", ...Array.from(new Set(items.map((i) => i.category))).sort()];

  const filtered = items.filter(
    (i) =>
      (category === "all" || i.category === category) &&
      (i.id.includes(search.toLowerCase()) || i.label.toLowerCase().includes(search.toLowerCase())),
  );

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-zinc-500">
        {t("library.unavailable")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <Input
        placeholder={t("library.search")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="flex flex-wrap gap-1">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(cat)}
            className={cx(
              "rounded-full border px-2 py-0.5 text-[10px] capitalize",
              category === cat
                ? "border-emerald-600 bg-emerald-600/10 text-emerald-300"
                : "border-zinc-700 text-zinc-400 hover:border-zinc-500",
            )}
          >
            {cat}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 overflow-y-auto pb-2">
        {items.length === 0 && !error && (
          <div className="w-full py-4 text-center text-xs text-zinc-500">{t("library.loading")}</div>
        )}
        {filtered.map((item) => (
          <ItemTile key={item.id} item={item} version={version} />
        ))}
        {items.length > 0 && filtered.length === 0 && (
          <div className="w-full py-4 text-center text-xs text-zinc-500">{t("library.noMatch")}</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add missing i18n keys**

In `editor/src/locales/en.ts`, find the `library` section and add:

```typescript
library: {
  search: "Search items...",    // existing
  noMatch: "No items found",    // existing
  loading: "Loading...",         // new
  unavailable: "Library unavailable — server offline", // new
},
```

Do the same in `editor/src/locales/fr.ts`:

```typescript
library: {
  search: "Rechercher des items...",   // existing
  noMatch: "Aucun item trouvé",        // existing
  loading: "Chargement...",             // new
  unavailable: "Bibliothèque indisponible — serveur hors ligne", // new
},
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd editor && npx vitest run src/features/canvas/Library.test.tsx
```

Expected: all 3 tests pass.

- [ ] **Step 6: Run full editor test suite**

```bash
cd editor && npx vitest run
```

Expected: all existing tests pass (no regressions — `itemTextures.ts` is unchanged).

- [ ] **Step 7: Build to verify no TypeScript errors**

```bash
cd editor && npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 8: Commit**

```bash
git add editor/src/features/canvas/Library.tsx \
        editor/src/features/canvas/Library.test.tsx \
        editor/src/lib/packApi.ts \
        editor/src/lib/packApi.test.ts \
        editor/src/locales/en.ts \
        editor/src/locales/fr.ts
git commit -m "feat(editor): Library loads items from API with category filter chips"
```

---

## Task 8: Manual end-to-end test

Verify the full flow works with a running stack.

**Files:** none

- [ ] **Step 1: Start the full stack**

```bash
docker compose up
```

Wait for all services to be ready (minecraft:25565, backend:3001, editor:5173).

- [ ] **Step 2: Open the editor and navigate to the Library tab**

Open `http://localhost:5173` in a browser, sign in with an editor session token.

Go to any pack → click the **Library** tab in the right panel.

Expected: items load with textures from mcasset.cloud.

- [ ] **Step 3: Verify category filtering**

Click "combat" chip → only weapons/bows/etc. visible.
Click "food" chip → only food items visible.
Click "all" → all items visible.

- [ ] **Step 4: Verify search**

Type "diamond" → only diamond-related items visible.

- [ ] **Step 5: Verify drag & drop**

Drag an item from the Library onto an empty slot in a menu on the canvas.

Expected: slot updates to show the dragged item's material.

- [ ] **Step 6: Verify armed material (tap to arm)**

Click an item in the Library without dragging → item gets a green border (armed state).
Click an empty slot on the canvas → slot gets the armed material.

- [ ] **Step 7: Verify CLAUDE.md doc rule**

No protocol or endpoint changes were made to existing WS messages. The CLAUDE.md rule requires updating `docs/specs/` for protocol changes. The new `/api/textures` and `/api/items` endpoints should be noted in `docs/specs/main-spec.md` under a "Library" or "Editor API" section if applicable.

Check `docs/specs/main-spec.md` and add a brief mention of the two new endpoints if the section exists.
