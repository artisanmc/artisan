# Canvas Layout Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist `Pack.canvasLayout` (positions of menu/command/dialog cards in the editor's pack canvas) inside `manifest.yaml`, so the positions survive raw file-copy migrations between servers.

**Architecture:** Add an optional `editor_layout: { id: { x, y } }` field to `manifest.yaml`. The editor serializes it on export. The backend parses it back into `canvasLayout` on import. Both publish paths (plugin → `POST /api/bundles/:packId` and editor → `PUT /api/editor-session/:token/packs/:packId` + `/deploy`) **always** overwrite `editorJson.canvasLayout` with what the manifest says: files win. The plugin needs no code change — `ManifestYaml.kt` already ignores unknown fields.

**Tech Stack:** TypeScript (editor + backend, vitest + bun:test), Kotlin (plugin, JUnit), YAML, Hono, Drizzle ORM, SQLite/PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-05-19-canvas-layout-persistence-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `editor/src/features/export/transform.ts` | Modify (around line 542) | Emit `editor_layout` in manifest, filtered on live ids. |
| `editor/src/features/export/transform.test.ts` | Modify (append tests) | Assert manifest contents for layout cases. |
| `backend/src/lib/packImport.ts` | Modify | Add `parseEditorLayout` + exported `readEditorLayoutFromFiles`. Use in `importPackFromFiles`. |
| `backend/src/lib/packImport.test.ts` | **Create** | Unit tests for parser + helper. |
| `backend/src/routes/bundles.ts` | Modify (around lines 19-46) | Apply "files win" to `editorJson.canvasLayout` on every publish. |
| `backend/src/routes/bundles.test.ts` | Modify (append tests) | Assert canvasLayout overwrite on plugin republish. |
| `backend/src/routes/editorSession.ts` | Modify (PUT around line 120-148; deploy around 150-186) | Same "files win" on PUT + deploy. |
| `backend/src/routes/editorSession.test.ts` | Modify (append tests) | Assert canvasLayout reflected from manifest on PUT/deploy. |
| `plugin/src/test/kotlin/gg/interfaze/plugin/ManifestYamlIgnoresEditorLayoutTest.kt` | **Create** | Smoke test that the Kotlin parser silently ignores `editor_layout`. |

No file deletions. No directory moves.

---

## Task 1: Editor — emit `editor_layout` in `manifest.yaml` (happy path)

**Files:**
- Modify: `editor/src/features/export/transform.ts:542-555`
- Test: `editor/src/features/export/transform.test.ts` (append)

- [ ] **Step 1: Write the failing test** in `editor/src/features/export/transform.test.ts`, inside the existing `describe("transform", ...)` block (the file already imports `parse`, `transform`, `packId`, `menuId`, `commandId`, `dialogId`, and `makePack` is defined at the top of the file):

