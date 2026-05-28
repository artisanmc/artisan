# Resource Pack Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Branch:** `feat/resource-pack-generator`

**Goal:** Implement Sub-project 2 of the texture pack system — the pipeline that converts the global `assets` library (built in Sub-project 1) into a Minecraft-readable resource pack zip, serves it via HTTP, and has the plugin push it to players via `setResourcePack()`. Coexists with existing pack plugins (Oraxen/Nexo/ItemsAdder) via the Minecraft 1.20.3+ pack stack.

**Architecture:** Two new columns on `server_keys` (`resourcePackHash`, `resourcePackUpdatedAt`) — no new table. Pure builder modules produce zip bytes + font JSON from `Asset` rows. A `rebuildResourcePack(serverKeyId)` service orchestrates: read assets → load PNG bytes → build zip → write to `backend/data/resource-packs/{serverKeyId}/{hash}.zip` → update DB → GC old packs → broadcast WS. Triggers wire it to asset POST/PATCH/DELETE and to a manual `POST .../resource-pack/rebuild`. The HTTP endpoint `GET /api/resource-pack/:server_key_id/:hash.zip` serves from disk with immutable cache headers. On the plugin side, a new `ResourcePackManager` listens to `PlayerJoinEvent` and the `resource_pack_updated` WS message and calls `player.setResourcePack(uuid, url, sha1Bytes, prompt, false)`. UUID derivation is `UUID.nameUUIDFromBytes(hash.toByteArray(Charsets.UTF_8))` so the pack stack stays deduplicated client-side.

**Tech Stack:** Backend = Bun + Hono + Drizzle (PostgreSQL) + `fflate` (already a dep, used for `zipSync`). Plugin = Kotlin 2.0 + Paper 1.21.4 + Jackson + OkHttp. Tests = `bun test` (`bun:test`, real DB) and `./gradlew test` (JUnit + MockBukkit).

---

## Reference: spec being implemented

`docs/superpowers/specs/2026-05-11-texture-pack-system-design.md`:
- "Resource Pack Generation" (pipeline, zip structure, codepoint allocation, endpoints)
- "Plugin Distribution" (setResourcePack args, UUID derivation, WS messages, config, refus joueur)

This plan covers only **Sub-project 2**. Out of scope:
- Custom fonts (`type=font`) — Sub-project 4. `fontJsonBuilder` only handles `type=glyph` here.
- External glyphs — Sub-project 5 (Oraxen/Nexo glyphs stay in their own pack via pack stack).
- WYSIWYG title composer / `MenuTitleLayer[]` compilation — Sub-project 3.
- Export/import bundling — Sub-project 6.
- Animated glyphs.

---

## File structure overview

### Backend

| File | Action | Responsibility |
|---|---|---|
| `backend/src/db/schema.ts` | modify | Add `resourcePackHash` + `resourcePackUpdatedAt` columns on `server_keys` |
| `backend/src/lib/fontJsonBuilder.ts` | create | Pure `buildDefaultFontJson(glyphs) → object` (assets/artisan/font/default.json) |
| `backend/src/lib/fontJsonBuilder.test.ts` | create | Tests for default font JSON shape, glyph filtering |
| `backend/src/lib/resourcePackBuilder.ts` | create | Pure `buildResourcePackZip(assets, glyphPngs) → { zipBytes, hash }` via `fflate.zipSync` |
| `backend/src/lib/resourcePackBuilder.test.ts` | create | Tests for pack.mcmeta, file layout, deterministic hash |
| `backend/src/lib/resourcePackStorage.ts` | create | Disk helpers: `resourcePackRoot`, `resourcePackPath`, `writeZip`, `listHashes`, `deleteOld` |
| `backend/src/lib/resourcePackStorage.test.ts` | create | Tests for GC keeping last 3 hashes |
| `backend/src/lib/resourcePack.ts` | create | `rebuildResourcePack(serverKeyId)` orchestrator + `currentPackInfo(serverKeyId)` reader |
| `backend/src/lib/resourcePack.test.ts` | create | E2E test: insert glyph asset → rebuild → check disk + DB |
| `backend/src/routes/assets.ts` | modify | Await `rebuildResourcePack` after POST/PATCH/DELETE |
| `backend/src/routes/resourcePack.ts` | create | `GET /api/resource-pack/:sk/:hash.zip` + `POST /api/editor-session/:token/resource-pack/rebuild` |
| `backend/src/routes/resourcePack.test.ts` | create | Tests for serving + rebuild endpoints |
| `backend/src/app.ts` | modify | Mount `resourcePackRouter` on `/api/resource-pack` and `/api/editor-session` |
| `backend/src/protocol.ts` | modify | Add `ResourcePackUpdatedMessage`, extend `HelloAckMessage` with `resource_pack` field |
| `backend/src/ws/hub.ts` | modify | `pushResourcePackUpdated(serverKeyId)`; include `resource_pack` in `hello_ack` |
| `backend/src/ws/hub.test.ts` | modify | Test new push + extended hello_ack |

### Plugin

| File | Action | Responsibility |
|---|---|---|
| `plugin/src/main/kotlin/net/artisanmc/plugin/resourcepack/ResourcePackInfo.kt` | create | Data class `{ url, hash, sha1Bytes, uuid, prompt }` |
| `plugin/src/main/kotlin/net/artisanmc/plugin/resourcepack/ResourcePackManager.kt` | create | State + listeners + push to players |
| `plugin/src/test/kotlin/net/artisanmc/plugin/ResourcePackManagerTest.kt` | create | MockBukkit-based join + onUpdate tests |
| `plugin/src/main/kotlin/net/artisanmc/plugin/config/PluginConfig.kt` | modify | Add `resourcePack` block (`enabled`, `prompt`, `sendOnJoin`, `sendDelayTicks`) |
| `plugin/src/main/resources/config.yml` | modify | Add `resource-pack:` section |
| `plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt` | modify | Read `resource_pack` from `hello_ack` and handle `resource_pack_updated` WS message |
| `plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt` | modify | Instantiate `ResourcePackManager`, wire into `SyncedMenuProvider`, register listener |
| `plugin/src/test/kotlin/net/artisanmc/plugin/PluginConfigTest.kt` | modify (or create) | Confirm resource-pack defaults parsed |

### Docs

| File | Action |
|---|---|
| `CLAUDE.md` | Add new endpoints + WS message; bump test counts |

---

## Domain types (canonical)

Referenced across tasks:

```ts
// backend/src/lib/fontJsonBuilder.ts
export interface BitmapProvider {
  type: "bitmap";
  file: string;            // "artisan:font/<asset_name>.png"
  ascent: number;
  height: number;
  chars: string[];         // [single codepoint string]
}

export interface ReferenceProvider {
  type: "reference";
  id: string;              // "minecraft:default"
}

export interface DefaultFontJson {
  providers: Array<ReferenceProvider | BitmapProvider>;
}
```

```ts
// backend/src/lib/resourcePackBuilder.ts
import type { assets } from "../db/schema";
export type AssetRow = typeof assets.$inferSelect;
export interface GlyphInput { asset: AssetRow; pngBytes: Uint8Array }
export interface BuildResult { zipBytes: Uint8Array; hash: string }
```

```kotlin
// plugin/.../ResourcePackInfo.kt
data class ResourcePackInfo(
    val url: String,
    val hash: String,                 // 40-char hex
    val sha1Bytes: ByteArray,         // 20 bytes
    val uuid: java.util.UUID,         // UUID.nameUUIDFromBytes(hash.toByteArray(Charsets.UTF_8))
    val prompt: net.kyori.adventure.text.Component,
)
```

---

## Task 1: DB schema — add resource pack columns to `server_keys`

**Files:**
- Modify: `backend/src/db/schema.ts`

- [ ] **Step 1: Add the two columns to the existing `serverKeys` definition**

Replace the existing block (top of file) with:

```typescript
export const serverKeys = pgTable("server_keys", {
  id: text("id").primaryKey(),
  hash: text("hash").notNull(),
  label: text("label"),
  lastMcVersion: text("last_mc_version"),
  createdAt: timestamp("created_at").notNull(),
  resourcePackHash: text("resource_pack_hash"),
  resourcePackUpdatedAt: timestamp("resource_pack_updated_at"),
});
```

- [ ] **Step 2: Apply the schema to the dev database**

From `backend/`:
```bash
bun run db:push
```

Expected: Drizzle Kit prints `Changes applied`. The two new columns now exist on `server_keys`.

- [ ] **Step 3: Verify the columns exist**

```bash
psql "$DATABASE_URL" -c "\d server_keys"
```

Expected: shows `resource_pack_hash text` and `resource_pack_updated_at timestamp`, both nullable.

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/schema.ts
git commit -m "feat(backend): add resourcePackHash + resourcePackUpdatedAt to server_keys"
```

---

## Task 2: Font JSON builder (default.json)

Pure function that turns glyph assets into the `assets/artisan/font/default.json` shape. Skips assets without codepoints. Only handles `type=glyph` (fonts deferred to Sub-project 4).

**Files:**
- Create: `backend/src/lib/fontJsonBuilder.ts`
- Create: `backend/src/lib/fontJsonBuilder.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/lib/fontJsonBuilder.test.ts
import { describe, expect, test } from "bun:test";
import { buildDefaultFontJson } from "./fontJsonBuilder";