```ts
it("emits editor_layout in manifest with menu/command/dialog positions", () => {
  const pack = makePack({
    menus: [
      { id: menuId("shop"), packId: packId("p_test"), rows: 3, title: [], layers: [] },
    ],
    commands: [
      { id: commandId("heal"), packId: packId("p_test"), name: "heal", arguments: [], steps: [] },
    ],
    dialogs: [
      { id: dialogId("confirm"), packId: packId("p_test"), title: { key: "k" as I18nKey }, canCloseWithEscape: true, body: [], inputs: [], buttons: [] } as unknown as Dialog,
    ],
    canvasLayout: {
      [menuId("shop")]: { x: 40, y: 40 },
      [commandId("heal")]: { x: 260, y: 40 },
      [dialogId("confirm")]: { x: 480, y: 40 },
    },
  });
  const files = transform(pack);
  const manifest = parse(files["plugins/Interfaze/packs/p_test/manifest.yaml"]!);
  expect(manifest.editor_layout).toEqual({
    shop:    { x: 40,  y: 40 },
    heal:    { x: 260, y: 40 },
    confirm: { x: 480, y: 40 },
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `editor/`): `npx vitest run src/features/export/transform.test.ts`
Expected: FAIL — `manifest.editor_layout` is `undefined`.

- [ ] **Step 3: Implement** — edit `editor/src/features/export/transform.ts` around line 542. Replace the `files[\`${base}/manifest.yaml\`] = stringify(...)` block with:

```ts
const liveIds = new Set<string>([
  ...pack.menus.map((m) => m.id as string),
  ...pack.commands.map((c) => c.id as string),
  ...pack.dialogs.map((d) => d.id as string),
]);
const editorLayout = Object.fromEntries(
  Object.entries(pack.canvasLayout).filter(([id]) => liveIds.has(id)),
);

const manifest: Record<string, unknown> = {
  schema: "manifest/v1",
  pack_id: pack.id,
  default_lang: pack.defaultLang,
  languages: langs,
  files: {
    menus: pack.menus.map((m) => m.id),
    commands: pack.commands.map((c) => c.id),
    dialogs: pack.dialogs.map((d) => d.id),
  },
};
if (Object.keys(editorLayout).length > 0) {
  manifest.editor_layout = editorLayout;
}
files[`${base}/manifest.yaml`] = stringify(manifest, yamlOpts);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/export/transform.test.ts`
Expected: PASS (all tests in file, including the new one).

- [ ] **Step 5: Commit**

```bash
git add editor/src/features/export/transform.ts editor/src/features/export/transform.test.ts
git commit -m "feat(editor): manifest.yaml — emit editor_layout from canvasLayout"
```

---

## Task 2: Editor — `editor_layout` omitted when empty, orphaned ids filtered

**Files:**
- Modify: `editor/src/features/export/transform.test.ts` (append)

(No production change — Task 1 already implements both behaviors; this task just locks them in with tests so regressions are caught.)

- [ ] **Step 1: Write the failing tests** — append to the `describe("transform", ...)` block:

```ts
it("omits editor_layout when canvasLayout is empty", () => {
  const pack = makePack({
    menus: [
      { id: menuId("shop"), packId: packId("p_test"), rows: 3, title: [], layers: [] },
    ],
    canvasLayout: {},
  });
  const files = transform(pack);
  const manifest = parse(files["plugins/Interfaze/packs/p_test/manifest.yaml"]!);
  expect(manifest.editor_layout).toBeUndefined();
});

it("filters orphaned ids from editor_layout (id no longer in pack)", () => {
  const pack = makePack({
    menus: [
      { id: menuId("shop"), packId: packId("p_test"), rows: 3, title: [], layers: [] },
    ],
    canvasLayout: {
      [menuId("shop")]: { x: 40, y: 40 },
      // "ghost_menu" is NOT in pack.menus — stale entry, should be dropped:
      "ghost_menu": { x: 999, y: 999 },
    },
  });
  const files = transform(pack);
  const manifest = parse(files["plugins/Interfaze/packs/p_test/manifest.yaml"]!);
  expect(manifest.editor_layout).toEqual({ shop: { x: 40, y: 40 } });
});
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `npx vitest run src/features/export/transform.test.ts`
Expected: PASS (Task 1's implementation already satisfies these).

- [ ] **Step 3: Commit**

```bash
git add editor/src/features/export/transform.test.ts
git commit -m "test(editor): manifest editor_layout — empty + orphan-filter regression locks"
```

---

## Task 3: Backend — `parseEditorLayout` + `readEditorLayoutFromFiles` helpers

**Files:**
- Modify: `backend/src/lib/packImport.ts`
- Create: `backend/src/lib/packImport.test.ts`

- [ ] **Step 1: Write the failing tests** — create `backend/src/lib/packImport.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { importPackFromFiles, readEditorLayoutFromFiles } from "./packImport";

const PACK_ID = "p_layout";
const base = `plugins/Interfaze/packs/${PACK_ID}`;

function manifestWith(editorLayout: string | null): Record<string, string> {
  const body = [
    "schema: manifest/v1",
    `pack_id: ${PACK_ID}`,
    "default_lang: en",
    "files:",
    "  menus: [shop]",
    "  commands: []",
    "  dialogs: []",
    ...(editorLayout ? [editorLayout] : []),
  ].join("\n");
  return {
    [`${base}/manifest.yaml`]: body,
    [`${base}/menus/shop.yaml`]: "id: shop\nsize: 27\n",
  };
}

describe("readEditorLayoutFromFiles", () => {
  test("parses editor_layout from manifest", () => {
    const files = manifestWith("editor_layout:\n  shop: { x: 40, y: 80 }\n");
    expect(readEditorLayoutFromFiles(files, PACK_ID)).toEqual({
      shop: { x: 40, y: 80 },
    });
  });

  test("missing editor_layout → {}", () => {
    const files = manifestWith(null);
    expect(readEditorLayoutFromFiles(files, PACK_ID)).toEqual({});
  });

  test("malformed entries silently ignored (non-numeric x/y, null value)", () => {
    const files = manifestWith(
      [
        "editor_layout:",
        "  shop:    { x: 40, y: 80 }",
        "  bad_xy:  { x: \"oops\", y: 5 }",
        "  bad_inf: { x: .inf, y: 1 }",
        "  null_v:  null",
      ].join("\n"),
    );
    expect(readEditorLayoutFromFiles(files, PACK_ID)).toEqual({
      shop: { x: 40, y: 80 },
    });
  });

  test("missing manifest.yaml → {}", () => {
    expect(readEditorLayoutFromFiles({}, PACK_ID)).toEqual({});
  });
});

describe("importPackFromFiles — canvasLayout", () => {
  test("populates canvasLayout from manifest.editor_layout", () => {
    const files = manifestWith("editor_layout:\n  shop: { x: 12, y: 34 }\n");
    const pack = importPackFromFiles(PACK_ID, files) as { canvasLayout: Record<string, { x: number; y: number }> };
    expect(pack.canvasLayout).toEqual({ shop: { x: 12, y: 34 } });
  });

  test("no editor_layout → canvasLayout: {}", () => {
    const pack = importPackFromFiles(PACK_ID, manifestWith(null)) as { canvasLayout: Record<string, unknown> };
    expect(pack.canvasLayout).toEqual({});
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `backend/`): `bun test src/lib/packImport.test.ts`
Expected: FAIL — `readEditorLayoutFromFiles` is not exported; `importPackFromFiles(...).canvasLayout` is always `{}`.

- [ ] **Step 3: Implement** — edit `backend/src/lib/packImport.ts`:

(a) Extend the `ManifestYaml` interface (currently lines 126-130):

```ts
interface ManifestYaml {
  pack_id?: string;
  default_lang?: string;
  files?: { menus?: string[]; commands?: string[]; dialogs?: string[] };
  editor_layout?: Record<string, unknown>;
}
```

(b) Add the parser + exported helper just above `// ─── public API ───`:

```ts
function parseEditorLayout(raw: unknown): Record<string, { x: number; y: number }> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, { x: number; y: number }> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const { x, y } = v as { x?: unknown; y?: unknown };
    if (typeof x !== "number" || typeof y !== "number") continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out[id] = { x, y };
  }
  return out;
}

export function readEditorLayoutFromFiles(
  files: Record<string, string>,
  packId: string,
): Record<string, { x: number; y: number }> {
  const m = tryParse<ManifestYaml>(getFile(files, packId, "manifest.yaml")) ?? {};
  return parseEditorLayout(m.editor_layout);
}
```

(c) Change the `canvasLayout: {}` line inside `importPackFromFiles`'s return (currently line 239) to:

```ts
canvasLayout: parseEditorLayout(manifest.editor_layout),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/lib/packImport.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/packImport.ts backend/src/lib/packImport.test.ts
git commit -m "feat(backend): packImport — parse editor_layout from manifest into canvasLayout"
```

---

## Task 4: Backend — `bundles.ts` plugin publish: files win on canvasLayout

**Files:**
- Modify: `backend/src/routes/bundles.ts:19-46`
- Test: `backend/src/routes/bundles.test.ts` (append)

- [ ] **Step 1: Write the failing tests** — append to `backend/src/routes/bundles.test.ts`, inside `describe("bundle upload/download", ...)`:

```ts
test("POST overwrites canvasLayout from manifest editor_layout (files win)", async () => {
  const keyRes = await app.request("/api/server-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label: "layout-publish" }),
  });
  const { key } = (await keyRes.json()) as { key: string };

  const files = {
    "plugins/Interfaze/packs/p_layout/manifest.yaml": [
      "schema: manifest/v1",
      "pack_id: p_layout",
      "default_lang: en",
      "files:",
      "  menus: [shop]",
      "  commands: []",
      "  dialogs: []",
      "editor_layout:",
      "  shop: { x: 111, y: 222 }",
    ].join("\n") + "\n",
    "plugins/Interfaze/packs/p_layout/menus/shop.yaml": "id: shop\nsize: 27\n",
  };

  const res = await app.request("/api/bundles/p_layout", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify({ files }),
  });
  expect(res.status).toBe(201);

  // Verify editorJson.canvasLayout was populated. We round-trip through
  // GET /api/editor-session/:token/packs to read editorJson, but that requires
  // a session. Easier: inspect the DB directly.
  const { db } = await import("../db/index");
  const { packBundles } = await import("../db/schema");
  const { and, eq } = await import("drizzle-orm");
  const row = (await db.select().from(packBundles)
    .where(and(eq(packBundles.packId, "p_layout"))))[0];
  const pack = JSON.parse(row.editorJson!) as { canvasLayout: Record<string, { x: number; y: number }> };
  expect(pack.canvasLayout).toEqual({ shop: { x: 111, y: 222 } });
});

test("POST without editor_layout in manifest resets canvasLayout to {}", async () => {
  // Same key as previous test → existing editorJson has canvasLayout. Now
  // publish files with NO editor_layout: files-win means canvasLayout = {}.
  const keyRes = await app.request("/api/server-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label: "layout-reset" }),
  });
  const { key } = (await keyRes.json()) as { key: string };

  // First publish: with positions.
  const withPos = {
    "plugins/Interfaze/packs/p_reset/manifest.yaml": [
      "schema: manifest/v1", "pack_id: p_reset", "default_lang: en",
      "files:", "  menus: [shop]", "  commands: []", "  dialogs: []",
      "editor_layout:", "  shop: { x: 9, y: 9 }",
    ].join("\n") + "\n",
    "plugins/Interfaze/packs/p_reset/menus/shop.yaml": "id: shop\nsize: 27\n",
  };
  await app.request("/api/bundles/p_reset", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify({ files: withPos }),
  });

  // Second publish: no editor_layout.
  const withoutPos = {
    "plugins/Interfaze/packs/p_reset/manifest.yaml": [
      "schema: manifest/v1", "pack_id: p_reset", "default_lang: en",
      "files:", "  menus: [shop]", "  commands: []", "  dialogs: []",
    ].join("\n") + "\n",
    "plugins/Interfaze/packs/p_reset/menus/shop.yaml": "id: shop\nsize: 27\n",
  };
  await app.request("/api/bundles/p_reset", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify({ files: withoutPos }),
  });

  const { db } = await import("../db/index");
  const { packBundles } = await import("../db/schema");
  const { and, eq } = await import("drizzle-orm");
  const row = (await db.select().from(packBundles)
    .where(and(eq(packBundles.packId, "p_reset"))))[0];
  const pack = JSON.parse(row.editorJson!) as { canvasLayout: Record<string, unknown> };
  expect(pack.canvasLayout).toEqual({});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/routes/bundles.test.ts`
Expected: FAIL — `canvasLayout` is the editor's preserved value or `{}` from stub regeneration; the overwrite-from-files path doesn't exist yet.

- [ ] **Step 3: Implement** — edit `backend/src/routes/bundles.ts`. Replace the existing transaction body (lines 19-46) with:

```ts
await db.transaction(async (tx) => {
  const existing = await tx
    .select({ id: packBundles.id, editorJson: packBundles.editorJson })
    .from(packBundles)
    .where(and(eq(packBundles.serverId, serverId), eq(packBundles.packId, packId)));

  const incomingLayout = readEditorLayoutFromFiles(body.files, packId);

  let editorJsonObj: Record<string, unknown>;
  if (existing.length > 0 && !isEmptyStub(existing[0].editorJson)) {
    editorJsonObj = JSON.parse(existing[0].editorJson!) as Record<string, unknown>;
  } else {
    editorJsonObj = importPackFromFiles(packId, body.files) as Record<string, unknown>;
  }
  editorJsonObj.canvasLayout = incomingLayout; // files win

  const keepEditorJson = JSON.stringify(editorJsonObj);

  if (existing.length > 0) {
    await tx.update(packBundles)
      .set({ hash, filesJson: JSON.stringify(body.files), editorJson: keepEditorJson })
      .where(and(eq(packBundles.serverId, serverId), eq(packBundles.packId, packId)));
  } else {
    await tx.insert(packBundles).values({
      id: crypto.randomUUID(),
      serverId,
      packId,
      hash,
      filesJson: JSON.stringify(body.files),
      editorJson: keepEditorJson,
      createdAt: new Date(),
    });
  }
});
```

And add `readEditorLayoutFromFiles` to the imports at the top:

```ts
import { importPackFromFiles, isEmptyStub, readEditorLayoutFromFiles } from "../lib/packImport";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/routes/bundles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/bundles.ts backend/src/routes/bundles.test.ts
git commit -m "feat(backend): bundles publish — overwrite canvasLayout from manifest (files win)"
```

---

## Task 5: Backend — `editorSession.ts` PUT + deploy: files win on canvasLayout

**Files:**
- Modify: `backend/src/routes/editorSession.ts:120-186`
- Test: `backend/src/routes/editorSession.test.ts` (append)

- [ ] **Step 1: Write the failing tests** — append to `backend/src/routes/editorSession.test.ts` (the file already has a `createSession` helper near the top):

```ts
describe("PUT /api/editor-session/:token/packs/:packId — canvasLayout (files win)", () => {
  test("manifest editor_layout overrides pack.canvasLayout in stored editorJson", async () => {
    const { token } = await createSession();
    const fakePack = {
      id: "p_files_win",
      name: "Files Win",
      menus: [],
      canvasLayout: { shop: { x: 1, y: 1 } }, // STALE — files should win
    };
    const fakeFiles = {
      "plugins/Interfaze/packs/p_files_win/manifest.yaml": [
        "schema: manifest/v1", "pack_id: p_files_win", "default_lang: en",
        "files:", "  menus: [shop]", "  commands: []", "  dialogs: []",
        "editor_layout:", "  shop: { x: 77, y: 88 }",
      ].join("\n") + "\n",
    };
    const res = await app.request(`/api/editor-session/${token}/packs/p_files_win`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack: fakePack, files: fakeFiles }),
    });
    expect(res.status).toBe(201);

    const getRes = await app.request(`/api/editor-session/${token}/packs`);
    const body = await getRes.json() as { packs: Array<{ id: string; canvasLayout: Record<string, { x: number; y: number }> }> };
    const p = body.packs.find((x) => x.id === "p_files_win")!;
    expect(p.canvasLayout).toEqual({ shop: { x: 77, y: 88 } });
  });
});

describe("POST /api/editor-session/:token/packs/:packId/deploy — canvasLayout (files win)", () => {
  test("deploy applies manifest editor_layout to stored editorJson", async () => {
    const { token } = await createTrustedSession(); // existing helper that returns a trusted session
    const fakePack = {
      id: "p_deploy_layout",
      name: "Deploy Layout",
      menus: [],
      canvasLayout: { foo: { x: 0, y: 0 } }, // stale
    };
    const fakeFiles = {
      "plugins/Interfaze/packs/p_deploy_layout/manifest.yaml": [
        "schema: manifest/v1", "pack_id: p_deploy_layout", "default_lang: en",
        "files:", "  menus: []", "  commands: []", "  dialogs: []",
        "editor_layout:", "  bar: { x: 200, y: 300 }",
      ].join("\n") + "\n",
    };
    const res = await app.request(`/api/editor-session/${token}/packs/p_deploy_layout/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack: fakePack, files: fakeFiles }),
    });
    expect(res.status).toBe(201);

    const getRes = await app.request(`/api/editor-session/${token}/packs`);
    const body = await getRes.json() as { packs: Array<{ id: string; canvasLayout: Record<string, { x: number; y: number }> }> };
    const p = body.packs.find((x) => x.id === "p_deploy_layout")!;
    expect(p.canvasLayout).toEqual({ bar: { x: 200, y: 300 } });
  });
});
```

(The `createTrustedSession` helper already exists at `backend/src/routes/editorSession.test.ts:206`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/routes/editorSession.test.ts`
Expected: FAIL — `canvasLayout` returned in GET is the stale `pack.canvasLayout` (or undefined depending on JSON.stringify of the user-supplied object), not the manifest layout.

- [ ] **Step 3: Implement** — edit `backend/src/routes/editorSession.ts`. Find the PUT handler (around line 120-148) and replace the body lines that compute `editorJson`:

```ts
router.put("/:token/packs/:packId", async (c) => {
  const token = c.req.param("token");
  const packId = c.req.param("packId");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json<{ pack: unknown; files: Record<string, string> }>();
  const hash = await computeBundleHash(body.files, packId);
  const filesJson = JSON.stringify(body.files);

  const packObj = (body.pack as Record<string, unknown>) ?? {};
  packObj.canvasLayout = readEditorLayoutFromFiles(body.files, packId); // files win
  const editorJson = JSON.stringify(packObj);

  await db.insert(packBundles).values({
    id: crypto.randomUUID(),
    serverId: session.serverKeyId,
    packId,
    hash,
    filesJson,
    editorJson,
    createdAt: new Date(),
  }).onConflictDoUpdate({
    target: [packBundles.serverId, packBundles.packId],
    set: { hash, filesJson, editorJson, createdAt: new Date() },
  });

  return c.json({ hash }, 201);
});
```

Do the same surgery on the `/deploy` handler (around line 150-186): right after `const filesJson = JSON.stringify(body.files);`, replace `const editorJson = JSON.stringify(body.pack);` with the same 3-line "packObj + canvasLayout + JSON.stringify" block. Keep `deployedEditorJson: editorJson` so the deployed snapshot uses the same canonicalized layout.