function glyph(over: Partial<{ id: string; name: string; ascent: number | null; codepoint: number | null; height: number; type: string }>) {
  return {
    id: over.id ?? "asset_g1",
    serverKeyId: "sk",
    type: over.type ?? "glyph",
    name: over.name ?? "coin",
    width: 8,
    height: over.height ?? 9,
    ascent: over.ascent ?? 8,
    codepoint: over.codepoint ?? 0xE000,
    fontMeta: null,
    contentHash: "h",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never;
}

describe("buildDefaultFontJson", () => {
  test("emits minecraft:default reference first", () => {
    const json = buildDefaultFontJson([]);
    expect(json.providers[0]).toEqual({ type: "reference", id: "minecraft:default" });
  });

  test("adds one bitmap provider per glyph", () => {
    const json = buildDefaultFontJson([
      glyph({ name: "coin", codepoint: 0xE000, ascent: 8, height: 9 }),
      glyph({ id: "asset_g2", name: "gem", codepoint: 0xE001, ascent: 7, height: 8 }),
    ]);
    expect(json.providers).toHaveLength(3);
    expect(json.providers[1]).toEqual({
      type: "bitmap",
      file: "artisan:font/coin.png",
      ascent: 8,
      height: 9,
      chars: ["\uE000"],
    });
    expect(json.providers[2]).toEqual({
      type: "bitmap",
      file: "artisan:font/gem.png",
      ascent: 7,
      height: 8,
      chars: ["\uE001"],
    });
  });

  test("skips glyphs with null codepoint", () => {
    const json = buildDefaultFontJson([glyph({ codepoint: null })]);
    expect(json.providers).toHaveLength(1);
  });

  test("skips non-glyph rows (texture, font)", () => {
    const json = buildDefaultFontJson([
      glyph({ type: "texture", codepoint: null }),
      glyph({ type: "font" }),
    ]);
    expect(json.providers).toHaveLength(1);
  });

  test("sorts providers by codepoint for deterministic output", () => {
    const json = buildDefaultFontJson([
      glyph({ id: "g_b", name: "b", codepoint: 0xE002 }),
      glyph({ id: "g_a", name: "a", codepoint: 0xE001 }),
    ]);
    expect((json.providers[1] as { file: string }).file).toBe("artisan:font/a.png");
    expect((json.providers[2] as { file: string }).file).toBe("artisan:font/b.png");
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

From `backend/`:
```bash
bun test src/lib/fontJsonBuilder.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the builder**

```typescript
// backend/src/lib/fontJsonBuilder.ts
import type { assets } from "../db/schema";

export type AssetRow = typeof assets.$inferSelect;

export interface BitmapProvider {
  type: "bitmap";
  file: string;
  ascent: number;
  height: number;
  chars: string[];
}

export interface ReferenceProvider {
  type: "reference";
  id: string;
}

export interface DefaultFontJson {
  providers: Array<ReferenceProvider | BitmapProvider>;
}

export function buildDefaultFontJson(assets: AssetRow[]): DefaultFontJson {
  const glyphs = assets
    .filter((a) => a.type === "glyph" && a.codepoint !== null && a.ascent !== null)
    .sort((a, b) => (a.codepoint ?? 0) - (b.codepoint ?? 0));

  const providers: Array<ReferenceProvider | BitmapProvider> = [
    { type: "reference", id: "minecraft:default" },
  ];
  for (const g of glyphs) {
    providers.push({
      type: "bitmap",
      file: `artisan:font/${g.name}.png`,
      ascent: g.ascent!,
      height: g.height,
      chars: [String.fromCodePoint(g.codepoint!)],
    });
  }
  return { providers };
}
```

- [ ] **Step 4: Run the test — verify it passes**

```bash
bun test src/lib/fontJsonBuilder.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/fontJsonBuilder.ts backend/src/lib/fontJsonBuilder.test.ts
git commit -m "feat(backend): default.json builder for glyph assets"
```

---

## Task 3: Resource pack zip builder

Pure function that takes the asset rows + their PNG bytes and produces a deterministic zip with `pack.mcmeta`, `pack.png`, font JSONs, and the bitmap PNGs. Uses `fflate.zipSync` (already a backend dep — see `customItems.ts`).

**Files:**
- Create: `backend/src/lib/resourcePackBuilder.ts`
- Create: `backend/src/lib/resourcePackBuilder.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/lib/resourcePackBuilder.test.ts
import { describe, expect, test } from "bun:test";
import { unzipSync, strFromU8 } from "fflate";
import { buildResourcePackZip } from "./resourcePackBuilder";

const PNG_1x1 = new Uint8Array([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
  0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
  0x42, 0x60, 0x82,
]);

function row(over: Partial<{ id: string; type: string; name: string; codepoint: number | null; ascent: number | null; height: number }>) {
  return {
    id: over.id ?? "asset_g1",
    serverKeyId: "sk",
    type: over.type ?? "glyph",
    name: over.name ?? "coin",
    width: 8,
    height: over.height ?? 9,
    ascent: over.ascent ?? 8,
    codepoint: over.codepoint ?? 0xE000,
    fontMeta: null,
    contentHash: "h",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never;
}

describe("buildResourcePackZip", () => {
  test("emits pack.mcmeta with format 22", () => {
    const { zipBytes } = buildResourcePackZip([], new Map());
    const entries = unzipSync(zipBytes);
    expect(entries["pack.mcmeta"]).toBeDefined();
    const meta = JSON.parse(strFromU8(entries["pack.mcmeta"]));
    expect(meta.pack.pack_format).toBe(22);
    expect(typeof meta.pack.description).toBe("string");
  });

  test("includes font/default.json with providers", () => {
    const g = row({ codepoint: 0xE000, name: "coin" });
    const pngs = new Map([[g.id, PNG_1x1]]);
    const { zipBytes } = buildResourcePackZip([g], pngs);
    const entries = unzipSync(zipBytes);
    const json = JSON.parse(strFromU8(entries["assets/artisan/font/default.json"]));
    expect(json.providers[0].id).toBe("minecraft:default");
    expect(json.providers[1].file).toBe("artisan:font/coin.png");
  });

  test("places glyph PNGs under assets/artisan/textures/font/<name>.png", () => {
    const g = row({ codepoint: 0xE000, name: "coin" });
    const pngs = new Map([[g.id, PNG_1x1]]);
    const { zipBytes } = buildResourcePackZip([g], pngs);
    const entries = unzipSync(zipBytes);
    expect(entries["assets/artisan/textures/font/coin.png"]).toBeDefined();
    expect(entries["assets/artisan/textures/font/coin.png"].length).toBe(PNG_1x1.length);
  });

  test("returns a stable SHA1 hex hash", () => {
    const { hash } = buildResourcePackZip([], new Map());
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
    const { hash: hash2 } = buildResourcePackZip([], new Map());
    expect(hash2).toBe(hash);
  });

  test("ignores assets without codepoints in the bitmap providers", () => {
    const t = row({ id: "asset_t1", type: "texture", name: "bg_one", codepoint: null, ascent: null });
    const pngs = new Map([[t.id, PNG_1x1]]);
    const { zipBytes } = buildResourcePackZip([t], pngs);
    const entries = unzipSync(zipBytes);
    const json = JSON.parse(strFromU8(entries["assets/artisan/font/default.json"]));
    expect(json.providers).toHaveLength(1);
    // textures without codepoint are NOT placed in the font/ directory
    expect(entries["assets/artisan/textures/font/bg_one.png"]).toBeUndefined();
  });

  test("hash changes when an asset is added", () => {
    const g = row({ codepoint: 0xE000, name: "coin" });
    const pngs = new Map([[g.id, PNG_1x1]]);
    const a = buildResourcePackZip([], new Map()).hash;
    const b = buildResourcePackZip([g], pngs).hash;
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
bun test src/lib/resourcePackBuilder.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the builder**

```typescript
// backend/src/lib/resourcePackBuilder.ts
import { createHash } from "crypto";
import { strToU8, zipSync } from "fflate";
import { buildDefaultFontJson, type AssetRow } from "./fontJsonBuilder";

export type { AssetRow };

export interface BuildResult {
  zipBytes: Uint8Array;
  hash: string;
}

const PACK_MCMETA = {
  pack: {
    pack_format: 22,           // Minecraft 1.21.x
    description: "Artisan pack",
  },
};

// 8x8 transparent PNG used as fallback pack.png (admin-customizable later).
const PACK_PNG_FALLBACK = new Uint8Array([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x08,
  0x08, 0x06, 0x00, 0x00, 0x00, 0xC4, 0x0F, 0xBE,
  0x8B, 0x00, 0x00, 0x00, 0x0F, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9C, 0x63, 0x60, 0x18, 0x05, 0xA3,
  0x60, 0x14, 0x8C, 0x02, 0x00, 0x00, 0x60, 0x00,
  0x01, 0x44, 0x40, 0xF4, 0xFC, 0x00, 0x00, 0x00,
  0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60,
  0x82,
]);

/**
 * Build a deterministic resource pack zip from the given assets.
 *
 * @param assets   All asset rows for the server_key (sorted/filtered internally).
 * @param glyphPngs Map of assetId → PNG bytes. Only required for assets with a codepoint.
 *                  Assets missing from the map are silently skipped.
 * @returns Zip bytes + SHA1 hex hash. Hash is the SHA1 of the zip bytes themselves.
 */
export function buildResourcePackZip(
  assets: AssetRow[],
  glyphPngs: Map<string, Uint8Array>,
): BuildResult {
  const files: Record<string, Uint8Array> = {};

  files["pack.mcmeta"] = strToU8(JSON.stringify(PACK_MCMETA, null, 2));
  files["pack.png"] = PACK_PNG_FALLBACK;

  const fontJson = buildDefaultFontJson(assets);
  files["assets/artisan/font/default.json"] = strToU8(JSON.stringify(fontJson, null, 2));

  // Sort glyphs by codepoint so the zip is deterministic regardless of input order.
  const glyphs = assets
    .filter((a) => a.type === "glyph" && a.codepoint !== null)
    .sort((a, b) => (a.codepoint ?? 0) - (b.codepoint ?? 0));
  for (const g of glyphs) {
    const png = glyphPngs.get(g.id);
    if (!png) continue;
    files[`assets/artisan/textures/font/${g.name}.png`] = png;
  }

  // `level: 0` (no deflate) keeps output byte-stable across machines and makes
  // hashing deterministic; pack zips are small (a few KB to ~MB).
  const zipBytes = zipSync(files, { level: 0 });
  const hash = createHash("sha1").update(zipBytes).digest("hex");
  return { zipBytes, hash };
}
```

- [ ] **Step 4: Run the test — verify it passes**

```bash
bun test src/lib/resourcePackBuilder.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/resourcePackBuilder.ts backend/src/lib/resourcePackBuilder.test.ts
git commit -m "feat(backend): resource pack zip builder (fflate)"
```

---

## Task 4: Resource pack disk storage + garbage collection

Helpers for writing the zip to `data/resource-packs/{serverKeyId}/{hash}.zip`, listing existing hashes, and pruning to the last 3.

**Files:**
- Create: `backend/src/lib/resourcePackStorage.ts`
- Create: `backend/src/lib/resourcePackStorage.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/lib/resourcePackStorage.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { rm } from "fs/promises";
import { join } from "path";
import {
  resourcePackRoot,
  resourcePackPath,
  writeResourcePack,
  listResourcePackHashes,
  pruneOldResourcePacks,
} from "./resourcePackStorage";

const TEST_SK = "sk-rp-test";

beforeEach(async () => { await rm(join(resourcePackRoot(), TEST_SK), { recursive: true, force: true }); });
afterEach(async () => { await rm(join(resourcePackRoot(), TEST_SK), { recursive: true, force: true }); });

describe("resourcePackStorage", () => {
  test("resourcePackPath returns expected layout", () => {
    const p = resourcePackPath(TEST_SK, "abc123");
    expect(p.endsWith(join(TEST_SK, "abc123.zip"))).toBe(true);
  });

  test("writeResourcePack creates the file", async () => {
    await writeResourcePack(TEST_SK, "hash_a", new Uint8Array([1, 2, 3]));
    expect(existsSync(resourcePackPath(TEST_SK, "hash_a"))).toBe(true);
  });

  test("writeResourcePack is idempotent when the same hash is written twice", async () => {
    await writeResourcePack(TEST_SK, "hash_b", new Uint8Array([1, 2, 3]));
    await writeResourcePack(TEST_SK, "hash_b", new Uint8Array([1, 2, 3])); // must not throw
    expect(existsSync(resourcePackPath(TEST_SK, "hash_b"))).toBe(true);
  });

  test("listResourcePackHashes returns hashes ordered by mtime descending", async () => {
    await writeResourcePack(TEST_SK, "h_first", new Uint8Array([1]));
    await new Promise((r) => setTimeout(r, 20));
    await writeResourcePack(TEST_SK, "h_second", new Uint8Array([2]));
    const list = await listResourcePackHashes(TEST_SK);
    expect(list[0]).toBe("h_second");
    expect(list[1]).toBe("h_first");
  });

  test("pruneOldResourcePacks keeps the last 3 by mtime", async () => {
    for (const h of ["h1", "h2", "h3", "h4", "h5"]) {
      await writeResourcePack(TEST_SK, h, new Uint8Array([1]));
      await new Promise((r) => setTimeout(r, 10));
    }
    await pruneOldResourcePacks(TEST_SK, 3);
    const remaining = await listResourcePackHashes(TEST_SK);
    expect(remaining.sort()).toEqual(["h3", "h4", "h5"]);
  });

  test("pruneOldResourcePacks never deletes the protectedHash even if old", async () => {
    for (const h of ["keep", "h1", "h2", "h3", "h4"]) {
      await writeResourcePack(TEST_SK, h, new Uint8Array([1]));
      await new Promise((r) => setTimeout(r, 10));
    }
    await pruneOldResourcePacks(TEST_SK, 3, "keep");
    const remaining = await listResourcePackHashes(TEST_SK);
    expect(remaining).toContain("keep");
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
bun test src/lib/resourcePackStorage.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

```typescript
// backend/src/lib/resourcePackStorage.ts
import { mkdir, readdir, stat, unlink, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve } from "path";

export function resourcePackRoot(): string {
  return resolve("data/resource-packs");
}

export function resourcePackPath(serverKeyId: string, hash: string): string {
  return join(resourcePackRoot(), serverKeyId, `${hash}.zip`);
}

export async function writeResourcePack(
  serverKeyId: string,
  hash: string,
  bytes: Uint8Array,
): Promise<void> {
  const dir = join(resourcePackRoot(), serverKeyId);
  await mkdir(dir, { recursive: true });
  await writeFile(resourcePackPath(serverKeyId, hash), bytes);
}

/** Returns the list of hashes for a server_key, newest first. */
export async function listResourcePackHashes(serverKeyId: string): Promise<string[]> {
  const dir = join(resourcePackRoot(), serverKeyId);
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  const zips = files.filter((f) => f.endsWith(".zip"));
  const withStats = await Promise.all(
    zips.map(async (f) => ({ hash: f.replace(/\.zip$/, ""), mtime: (await stat(join(dir, f))).mtimeMs })),
  );
  withStats.sort((a, b) => b.mtime - a.mtime);
  return withStats.map((x) => x.hash);
}

/**
 * Prune resource packs, keeping `keepCount` newest by mtime.
 * The optional `protectedHash` is never deleted even if it falls outside the window.
 */
export async function pruneOldResourcePacks(
  serverKeyId: string,
  keepCount: number,
  protectedHash?: string,
): Promise<void> {
  const all = await listResourcePackHashes(serverKeyId);
  const keep = new Set(all.slice(0, keepCount));
  if (protectedHash) keep.add(protectedHash);
  for (const hash of all) {
    if (keep.has(hash)) continue;
    try {
      await unlink(resourcePackPath(serverKeyId, hash));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}
```

- [ ] **Step 4: Run the test — verify it passes**

```bash
bun test src/lib/resourcePackStorage.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/resourcePackStorage.ts backend/src/lib/resourcePackStorage.test.ts
git commit -m "feat(backend): resource pack disk storage + GC"
```

---

## Task 5: Resource pack orchestrator — `rebuildResourcePack`

Ties everything together: read all assets, load glyph PNGs from disk, build zip, write to disk, update `server_keys`, prune old packs. Also exposes a `currentPackInfo(serverKeyId)` reader used by the WS hub.

**Files:**
- Create: `backend/src/lib/resourcePack.ts`
- Create: `backend/src/lib/resourcePack.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/lib/resourcePack.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { existsSync, readFileSync } from "fs";
import { rm } from "fs/promises";
import { db } from "../db/index";
import { assets, serverKeys } from "../db/schema";
import { writeAssetFile, assetRoot } from "./assetStorage";
import { resourcePackRoot, resourcePackPath } from "./resourcePackStorage";
import { rebuildResourcePack, currentPackInfo } from "./resourcePack";
import { join } from "path";

const PNG_1x1 = new Uint8Array([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
  0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
  0x42, 0x60, 0x82,
]);

async function seedServerKey(): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(serverKeys).values({ id, hash: "h" + id.slice(0, 8), createdAt: new Date() });
  return id;
}

async function seedGlyph(sk: string, name: string, codepoint: number): Promise<string> {
  const id = "asset_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  await db.insert(assets).values({
    id, serverKeyId: sk, type: "glyph", name,
    width: 1, height: 1, ascent: 0, codepoint, fontMeta: null,
    contentHash: "h" + name, createdAt: new Date(), updatedAt: new Date(),
  });
  await writeAssetFile(sk, id, PNG_1x1);
  return id;
}

let serverKeyId: string;

beforeEach(async () => { serverKeyId = await seedServerKey(); });
afterEach(async () => {
  await rm(join(resourcePackRoot(), serverKeyId), { recursive: true, force: true });
  await rm(join(assetRoot(), serverKeyId), { recursive: true, force: true });
});

describe("rebuildResourcePack", () => {
  test("writes a zip and updates server_keys columns", async () => {
    await seedGlyph(serverKeyId, "coin", 0xE000);
    const { hash, url } = await rebuildResourcePack(serverKeyId);
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
    expect(url).toMatch(new RegExp(`/api/resource-pack/${serverKeyId}/${hash}\\.zip$`));
    expect(existsSync(resourcePackPath(serverKeyId, hash))).toBe(true);

    const rows = await db.select().from(serverKeys).where(eq(serverKeys.id, serverKeyId));
    expect(rows[0].resourcePackHash).toBe(hash);
    expect(rows[0].resourcePackUpdatedAt).toBeInstanceOf(Date);
  });

  test("two consecutive rebuilds with same assets produce the same hash", async () => {
    await seedGlyph(serverKeyId, "coin", 0xE000);
    const r1 = await rebuildResourcePack(serverKeyId);
    const r2 = await rebuildResourcePack(serverKeyId);
    expect(r1.hash).toBe(r2.hash);
  });

  test("adding a glyph changes the hash", async () => {
    const r1 = await rebuildResourcePack(serverKeyId);
    await seedGlyph(serverKeyId, "coin", 0xE000);
    const r2 = await rebuildResourcePack(serverKeyId);
    expect(r2.hash).not.toBe(r1.hash);
  });

  test("keeps at most 3 packs on disk plus the current one", async () => {
    // 5 distinct rebuilds with different content
    for (let i = 0; i < 5; i++) {
      await seedGlyph(serverKeyId, `g${i}`, 0xE000 + i);
      await rebuildResourcePack(serverKeyId);
      await new Promise((r) => setTimeout(r, 15));
    }
    const { hash } = await rebuildResourcePack(serverKeyId);
    expect(existsSync(resourcePackPath(serverKeyId, hash))).toBe(true);

    const { readdir } = await import("fs/promises");
    const files = await readdir(join(resourcePackRoot(), serverKeyId));
    // last 3 + protectedHash (== last hash, already in the 3) → exactly 3
    expect(files.filter((f) => f.endsWith(".zip")).length).toBeLessThanOrEqual(3);
  });

  test("currentPackInfo returns null when never built", async () => {
    expect(await currentPackInfo(serverKeyId)).toBeNull();
  });

  test("currentPackInfo returns { url, hash } after a build", async () => {
    await seedGlyph(serverKeyId, "coin", 0xE000);
    const { hash } = await rebuildResourcePack(serverKeyId);
    const info = await currentPackInfo(serverKeyId);
    expect(info).not.toBeNull();
    expect(info!.hash).toBe(hash);
    expect(info!.url.endsWith(`/api/resource-pack/${serverKeyId}/${hash}.zip`)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
bun test src/lib/resourcePack.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the orchestrator**

```typescript
// backend/src/lib/resourcePack.ts
import { eq } from "drizzle-orm";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { db } from "../db/index";
import { assets, serverKeys } from "../db/schema";
import { assetPath } from "./assetStorage";
import { buildResourcePackZip } from "./resourcePackBuilder";
import {
  listResourcePackHashes,
  pruneOldResourcePacks,
  resourcePackPath,
  writeResourcePack,
} from "./resourcePackStorage";

const BUNDLE_BASE_URL = process.env.BUNDLE_BASE_URL ?? process.env.API_BASE_URL ?? "http://localhost:3001";
const KEEP_PACK_COUNT = 3;

export interface PackInfo {
  url: string;
  hash: string;
}

export async function rebuildResourcePack(serverKeyId: string): Promise<PackInfo> {
  const rows = await db.select().from(assets).where(eq(assets.serverKeyId, serverKeyId));

  // Load glyph PNGs (only assets with a codepoint are placed in the font/ dir)
  const glyphPngs = new Map<string, Uint8Array>();
  for (const a of rows) {
    if (a.type !== "glyph" || a.codepoint === null) continue;
    const p = assetPath(serverKeyId, a.id);
    if (!existsSync(p)) continue;
    glyphPngs.set(a.id, new Uint8Array(await readFile(p)));
  }

  const { zipBytes, hash } = buildResourcePackZip(rows, glyphPngs);
  await writeResourcePack(serverKeyId, hash, zipBytes);

  await db.update(serverKeys)
    .set({ resourcePackHash: hash, resourcePackUpdatedAt: new Date() })
    .where(eq(serverKeys.id, serverKeyId));

  // GC old packs but always protect the current hash.
  await pruneOldResourcePacks(serverKeyId, KEEP_PACK_COUNT, hash);

  return { url: buildPackUrl(serverKeyId, hash), hash };
}

export async function currentPackInfo(serverKeyId: string): Promise<PackInfo | null> {
  const rows = await db
    .select({ hash: serverKeys.resourcePackHash })
    .from(serverKeys)
    .where(eq(serverKeys.id, serverKeyId));
  const hash = rows[0]?.hash;
  if (!hash) return null;
  if (!existsSync(resourcePackPath(serverKeyId, hash))) return null;
  return { url: buildPackUrl(serverKeyId, hash), hash };
}

function buildPackUrl(serverKeyId: string, hash: string): string {
  return `${BUNDLE_BASE_URL}/api/resource-pack/${serverKeyId}/${hash}.zip`;
}
```

- [ ] **Step 4: Run the test — verify it passes**

```bash
bun test src/lib/resourcePack.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/resourcePack.ts backend/src/lib/resourcePack.test.ts
git commit -m "feat(backend): rebuildResourcePack orchestrator + currentPackInfo"
```

---

## Task 6: HTTP serving + manual rebuild endpoints

Two new endpoints:
- `GET /api/resource-pack/:serverKeyId/:hash.zip` — public, serves the zip with immutable cache + ETag.
- `POST /api/editor-session/:token/resource-pack/rebuild` — admin trigger.

**Files:**
- Create: `backend/src/routes/resourcePack.ts`
- Create: `backend/src/routes/resourcePack.test.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/routes/resourcePack.test.ts
import { describe, expect, test } from "bun:test";
import { app } from "../app";
import { db } from "../db/index";
import { editorSessions, serverKeys } from "../db/schema";
import { eq } from "drizzle-orm";

async function seedSession(): Promise<{ token: string; serverKeyId: string }> {
  const serverKeyId = crypto.randomUUID();
  await db.insert(serverKeys).values({ id: serverKeyId, hash: "h" + serverKeyId.slice(0, 8), createdAt: new Date() });
  const token = crypto.randomUUID();
  const now = new Date();
  await db.insert(editorSessions).values({
    token, serverKeyId, createdBy: "test", createdAt: now,
    expiresAt: new Date(now.getTime() + 3600_000),
    accessToken: token, accessExpiresAt: new Date(now.getTime() + 3600_000),
  });
  return { token, serverKeyId };
}

describe("POST /api/editor-session/:token/resource-pack/rebuild", () => {
  test("rebuilds and returns hash + url", async () => {
    const { token, serverKeyId } = await seedSession();
    const res = await app.request(`/api/editor-session/${token}/resource-pack/rebuild`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(body.url).toMatch(new RegExp(`/api/resource-pack/${serverKeyId}/${body.hash}\\.zip$`));

    const rows = await db.select().from(serverKeys).where(eq(serverKeys.id, serverKeyId));
    expect(rows[0].resourcePackHash).toBe(body.hash);
  });

  test("rejects unauthorized token", async () => {
    const res = await app.request(`/api/editor-session/bogus/resource-pack/rebuild`, { method: "POST" });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/resource-pack/:serverKeyId/:hash.zip", () => {
  test("serves the zip with immutable cache + ETag headers", async () => {
    const { token, serverKeyId } = await seedSession();
    const rebuild = await app.request(`/api/editor-session/${token}/resource-pack/rebuild`, { method: "POST" });
    const { hash } = await rebuild.json();

    const res = await app.request(`/api/resource-pack/${serverKeyId}/${hash}.zip`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("ETag")).toBe(`"${hash}"`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
  });

  test("404 when hash file does not exist", async () => {
    const res = await app.request(`/api/resource-pack/some-sk/deadbeef.zip`);
    expect(res.status).toBe(404);
  });

  test("rejects path traversal attempts", async () => {
    const res = await app.request(`/api/resource-pack/sk/..%2Fevil.zip`);
    expect([400, 404]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
bun test src/routes/resourcePack.test.ts
```

Expected: 404 — routes not registered yet.

- [ ] **Step 3: Implement the router**

```typescript
// backend/src/routes/resourcePack.ts
import { Hono } from "hono";
import { existsSync } from "fs";
import { validateAccessToken } from "../lib/auth";
import { rebuildResourcePack } from "../lib/resourcePack";
import { resourcePackPath } from "../lib/resourcePackStorage";
import { pushResourcePackUpdated } from "../ws/hub";

const HASH_RE = /^[0-9a-f]{40}$/;
const SK_RE = /^[a-zA-Z0-9-]+$/;

export const resourcePackPublicRouter = new Hono();
export const resourcePackAdminRouter = new Hono();

// Public endpoint: GET /api/resource-pack/:serverKeyId/:hash.zip
resourcePackPublicRouter.get("/:serverKeyId/:hashFile", async (c) => {
  const serverKeyId = c.req.param("serverKeyId");
  const hashFile = c.req.param("hashFile");
  if (!SK_RE.test(serverKeyId)) return c.newResponse(null, 400);
  if (!hashFile.endsWith(".zip")) return c.newResponse(null, 404);
  const hash = hashFile.slice(0, -4);
  if (!HASH_RE.test(hash)) return c.newResponse(null, 400);

  const filePath = resourcePackPath(serverKeyId, hash);
  if (!existsSync(filePath)) return c.newResponse(null, 404);

  return new Response(Bun.file(filePath), {
    headers: {
      "Content-Type": "application/zip",
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: `"${hash}"`,
    },
  });
});

// Admin trigger: POST /api/editor-session/:token/resource-pack/rebuild
resourcePackAdminRouter.post("/:token/resource-pack/rebuild", async (c) => {
  const token = c.req.param("token");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const info = await rebuildResourcePack(session.serverKeyId);
  pushResourcePackUpdated(session.serverKeyId, info.url, info.hash);
  return c.json(info);
});
```

- [ ] **Step 4: Add a temporary stub for `pushResourcePackUpdated` so the import resolves**

Append to `backend/src/ws/hub.ts` (will be fleshed out in Task 8):

```typescript
export function pushResourcePackUpdated(_serverKeyId: string, _url: string, _hash: string): void {
  // Implemented in Task 8
}
```

- [ ] **Step 5: Mount the routers in `app.ts`**

Add to imports:
```typescript
import { resourcePackPublicRouter, resourcePackAdminRouter } from "./routes/resourcePack";
```

After the existing `app.route(...)` lines:
```typescript
app.route("/api/resource-pack", resourcePackPublicRouter);
app.route("/api/editor-session", resourcePackAdminRouter);
```

- [ ] **Step 6: Run the test — verify it passes**

```bash
bun test src/routes/resourcePack.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/resourcePack.ts backend/src/routes/resourcePack.test.ts backend/src/app.ts backend/src/ws/hub.ts
git commit -m "feat(backend): GET resource pack zip + POST rebuild endpoints"
```

---

## Task 7: Wire `rebuildResourcePack` into asset CRUD triggers

After every successful asset POST / PATCH / DELETE, regenerate the resource pack synchronously and broadcast the WS update. Sync because (a) the next editor refresh expects the new hash to be queryable immediately, and (b) packs are small.

**Files:**
- Modify: `backend/src/routes/assets.ts`
- Modify: `backend/src/routes/assets.test.ts`

- [ ] **Step 1: Add a failing test that asserts asset changes update `server_keys.resourcePackHash`**

Append to `backend/src/routes/assets.test.ts`:

```typescript
import { eq as eqDrizzle } from "drizzle-orm";

describe("resource pack regeneration on asset mutations", () => {
  test("POST asset triggers a resource pack rebuild", async () => {
    const { token, serverKeyId } = await seedSession();
    const res = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST", body: uploadForm({ type: "glyph", name: "rp_one", ascent: "7" }),
    });
    expect(res.status).toBe(201);

    const rows = await db.select().from(serverKeys).where(eqDrizzle(serverKeys.id, serverKeyId));
    expect(rows[0].resourcePackHash).toMatch(/^[0-9a-f]{40}$/);
    expect(rows[0].resourcePackUpdatedAt).toBeInstanceOf(Date);
  });

  test("PATCH asset rebuilds the pack and changes the hash", async () => {
    const { token, serverKeyId } = await seedSession();
    const post = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST", body: uploadForm({ type: "glyph", name: "g_orig", ascent: "7" }),
    });
    const created = (await post.json()).asset;
    const before = (await db.select().from(serverKeys).where(eqDrizzle(serverKeys.id, serverKeyId)))[0].resourcePackHash;

    const patch = await app.request(`/api/editor-session/${token}/assets/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "g_renamed" }),
    });
    expect(patch.status).toBe(200);
    const after = (await db.select().from(serverKeys).where(eqDrizzle(serverKeys.id, serverKeyId)))[0].resourcePackHash;
    expect(after).not.toBe(before);
  });

  test("DELETE asset rebuilds the pack", async () => {
    const { token, serverKeyId } = await seedSession();
    const post = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST", body: uploadForm({ type: "glyph", name: "g_del", ascent: "7" }),
    });
    const created = (await post.json()).asset;
    const before = (await db.select().from(serverKeys).where(eqDrizzle(serverKeys.id, serverKeyId)))[0].resourcePackHash;

    const del = await app.request(`/api/editor-session/${token}/assets/${created.id}`, { method: "DELETE" });
    expect(del.status).toBe(204);
    const after = (await db.select().from(serverKeys).where(eqDrizzle(serverKeys.id, serverKeyId)))[0].resourcePackHash;
    expect(after).not.toBe(before);
  });
});
```

Also add this import at the top of `assets.test.ts`:
```typescript
import { serverKeys } from "../db/schema";
```

(It is already imported in some test contexts — if you see a duplicate, keep the existing import.)

- [ ] **Step 2: Run the test — verify it fails**

```bash
bun test src/routes/assets.test.ts
```

Expected: new tests fail (hash stays `null`).

- [ ] **Step 3: Wire the trigger into the asset router**

In `backend/src/routes/assets.ts`, add the import:
```typescript
import { rebuildResourcePack } from "../lib/resourcePack";
import { pushResourcePackUpdated } from "../ws/hub";
```

After every successful POST/PATCH/DELETE handler (right before each `return c.json(...)` of the success path), insert:
```typescript
try {
  const info = await rebuildResourcePack(session.serverKeyId);
  pushResourcePackUpdated(session.serverKeyId, info.url, info.hash);
} catch (err) {
  console.error("[resource-pack] rebuild failed:", err);
}
```

Specifically:
- POST handler: insert immediately after the row is re-selected (`const created = ...`) and before `return c.json({ asset: serialize(created) }, 201);`. Also apply in the dedup early-return path (status 200) so re-uploads keep the pack consistent — but **only if** an earlier rebuild was actually missing; in practice it's safe to call the rebuild unconditionally because it is idempotent for identical input.
- PATCH handler: insert after `const updated = ...` and before `return c.json({ asset: serialize(updated) });`.
- DELETE handler: insert after `await deleteAssetFile(...)` and before `return c.body(null, 204);`.

- [ ] **Step 4: Run the tests — verify they pass**

```bash
bun test src/routes/assets.test.ts
```

Expected: all asset tests pass (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/assets.ts backend/src/routes/assets.test.ts
git commit -m "feat(backend): trigger resource pack rebuild on asset CRUD"
```

---

## Task 8: WS protocol — extend `hello_ack` + add `resource_pack_updated`

The plugin learns the current pack at connect time (via `hello_ack.resource_pack`) and is notified of subsequent changes via `resource_pack_updated`. Replace the stub from Task 6 with a real broadcast.

**Files:**
- Modify: `backend/src/protocol.ts`
- Modify: `backend/src/ws/hub.ts`
- Modify: `backend/src/ws/hub.test.ts`

- [ ] **Step 1: Extend the protocol types**

In `backend/src/protocol.ts`:

```typescript
// Extend HelloAckMessage:
export interface HelloAckMessage {
  type: "hello_ack";
  session_id: string;
  server_id: string;
  tier: "free" | "crew" | "network";
  needs_sync: boolean;
  latest_bundle_hash: string;
  api_url: string;
  bundle_url: string;
  pack_hashes: Record<string, string>;
  resource_pack: { url: string; hash: string } | null;
}

// New message:
export interface ResourcePackUpdatedMessage {
  type: "resource_pack_updated";
  url: string;
  hash: string;
}
```

Add `ResourcePackUpdatedMessage` to the `ServerToPluginMessage` union at the bottom of the file.

- [ ] **Step 2: Update the failing hub test**

In `backend/src/ws/hub.test.ts`, find the existing `hello_ack` test (or add a new one) and assert:

```typescript
test("hello_ack includes resource_pack: null when never built", async () => {
  // ... existing setup that drives a hello message through handlePluginMessage ...
  const ack = JSON.parse(result.reply!);
  expect(ack.type).toBe("hello_ack");
  expect(ack.resource_pack).toBeNull();
});

test("hello_ack includes resource_pack info when pack was built", async () => {
  const sk = await /* seed server key */;
  // build one pack
  const { rebuildResourcePack } = await import("../lib/resourcePack");
  const info = await rebuildResourcePack(sk);

  // drive a hello for that sk and decode the ack
  // ... expect ack.resource_pack to equal { url: info.url, hash: info.hash } ...
});

test("pushResourcePackUpdated broadcasts to all plugin connections for the serverKey", () => {
  const captured: string[] = [];
  const otherCaptured: string[] = [];
  // register two conns: one bound to sk, one to a different sk
  registerConn("conn-a", (m) => captured.push(m));
  registerConn("conn-b", (m) => otherCaptured.push(m));
  connToServerId.set("conn-a", "sk-target");
  connToServerId.set("conn-b", "sk-other");

  pushResourcePackUpdated("sk-target", "http://x/y.zip", "abc");
  expect(captured.some((m) => JSON.parse(m).type === "resource_pack_updated")).toBe(true);
  expect(otherCaptured).toEqual([]);
});
```

(Use the existing test file's patterns; the conn maps `connToServerId` and `connSenders` are already exported.)

- [ ] **Step 3: Run the test — verify it fails**

```bash
bun test src/ws/hub.test.ts
```

Expected: new assertions fail (resource_pack missing, broadcast not implemented).

- [ ] **Step 4: Implement the changes in `hub.ts`**

At the top of `hub.ts`, add:
```typescript
import { currentPackInfo } from "../lib/resourcePack";
import type { ResourcePackUpdatedMessage } from "../protocol";
```

In `handlePluginMessage` → `if (msg.type === "hello")` branch, after `const packHashesMap: Record<string, string> = {};`, compute the resource pack info and add it to the `ack`:

```typescript
const rp = await currentPackInfo(keyId);

const ack: HelloAckMessage = {
  type: "hello_ack",
  session_id: sessionId,
  server_id: keyId,
  tier: "free",
  needs_sync: needsSync,
  latest_bundle_hash: latestHash,
  api_url: API_BASE_URL,
  bundle_url: BUNDLE_BASE_URL,
  pack_hashes: packHashesMap,
  resource_pack: rp,
};
```

Replace the stub `pushResourcePackUpdated` (added in Task 6) with the real implementation:

```typescript
export function pushResourcePackUpdated(serverKeyId: string, url: string, hash: string): void {
  const payload = JSON.stringify({
    type: "resource_pack_updated",
    url,
    hash,
  } satisfies ResourcePackUpdatedMessage);
  for (const [connId, sId] of connToServerId) {
    if (sId !== serverKeyId) continue;
    const send = connSenders.get(connId);
    if (send) send(payload);
  }
}
```

- [ ] **Step 5: Run the tests — verify they pass**

```bash
bun test src/ws/hub.test.ts
bun test src/routes/resourcePack.test.ts
bun test src/routes/assets.test.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/protocol.ts backend/src/ws/hub.ts backend/src/ws/hub.test.ts
git commit -m "feat(backend): WS resource_pack_updated + hello_ack resource_pack field"
```

---

## Task 9: Plugin — `ResourcePackInfo` data class + config

Plain-data wrapper + config plumbing. No Bukkit hooks yet (next task).

**Files:**
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/resourcepack/ResourcePackInfo.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/config/PluginConfig.kt`
- Modify: `plugin/src/main/resources/config.yml`

- [ ] **Step 1: Add the `resource-pack:` section to `config.yml`**

```yaml
# Resource pack pushed by Artisan (independent from Oraxen/Nexo/ItemsAdder packs;
# uses the 1.20.3+ pack stack so it coexists with other packs side-by-side).
resource-pack:
  enabled: true
  prompt: "<gold>Pack Artisan</gold>"
  send-on-join: true
  send-delay-ticks: 20
```

- [ ] **Step 2: Extend `PluginConfig` to parse the new block**

Replace the body of `PluginConfig.kt` with:

```kotlin
package net.artisanmc.plugin.config

import org.bukkit.configuration.file.FileConfiguration

data class ResourcePackConfig(
    val enabled: Boolean,
    val prompt: String,
    val sendOnJoin: Boolean,
    val sendDelayTicks: Long,
)

data class PluginConfig(
    val serverKey: String,
    val wsUrl: String,
    val editorConsoleOnly: Boolean,
    val language: String,
    val perPlayerLanguage: Boolean,
    val resourcePack: ResourcePackConfig,
) {
    companion object {
        fun from(cfg: FileConfiguration) = PluginConfig(
            serverKey         = cfg.getString("server_key", "") ?: "",
            wsUrl             = cfg.getString("ws_url", "wss://editor.artisanmc.net/ws/plugin") ?: "",
            editorConsoleOnly = cfg.getBoolean("editor.console_only", false),
            language          = cfg.getString("language", "en") ?: "en",
            perPlayerLanguage = cfg.getBoolean("per_player_language", false),
            resourcePack      = ResourcePackConfig(
                enabled        = cfg.getBoolean("resource-pack.enabled", true),
                prompt         = cfg.getString("resource-pack.prompt", "<gold>Pack Artisan</gold>") ?: "<gold>Pack Artisan</gold>",
                sendOnJoin     = cfg.getBoolean("resource-pack.send-on-join", true),
                sendDelayTicks = cfg.getLong("resource-pack.send-delay-ticks", 20L),
            ),
        )
    }
}
```

- [ ] **Step 3: Create `ResourcePackInfo`**

```kotlin
// plugin/src/main/kotlin/net/artisanmc/plugin/resourcepack/ResourcePackInfo.kt
package net.artisanmc.plugin.resourcepack

import net.kyori.adventure.text.Component
import net.kyori.adventure.text.minimessage.MiniMessage
import java.util.UUID

data class ResourcePackInfo(
    val url: String,
    val hash: String,                                  // 40-char hex SHA1
    val sha1Bytes: ByteArray,                          // 20 bytes
    val uuid: UUID,                                    // UUID.nameUUIDFromBytes(hash.toByteArray(Charsets.UTF_8))
    val prompt: Component,
) {
    companion object {
        fun from(url: String, hash: String, promptMini: String): ResourcePackInfo {
            require(hash.length == 40) { "hash must be 40 hex chars, got ${hash.length}" }
            val sha1 = ByteArray(20)
            for (i in 0 until 20) {
                sha1[i] = ((Character.digit(hash[i * 2], 16) shl 4) or Character.digit(hash[i * 2 + 1], 16)).toByte()
            }
            val uuid = UUID.nameUUIDFromBytes(hash.toByteArray(Charsets.UTF_8))
            val component = MiniMessage.miniMessage().deserialize(promptMini)
            return ResourcePackInfo(url, hash, sha1, uuid, component)
        }
    }

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is ResourcePackInfo) return false
        return url == other.url && hash == other.hash && uuid == other.uuid
    }

    override fun hashCode(): Int = 31 * url.hashCode() + hash.hashCode()
}
```

- [ ] **Step 4: Verify config plumbing**

If `PluginConfigTest.kt` already exists, add a case asserting defaults. Otherwise create one:

```kotlin
// plugin/src/test/kotlin/net/artisanmc/plugin/PluginConfigTest.kt
package net.artisanmc.plugin

import net.artisanmc.plugin.config.PluginConfig
import org.bukkit.configuration.file.YamlConfiguration
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PluginConfigTest {
    @Test
    fun `resource-pack defaults parsed correctly`() {
        val yaml = YamlConfiguration()
        yaml.loadFromString("""
            server_key: ""
            ws_url: "ws://x"
            language: "en"
            per_player_language: false
            resource-pack:
              enabled: true
              prompt: "<gold>Pack</gold>"
              send-on-join: true
              send-delay-ticks: 20
        """.trimIndent())
        val cfg = PluginConfig.from(yaml)
        assertTrue(cfg.resourcePack.enabled)
        assertEquals(20L, cfg.resourcePack.sendDelayTicks)
        assertTrue(cfg.resourcePack.sendOnJoin)
    }

    @Test
    fun `resource-pack missing block falls back to defaults`() {
        val yaml = YamlConfiguration()
        yaml.loadFromString("""
            server_key: ""
            ws_url: "ws://x"
            language: "en"
            per_player_language: false
        """.trimIndent())
        val cfg = PluginConfig.from(yaml)
        assertTrue(cfg.resourcePack.enabled)
        assertEquals(20L, cfg.resourcePack.sendDelayTicks)
    }
}
```

- [ ] **Step 5: Run the tests**

From `plugin/`:
```bash
./gradlew test --tests "net.artisanmc.plugin.PluginConfigTest"
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/plugin/resourcepack/ResourcePackInfo.kt \
        plugin/src/main/kotlin/net/artisanmc/plugin/config/PluginConfig.kt \
        plugin/src/main/resources/config.yml \
        plugin/src/test/kotlin/net/artisanmc/plugin/PluginConfigTest.kt
git commit -m "feat(plugin): ResourcePackInfo + config block"
```

---

## Task 10: Plugin — `ResourcePackManager`

Holds the current pack info. Listens to `PlayerJoinEvent` (with configurable tick delay) → pushes the pack. Exposes `onUpdate(info)` for the WS handler to call, which updates state + re-pushes to all online players. Listens to `PlayerResourcePackStatusEvent` for logging.

**Files:**
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/resourcepack/ResourcePackManager.kt`
- Create: `plugin/src/test/kotlin/net/artisanmc/plugin/ResourcePackManagerTest.kt`

- [ ] **Step 1: Write the failing test**

```kotlin
// plugin/src/test/kotlin/net/artisanmc/plugin/ResourcePackManagerTest.kt
package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import be.seeseemelk.mockbukkit.ServerMock
import net.artisanmc.plugin.config.ResourcePackConfig
import net.artisanmc.plugin.resourcepack.ResourcePackInfo
import net.artisanmc.plugin.resourcepack.ResourcePackManager
import kotlin.test.*

class ResourcePackManagerTest {
    private lateinit var server: ServerMock
    private lateinit var plugin: ArtisanPlugin

    @BeforeTest
    fun setup() {
        server = MockBukkit.mock()
        plugin = MockBukkit.load(ArtisanPlugin::class.java)
    }

    @AfterTest
    fun teardown() { MockBukkit.unmock() }

    private fun config(enabled: Boolean = true, sendOnJoin: Boolean = true, delayTicks: Long = 0L) =
        ResourcePackConfig(enabled = enabled, prompt = "<gold>x</gold>", sendOnJoin = sendOnJoin, sendDelayTicks = delayTicks)

    private val SAMPLE_HASH = "0".repeat(40)

    @Test
    fun `from() produces stable UUID for the same hash`() {
        val a = ResourcePackInfo.from("http://x", SAMPLE_HASH, "<gold>x</gold>")
        val b = ResourcePackInfo.from("http://y", SAMPLE_HASH, "<red>y</red>")
        assertEquals(a.uuid, b.uuid)  // UUID is keyed on hash only
    }

    @Test
    fun `sha1Bytes is decoded from the hex hash`() {
        val info = ResourcePackInfo.from("http://x", "ff00".repeat(10), "<gold>x</gold>")
        assertEquals(20, info.sha1Bytes.size)
        assertEquals(0xff.toByte(), info.sha1Bytes[0])
        assertEquals(0x00.toByte(), info.sha1Bytes[1])
    }

    @Test
    fun `manager starts with no current pack`() {
        val mgr = ResourcePackManager(plugin, config(), logger = plugin.logger)
        assertNull(mgr.currentPackInfo)
    }

    @Test
    fun `onUpdate stores the info`() {
        val mgr = ResourcePackManager(plugin, config(), logger = plugin.logger)
        val info = ResourcePackInfo.from("http://x", SAMPLE_HASH, "<gold>x</gold>")
        mgr.onUpdate(info)
        assertEquals(info, mgr.currentPackInfo)
    }

    @Test
    fun `onUpdate with null clears the state`() {
        val mgr = ResourcePackManager(plugin, config(), logger = plugin.logger)
        mgr.onUpdate(ResourcePackInfo.from("http://x", SAMPLE_HASH, "<gold>x</gold>"))
        mgr.onUpdate(null)
        assertNull(mgr.currentPackInfo)
    }

    @Test
    fun `pushToPlayer is a no-op when currentPackInfo is null`() {
        val mgr = ResourcePackManager(plugin, config(), logger = plugin.logger)
        val player = server.addPlayer()
        mgr.pushToPlayer(player)  // must not throw
    }

    @Test
    fun `pushToPlayer is a no-op when disabled`() {
        val mgr = ResourcePackManager(plugin, config(enabled = false), logger = plugin.logger)
        mgr.onUpdate(ResourcePackInfo.from("http://x", SAMPLE_HASH, "<gold>x</gold>"))
        val player = server.addPlayer()
        mgr.pushToPlayer(player)  // must not throw
    }

    @Test
    fun `onJoin pushes only if send-on-join is true`() {
        val mgr = ResourcePackManager(plugin, config(sendOnJoin = false, delayTicks = 0L), logger = plugin.logger)
        mgr.onUpdate(ResourcePackInfo.from("http://x", SAMPLE_HASH, "<gold>x</gold>"))
        val player = server.addPlayer()
        // explicit join handler call — must not call setResourcePack
        mgr.onJoin(player)
        // (MockBukkit's Player does not expose direct setResourcePack inspection; the assertion
        // is the absence of exception + log line presence is verified manually.)
    }
}
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
./gradlew test --tests "net.artisanmc.plugin.ResourcePackManagerTest"
```

Expected: FAIL — class not found.

- [ ] **Step 3: Implement the manager**

```kotlin
// plugin/src/main/kotlin/net/artisanmc/plugin/resourcepack/ResourcePackManager.kt
package net.artisanmc.plugin.resourcepack

import net.artisanmc.plugin.config.ResourcePackConfig
import org.bukkit.entity.Player
import org.bukkit.event.EventHandler
import org.bukkit.event.Listener
import org.bukkit.event.player.PlayerJoinEvent
import org.bukkit.event.player.PlayerResourcePackStatusEvent
import org.bukkit.plugin.java.JavaPlugin
import java.util.logging.Logger

class ResourcePackManager(
    private val plugin: JavaPlugin,
    private val config: ResourcePackConfig,
    private val logger: Logger? = null,
) : Listener {

    @Volatile
    var currentPackInfo: ResourcePackInfo? = null
        private set

    fun onUpdate(info: ResourcePackInfo?) {
        currentPackInfo = info
        if (info == null) return
        if (!config.enabled) return
        // Re-push to all currently online players (no delay; they're already in).
        for (player in plugin.server.onlinePlayers) {
            pushToPlayer(player)
        }
    }

    fun pushToPlayer(player: Player) {
        if (!config.enabled) return
        val info = currentPackInfo ?: return
        try {
            player.setResourcePack(info.uuid, info.url, info.sha1Bytes, info.prompt, false)
        } catch (t: Throwable) {
            logger?.warning("[resource-pack] setResourcePack failed for ${player.name}: ${t.message}")
        }
    }

    fun onJoin(player: Player) {
        if (!config.enabled || !config.sendOnJoin) return
        if (config.sendDelayTicks <= 0L) {
            pushToPlayer(player)
        } else {
            plugin.server.scheduler.runTaskLater(plugin, Runnable { pushToPlayer(player) }, config.sendDelayTicks)
        }
    }

    @EventHandler
    fun onPlayerJoin(event: PlayerJoinEvent) { onJoin(event.player) }

    @EventHandler
    fun onPackStatus(event: PlayerResourcePackStatusEvent) {
        when (event.status) {
            PlayerResourcePackStatusEvent.Status.DECLINED,
            PlayerResourcePackStatusEvent.Status.FAILED_DOWNLOAD ->
                logger?.warning("[resource-pack] ${event.player.name}: ${event.status}")
            else -> { /* SUCCESSFULLY_LOADED / ACCEPTED — no-op */ }
        }
    }
}
```

- [ ] **Step 4: Run the test — verify it passes**

```bash
./gradlew test --tests "net.artisanmc.plugin.ResourcePackManagerTest"
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/plugin/resourcepack/ResourcePackManager.kt \
        plugin/src/test/kotlin/net/artisanmc/plugin/ResourcePackManagerTest.kt
git commit -m "feat(plugin): ResourcePackManager (push on join + on update)"
```

---

## Task 11: Plugin — wire WS messages into `ResourcePackManager`

`SyncedMenuProvider` already centralizes WS message handling. Extend its `handleMessage` to (a) read `resource_pack` from `hello_ack` and (b) handle `resource_pack_updated`. Add a constructor-injected `ResourcePackManager`.

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt`
- Modify: `plugin/src/test/kotlin/net/artisanmc/plugin/SyncedMenuProviderTest.kt`

- [ ] **Step 1: Write a failing test for the new message routing**

Append to `SyncedMenuProviderTest.kt`:

```kotlin
import net.artisanmc.plugin.resourcepack.ResourcePackManager
import net.artisanmc.plugin.config.ResourcePackConfig
import net.artisanmc.plugin.resourcepack.ResourcePackInfo

@Test
fun `provider forwards resource_pack_updated to manager`() {
    val packsRoot = Files.createTempDirectory("artisan_packs_").toFile()
    val mgr = ResourcePackManager(plugin, ResourcePackConfig(enabled = true, prompt = "<gold>x</gold>", sendOnJoin = false, sendDelayTicks = 0L))
    val provider = SyncedMenuProvider(packsRoot, serverKey = "", wsUrl = "", logger = null, resourcePackManager = mgr)
    provider.load()
    val hash = "0".repeat(40)
    val raw = """{"type":"resource_pack_updated","url":"http://x/$hash.zip","hash":"$hash"}"""
    // Use reflection (or a test-only public method) to call handleMessage:
    val handle = provider.javaClass.getDeclaredMethod("handleMessage", String::class.java)
    handle.isAccessible = true
    handle.invoke(provider, raw)
    assertEquals(hash, mgr.currentPackInfo?.hash)
}

@Test
fun `provider applies resource_pack from hello_ack`() {
    val packsRoot = Files.createTempDirectory("artisan_packs_").toFile()
    val mgr = ResourcePackManager(plugin, ResourcePackConfig(enabled = true, prompt = "<gold>x</gold>", sendOnJoin = false, sendDelayTicks = 0L))
    val provider = SyncedMenuProvider(packsRoot, serverKey = "", wsUrl = "", logger = null, resourcePackManager = mgr)
    provider.load()
    val hash = "f".repeat(40)
    val raw = """{"type":"hello_ack","session_id":"s","pack_hashes":{},"resource_pack":{"url":"http://x/$hash.zip","hash":"$hash"}}"""
    val handle = provider.javaClass.getDeclaredMethod("handleMessage", String::class.java)
    handle.isAccessible = true
    handle.invoke(provider, raw)
    assertEquals(hash, mgr.currentPackInfo?.hash)
}

@Test
fun `provider clears resource pack when hello_ack resource_pack is null`() {
    val packsRoot = Files.createTempDirectory("artisan_packs_").toFile()
    val mgr = ResourcePackManager(plugin, ResourcePackConfig(enabled = true, prompt = "<gold>x</gold>", sendOnJoin = false, sendDelayTicks = 0L))
    mgr.onUpdate(ResourcePackInfo.from("http://stale", "a".repeat(40), "<gold>x</gold>"))
    val provider = SyncedMenuProvider(packsRoot, serverKey = "", wsUrl = "", logger = null, resourcePackManager = mgr)
    provider.load()
    val raw = """{"type":"hello_ack","session_id":"s","pack_hashes":{},"resource_pack":null}"""
    val handle = provider.javaClass.getDeclaredMethod("handleMessage", String::class.java)
    handle.isAccessible = true
    handle.invoke(provider, raw)
    assertNull(mgr.currentPackInfo)
}
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
./gradlew test --tests "net.artisanmc.plugin.SyncedMenuProviderTest"
```

Expected: compile or assertion failure (no `resourcePackManager` param yet).

- [ ] **Step 3: Add `resourcePackManager` to the constructor and route messages**

In `SyncedMenuProvider.kt`:

1. Add the constructor parameter (with a default of `null` to keep existing callers compiling for now):

```kotlin
class SyncedMenuProvider(
    private val packsDir: File,
    // ... existing params ...
    private val langManager: LangManager? = null,
    private val resourcePackManager: net.artisanmc.plugin.resourcepack.ResourcePackManager? = null,
) : MenuProvider {
```

2. In `handleMessage` → `"hello_ack"` branch, after `apiUrl = ...`, add:

```kotlin
val rpNode = node["resource_pack"]
if (rpNode == null || rpNode.isNull) {
    resourcePackManager?.onUpdate(null)
} else {
    val url = rpNode["url"]?.asText()
    val hash = rpNode["hash"]?.asText()
    val promptMini = "<gold>Pack Artisan</gold>"  // overridden via config in ArtisanPlugin
    if (url != null && hash != null) {
        try {
            resourcePackManager?.onUpdate(
                net.artisanmc.plugin.resourcepack.ResourcePackInfo.from(url, hash, promptMini)
            )
        } catch (t: Throwable) {
            logger?.warning("Invalid resource_pack info from hello_ack: ${t.message}")
        }
    }
}
```

3. Add a new branch to `handleMessage`:

```kotlin
"resource_pack_updated" -> {
    val url = node["url"]?.asText() ?: return
    val hash = node["hash"]?.asText() ?: return
    val promptMini = "<gold>Pack Artisan</gold>"
    try {
        resourcePackManager?.onUpdate(
            net.artisanmc.plugin.resourcepack.ResourcePackInfo.from(url, hash, promptMini)
        )
    } catch (t: Throwable) {
        logger?.warning("Invalid resource_pack_updated payload: ${t.message}")
    }
}
```

- [ ] **Step 4: Run the test — verify it passes**

```bash
./gradlew test --tests "net.artisanmc.plugin.SyncedMenuProviderTest"
```

Expected: 6 tests pass (3 existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt \
        plugin/src/test/kotlin/net/artisanmc/plugin/SyncedMenuProviderTest.kt
git commit -m "feat(plugin): SyncedMenuProvider routes resource_pack_updated and hello_ack.resource_pack"
```

---

## Task 12: Plugin — instantiate `ResourcePackManager` in `ArtisanPlugin`

Wire the manager into both `onEnable` and `reinit`. Pass the configured prompt; register the listener with Bukkit.

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt`

- [ ] **Step 1: Add the prompt-aware factory in `ResourcePackManager`**

Since the manager already takes the config, the only thing missing is a way to override the hard-coded prompt in `SyncedMenuProvider`. Easiest: store the config's prompt on the manager and let it provide it on demand.

Add to `ResourcePackManager.kt`:

```kotlin
fun applyFromBackend(url: String, hash: String) {
    onUpdate(ResourcePackInfo.from(url, hash, config.prompt))
}

fun clear() { onUpdate(null) }
```

In `SyncedMenuProvider.handleMessage`, replace the two ad-hoc `ResourcePackInfo.from(...)` calls with `resourcePackManager?.applyFromBackend(url, hash)` / `resourcePackManager?.clear()`. Drop the unused `promptMini` literals.

- [ ] **Step 2: Wire the manager into `ArtisanPlugin.onEnable`**

Below the existing `customItemsManager` setup, before `menuProvider.load()`, add:

```kotlin
val resourcePackManager = net.artisanmc.plugin.resourcepack.ResourcePackManager(
    plugin = this,
    config = cfg.resourcePack,
    logger = logger,
)
syncedProvider?.setResourcePackManager(resourcePackManager)
server.pluginManager.registerEvents(resourcePackManager, this)
```

Add a setter on `SyncedMenuProvider` (next to `setCustomItemsManager`):

```kotlin
fun setResourcePackManager(mgr: net.artisanmc.plugin.resourcepack.ResourcePackManager) {
    // @Volatile field set lazily after construction so the existing constructor
    // signatures stay backwards compatible with tests.
    resourcePackManagerRef = mgr
}
@Volatile private var resourcePackManagerRef: net.artisanmc.plugin.resourcepack.ResourcePackManager? = null
```

Replace the constructor param `resourcePackManager` with a helper `private fun rpm() = resourcePackManager ?: resourcePackManagerRef` and use `rpm()` in `handleMessage`. (Keeps both injection styles — constructor for tests, setter for the plugin.)

- [ ] **Step 3: Mirror the wiring in `reinit`**

Apply the same `ResourcePackManager` creation + `setResourcePackManager` + listener registration in `ArtisanPlugin.reinit` so config reload picks up new prompt / delay values.

(For the listener re-register on reinit, the existing pattern in this file does not unregister the previous instance for other listeners either — accept that behavior. The replacement manager will become the latest one set on the provider, and stale instances are harmless because their `currentPackInfo` is never updated after the swap.)

- [ ] **Step 4: Compile**

```bash
./gradlew compileKotlin
```

Expected: no errors.

- [ ] **Step 5: Run the plugin test suite**

```bash
./gradlew test
```

Expected: full suite passes (~190 + 8 new + 3 ResourcePackInfo cases ≈ 201).

- [ ] **Step 6: Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt \
        plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt \
        plugin/src/main/kotlin/net/artisanmc/plugin/resourcepack/ResourcePackManager.kt
git commit -m "feat(plugin): instantiate ResourcePackManager + register listener"
```

---

## Task 13: Docs — update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add new endpoints to the "Custom Items — endpoints et cache" table**

Insert after the existing asset endpoint rows:

```markdown
| `GET /api/resource-pack/:server_key_id/:hash.zip` | Sert le zip du resource pack généré. `Cache-Control: public, max-age=31536000, immutable`, `ETag: "<hash>"`. 404 si hash inconnu. |
| `POST /api/editor-session/:token/resource-pack/rebuild` | Force la régénération du resource pack pour le server_key de la session. Returns `{ url, hash }` et broadcast `resource_pack_updated`. |
```

- [ ] **Step 2: Add `resource_pack_updated` and hello_ack extension to the "Protocole WS plugin ↔ backend" table**

Insert before the `ping` / `pong` row:

```markdown
| `resource_pack_updated` | backend → plugin | `{ url, hash }` — broadcast après chaque rebuild |
```

And update the `hello_ack` row:
```markdown
| `hello_ack` | backend → plugin | `pack_hashes`, `needs_sync`, `api_url`, `resource_pack: { url, hash } \| null` |
```

- [ ] **Step 3: Bump test counts in the "Tests — ce qui est couvert" table after running the full suite**

```bash
cd backend && bun test 2>&1 | tail -5
cd ../plugin && ./gradlew test 2>&1 | tail -5
```

Replace the backend row count and plugin row count with the actual numbers reported. Add the new test files to the list:
- backend: `resourcePackBuilder.test.ts`, `fontJsonBuilder.test.ts`, `resourcePackStorage.test.ts`, `resourcePack.test.ts`, `resourcePack.test.ts` (routes)
- plugin: `ResourcePackManagerTest`, `PluginConfigTest`

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: resource pack endpoints, WS messages, test counts"
```

---

## Final verification

- [ ] **Step 1: Full backend test suite**

```bash
cd backend && bun test
```

Expected: all tests pass. The pre-existing `link_codes schema` failure noted in CLAUDE.md is still acceptable; new tests must be green.

- [ ] **Step 2: Full plugin test suite**

```bash
cd plugin && ./gradlew test
```

Expected: all tests pass, including the new `ResourcePackManagerTest`, `PluginConfigTest`, and the extended `SyncedMenuProviderTest`.

- [ ] **Step 3: Type-check the editor (no editor changes in this sub-project, but make sure nothing is broken)**

```bash
cd editor && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Manual end-to-end smoke test**

Spin up the Docker stack:

```bash
docker compose up -d
```

a. **Create an editor session** (or reuse an existing one). Upload a glyph PNG via `POST /api/editor-session/:token/assets` (curl or via the editor).

b. **Verify the rebuild happened**:
```bash
psql "$DATABASE_URL" -c "SELECT id, resource_pack_hash FROM server_keys"
ls backend/data/resource-packs/<server_key_id>/
```

You should see the new `<hash>.zip` on disk and `resource_pack_hash` populated.

c. **Download the pack**:
```bash
curl -I http://localhost:3001/api/resource-pack/<server_key_id>/<hash>.zip
```

Expect `200`, `Content-Type: application/zip`, `Cache-Control: public, max-age=31536000, immutable`, `ETag: "<hash>"`.

d. **Inspect the zip**:
```bash
unzip -l backend/data/resource-packs/<server_key_id>/<hash>.zip
```

Expect:
- `pack.mcmeta`
- `pack.png`
- `assets/artisan/font/default.json`
- `assets/artisan/textures/font/<glyph_name>.png`

e. **Manual rebuild trigger**:
```bash
curl -X POST http://localhost:3001/api/editor-session/<token>/resource-pack/rebuild
```

Expect `{ "url": "...", "hash": "<same hash>" }`. With no asset changes, the hash should be identical (deterministic builder).

f. **In-game test**: join the Minecraft server, observe the chat / server log:
- `[Artisan] [resource-pack] ...` lines if the player declines.
- The Artisan pack appears in the player's resource pack stack (F3 → resource packs, or the in-game prompt).

g. **WS hot update**: while in-game, upload another glyph from the editor. Within ~1s, the plugin should log a re-push line and the client should re-download the pack (visible as a brief reload prompt).

- [ ] **Step 5: Final commit + push (if you're going to land)**

```bash
git push -u origin feat/resource-pack-generator
```

---

## Self-review vs spec § "Resource Pack Generation" + "Plugin Distribution"

Walking the spec checklist line-by-line:

**Triggers (spec § Déclencheurs)**
- [x] Asset CRUD → régénération synchrone — Task 7 (POST/PATCH/DELETE await `rebuildResourcePack`).
- [x] Manual trigger `POST .../resource-pack/rebuild` — Task 6.
- [x] **Pas** de régénération sur publish de menu — out of scope, naturally satisfied.

**Pipeline backend (spec § Pipeline)**
- [x] (1) Read all assets — Task 5.
- [x] (2) Allocate codepoints (stable) — already done in Sub-project 1; reused.
- [x] (3) Generate font JSONs (default.json) — Task 2. (Per-font files: Sub-project 4, intentionally out of scope.)
- [x] (4) Stream-build zip in memory — Task 3 (in-memory via `fflate.zipSync`).
- [x] (5) SHA1 hash → `{hash}` — Task 3.
- [x] (6) Write `data/resource-packs/{serverKeyId}/{hash}.zip` — Task 4.
- [x] (7) Update `ServerKey.resourcePackHash` + `resourcePackUpdatedAt` — Task 1 + Task 5. Note: spec says `resourcePackUrl`; we store `resourcePackUpdatedAt` instead and reconstruct the URL on read (more robust to `BUNDLE_BASE_URL` changes). This is a conscious tweak, surfaced here for review.
- [x] (8) GC — keep last 3 hashes — Task 4 + Task 5 (with `protectedHash` to never delete the current one).
- [x] (9) WS notify `resource_pack_updated` — Task 6 (trigger) + Task 8 (broadcast).

**Codepoint allocation (spec § Codepoint allocation)**
- [x] Range `U+E000`–`U+F7FF` — already in Sub-project 1's `codepointAllocator.ts` (used unchanged).
- [x] Sequential per `serverKeyId`, stable — already done.
- [x] > 6144 assets → reject — already done.

**Endpoints HTTP (spec § Endpoints HTTP)**
- [x] `GET /api/resource-pack/:server_key_id/:hash.zip` — Task 6.
- [x] `GET /api/textures/asset/:asset_id` — already done in Sub-project 1.
- [N/A] `GET /api/external-glyphs/...` — Sub-project 5.

**Plugin distribution — Envoi au joueur (spec § Plugin Distribution)**
- [x] `setResourcePack(uuid, url, sha1Bytes, prompt, false)` — Task 10.
- [x] `PlayerJoinEvent` + 20-tick delay — Task 10 (configurable via `send-delay-ticks`).
- [x] WS `resource_pack_updated` → re-push to all online players — Task 10's `onUpdate` iterates `onlinePlayers`.
- [x] UUID stable per hash: `UUID.nameUUIDFromBytes(hash.toByteArray(...))` — Task 9 (`ResourcePackInfo.from`).

**Messages WS additionnels (spec § Messages WS additionnels)**
- [x] `hello_ack` + `resource_pack: { url, hash } | null` — Task 8.
- [x] `resource_pack_updated` — Tasks 6, 8.
- [N/A] `external_glyphs_*` — Sub-project 5.

**Configuration plugin (spec § Configuration plugin)**
- [x] `resource-pack.enabled` — Task 9.
- [x] `resource-pack.prompt` — Task 9.
- [x] `resource-pack.send-on-join` — Task 9.
- [x] `resource-pack.send-delay-ticks` — Task 9.

**Refus joueur (spec § Refus joueur)**
- [x] `PlayerResourcePackStatusEvent` → log DECLINED / FAILED_DOWNLOAD — Task 10.
- [x] No kick (pack `required = false`) — Task 10 (hard-coded `false` in `setResourcePack`).
- [N/A] Menus afficher `□` à la place des glyphs — Sub-project 3 (compiler), not this plan.

**Conscious deviations** (called out for the eng review):

1. **`resourcePackUrl` column not added.** Spec § Pipeline step 7 says "Update `ServerKey.resourcePackHash` + `resourcePackUrl`". I store `resourcePackUpdatedAt` instead and reconstruct the URL from `BUNDLE_BASE_URL + serverKeyId + hash` at read time. The hash is the only piece of state that needs to be persisted; reconstructing the URL avoids stale data when the env changes and trims the schema by one column. If the spec author prefers the literal interpretation, swapping `resourcePackUpdatedAt` for `resourcePackUrl` is a 5-line change.

2. **`fflate.zipSync` with `level: 0`** (no deflate). Spec doesn't pin this; deflate would shrink the zip ~30% but compromise determinism across `fflate` versions. The pack is small (a few KB to MB), so the trade-off favors hash stability.

3. **In `pack.mcmeta`, `pack_format: 22`** corresponds to 1.21.x. Spec § Structure du zip says "format 22 (1.21+)". If the server is on an older 1.20.3+ build, the pack will still load but emit a warning. The plugin's `setResourcePack` is unaffected (`required = false` means clients on older versions can simply reject it).

**No spec items unaccounted for in tasks** (for items in scope of Sub-project 2).

---

## Summary for the parent agent

**Path of saved plan:** `C:\Users\ibane\Documents\Minecraft\Plugins\Artisan\docs\superpowers\plans\2026-05-11-resource-pack-generator.md`

**Number of tasks:** 13 numbered tasks + a Final Verification section.

**Spec coverage gaps:** None within Sub-project 2's scope. The out-of-scope items (per-font JSONs for `type=font`, external glyph endpoints, MenuTitleLayer compilation, `□` placeholder rendering) are explicitly deferred to Sub-projects 3, 4, and 5 as called out in the plan and in the spec's Sub-project Decomposition section. Three conscious deviations from the literal spec text are flagged at the bottom of the plan for engineering-review consideration:

1. Storing `resourcePackUpdatedAt` instead of `resourcePackUrl` (URL reconstructed on read).
2. `fflate` zip with `level: 0` for deterministic hashing.
3. `pack_format: 22` (1.21.x baseline; older clients ignore the pack since `required = false`).

**Note on file creation:** My agent role is read-only; I cannot write the markdown file directly. The full plan content above is the complete final document — the parent agent should write it verbatim to the target path (`docs/superpowers/plans/2026-05-11-resource-pack-generator.md`) on the `feat/resource-pack-generator` branch.

### Critical Files for Implementation

- C:\Users\ibane\Documents\Minecraft\Plugins\Artisan\backend\src\lib\resourcePack.ts (new — orchestrator)
- C:\Users\ibane\Documents\Minecraft\Plugins\Artisan\backend\src\lib\resourcePackBuilder.ts (new — zip builder)
- C:\Users\ibane\Documents\Minecraft\Plugins\Artisan\backend\src\ws\hub.ts (modify — `pushResourcePackUpdated` + `hello_ack.resource_pack`)
- C:\Users\ibane\Documents\Minecraft\Plugins\Artisan\backend\src\routes\assets.ts (modify — trigger rebuild on POST/PATCH/DELETE)
- C:\Users\ibane\Documents\Minecraft\Plugins\Artisan\plugin\src\main\kotlin\gg\artisan\plugin\resourcepack\ResourcePackManager.kt (new — push to players + WS handler entrypoint)