Finally, add the import at the top of the file:

```ts
import { readEditorLayoutFromFiles } from "../lib/packImport";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/routes/editorSession.test.ts`
Expected: PASS (full file — make sure no other tests regressed).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/editorSession.ts backend/src/routes/editorSession.test.ts
git commit -m "feat(backend): editorSession PUT/deploy — overwrite canvasLayout from manifest (files win)"
```

---

## Task 6: Plugin — smoke test that `ManifestYaml` ignores `editor_layout`

**Files:**
- Create: `plugin/src/test/kotlin/gg/interfaze/plugin/ManifestYamlIgnoresEditorLayoutTest.kt`

This task confirms the spec's claim that the plugin code needs no change. It's defensive: if someone later removes `@JsonIgnoreProperties(ignoreUnknown = true)` from `ManifestYaml`, this test catches it.

- [ ] **Step 1: Write the test** — create `plugin/src/test/kotlin/gg/interfaze/plugin/ManifestYamlIgnoresEditorLayoutTest.kt`:

```kotlin
package gg.interfaze.plugin

import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import gg.interfaze.plugin.model.ManifestYaml
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class ManifestYamlIgnoresEditorLayoutTest {

    private val yaml = ObjectMapper(YAMLFactory()).registerKotlinModule()

    @Test
    fun `editor_layout field is silently ignored on parse`() {
        val src = """
            schema: manifest/v1
            pack_id: p_test
            default_lang: en
            languages: [en]
            files:
              menus: [shop]
              commands: []
              dialogs: []
            editor_layout:
              shop: { x: 40, y: 80 }
        """.trimIndent()

        val manifest = yaml.readValue(src, ManifestYaml::class.java)

        assertEquals("p_test", manifest.packId)
        assertEquals(listOf("shop"), manifest.files.menus)
        // No exception thrown — that's the contract this test pins.
    }
}
```

- [ ] **Step 2: Run the test to verify it passes (it should — the production code already supports this)**

Run (from `plugin/`): `./gradlew test --tests "gg.interfaze.plugin.ManifestYamlIgnoresEditorLayoutTest"`
Expected: PASS. If FAIL with `UnrecognizedPropertyException`, the production fix is to ensure `@JsonIgnoreProperties(ignoreUnknown = true)` is on `ManifestYaml` (`plugin/src/main/kotlin/gg/interfaze/plugin/model/PackBundle.kt:14`). It already is, so the test should pass on first run.

- [ ] **Step 3: Commit**

```bash
git add plugin/src/test/kotlin/gg/interfaze/plugin/ManifestYamlIgnoresEditorLayoutTest.kt
git commit -m "test(plugin): ManifestYaml ignores editor_layout field (regression lock)"
```

---

## Task 7: Mirrored round-trip test — manifest schema contract

**Files:**
- Modify: `backend/src/lib/packImport.test.ts` (append)
- Modify: `editor/src/features/export/transform.test.ts` (append)

We don't have a clean cross-package import path (both `tsconfig.json` files scope `include` to their own `src`). Instead, pin the round-trip via a **shared YAML literal**: the editor test asserts that `transform` produces a manifest containing exactly the literal, and the backend test asserts that `importPackFromFiles` consumes that same literal and yields the expected `canvasLayout`. If anyone changes the on-wire format on one side, one of the two tests will break.

- [ ] **Step 1: Add the editor-side mirror test** — append to the `describe("transform", ...)` block in `editor/src/features/export/transform.test.ts`:

```ts
it("emits editor_layout in block-style YAML the backend round-trip test parses", () => {
  const pack = makePack({
    menus: [
      { id: menuId("shop"), packId: packId("p_test"), rows: 3, title: [], layers: [] },
    ],
    canvasLayout: { [menuId("shop")]: { x: 123, y: 456 } },
  });
  const files = transform(pack);
  const manifestYaml = files["plugins/Interfaze/packs/p_test/manifest.yaml"]!;
  // The editor emits block-style YAML for nested objects (the `yaml` lib's
  // default with our yamlOpts). The backend mirror test below asserts the
  // same block-style shape is parseable. If you change to flow style here,
  // update the backend mirror fixture too.
  expect(manifestYaml).toContain("editor_layout:");
  expect(manifestYaml).toContain("shop:");
  expect(manifestYaml).toMatch(/x:\s*123/);
  expect(manifestYaml).toMatch(/y:\s*456/);
});
```

- [ ] **Step 2: Add the backend-side mirror test** — append to `backend/src/lib/packImport.test.ts`. The fixture uses the SAME block-style nesting the editor produces; this is the "mirror":

```ts
describe("round-trip mirror — backend parses what the editor emits", () => {
  test("manifest with the editor's block-style shape yields matching canvasLayout", () => {
    // Mirror of editor/src/features/export/transform.test.ts:
    // "emits editor_layout in block-style YAML the backend round-trip test parses"
    const files = {
      "plugins/Interfaze/packs/p_mirror/manifest.yaml": [
        "schema: manifest/v1",
        "pack_id: p_mirror",
        "default_lang: en",
        "languages:",
        "  - en",
        "files:",
        "  menus:",
        "    - shop",
        "  commands: []",
        "  dialogs: []",
        "editor_layout:",
        "  shop:",
        "    x: 123",
        "    y: 456",
      ].join("\n") + "\n",
      "plugins/Interfaze/packs/p_mirror/menus/shop.yaml": "id: shop\nsize: 27\n",
    };
    const pack = importPackFromFiles("p_mirror", files) as {
      canvasLayout: Record<string, { x: number; y: number }>;
    };
    expect(pack.canvasLayout).toEqual({ shop: { x: 123, y: 456 } });
  });
});
```

- [ ] **Step 3: Run both test files**

From `editor/`: `npx vitest run src/features/export/transform.test.ts`
From `backend/`: `bun test src/lib/packImport.test.ts`
Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/lib/packImport.test.ts editor/src/features/export/transform.test.ts
git commit -m "test: mirrored canvasLayout round-trip across editor transform + backend import"
```

---

## Task 8: Full suite verification + smoke check

- [ ] **Step 1: Run the full backend test suite**

From `backend/`: `bun test`
Expected: all tests pass. Pre-existing failure of `link_codes schema` (mentioned in CLAUDE.md) is expected and unrelated.

- [ ] **Step 2: Run the full editor test suite**

From `editor/`: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 3: Run the plugin test suite**

From `plugin/`: `./gradlew test`
Expected: all tests pass (including the new `ManifestYamlIgnoresEditorLayoutTest`).

- [ ] **Step 4: Manual smoke check — file copy roundtrip**

(This is verification, not committed code. The point is to confirm the user's original scenario works.)

  1. Start the stack: `docker compose up -d`.
  2. Open the editor in browser A, create a pack with 2+ menus, drag them to specific positions.
  3. Wait for autosave (a few seconds).
  4. From a shell on the host: copy `plugins/Interfaze/packs/<pack_id>/` out of the minecraft container (`docker cp minecraft:/data/plugins/Interfaze/packs/<id> /tmp/exported`).
  5. Inspect `/tmp/exported/manifest.yaml` — confirm `editor_layout` is present with the dragged positions.
  6. Simulate a "fresh server" by deleting the pack's editorJson row in the DB:
     `psql $DATABASE_URL -c "DELETE FROM pack_bundles WHERE pack_id='<pack_id>';"`
     Then force the plugin to republish by restarting it: `docker compose restart minecraft`.
  7. Wait for the plugin to reconnect and publish. Reload the editor in browser A — verify the menus are at the dragged positions, not the auto-grid.

If the smoke check fails: a step in the production code path is wrong. Re-run the affected unit test with `-v` to localize.

- [ ] **Step 5: Update CLAUDE.md tests row**

Edit `CLAUDE.md` to bump the test counts in the "Tests — ce qui est couvert" table. From the spec, expect roughly:
- Backend: +6 tests (Task 3: 6 tests; Task 4: 2 tests; Task 5: 2 tests; Task 7: 1 test ≈ 11 new).
- Editor: +3 tests (Tasks 1+2).
- Plugin: +1 test (Task 6).

Update the counts to match what `bun test` / `vitest run` / `gradlew test` actually report.

- [ ] **Step 6: Commit the docs update**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md — bump test counts for canvasLayout persistence feature"
```

---

## Done criteria

- All 7 production-code tasks above merged.
- A pack created on server A and file-copied (manifest.yaml + menus/) to server B opens in the editor on server B with cards at the same positions.
- The `link_codes schema` pre-existing failure is the only failing test in the suite.
