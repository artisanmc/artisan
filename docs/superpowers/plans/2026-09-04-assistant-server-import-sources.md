# Assistant Server Import Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à un membre d’un Project de joindre à l’assistant des fichiers texte sélectionnés dans des racines explicitement exposées par le plugin Minecraft.

**Architecture:** Le plugin parse les sources autorisées et reste seul responsable du confinement et de la lecture du disque. Le backend relaie deux opérations corrélées sur le WebSocket existant, expose uniquement les métadonnées à l’éditeur, puis résout le contenu au moment du tour IA sans le persister. L’éditeur réutilise le composer actuel avec un sélecteur serveur isolé et continue à supporter les uploads locaux.

**Tech Stack:** Kotlin 2.0/Paper, JUnit/Kotlin Test, Bun/Hono/TypeScript, React 19/Vite/Vitest/Testing Library, WebSocket JSON, i18next.

**Spec:** `docs/superpowers/specs/2026-09-04-assistant-server-import-sources-design.md`

## Global Constraints

- Lire la spec ci-dessus et `AGENTS.md` avant de commencer.
- Suivre TDD : écrire chaque test, constater son échec, implémenter le minimum, puis constater sa réussite.
- Lancer les tests backend avec `bun run test`, jamais avec `bun test` directement.
- Les lectures disque du plugin ne s’exécutent jamais sur le callback OkHttp.
- Les sources sont strictement read-only ; aucun endpoint ou message d’écriture n’est ajouté.
- Les limites sont fixes pour cette version : 5 000 entrées listées par source, 200 fichiers par tour, 1 Mio par fichier et 8 Mio cumulés.
- Les fichiers serveur ne sont ni mis en base ni conservés dans un cache backend.
- L’upload local `attachments: Record<string, string>` reste compatible.
- Les docs exigées par `AGENTS.md` accompagnent le code concerné dans le même commit.
- Réutiliser `Button`, `Input`, `Dialog` et `DropdownMenu`; aucun nouveau composant de design system n’est nécessaire.
- Préserver toutes les modifications utilisateur déjà présentes dans le worktree.

## File Structure

### Plugin

- `plugin/src/main/kotlin/net/artisanmc/plugin/config/PluginConfig.kt` — parse les déclarations de sources.
- `plugin/src/main/kotlin/net/artisanmc/plugin/assistant/ImportSourceReader.kt` — unique frontière read-only vers les racines tierces.
- `plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt` — adapte les messages WS au lecteur, sans logique de chemin.
- `plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt` — câble le lecteur lors du démarrage et du rechargement.
- `plugin/src/main/resources/config.yml` — exemples zMenu et DeluxeMenus distribués.
- `plugin/src/test/kotlin/net/artisanmc/plugin/PluginConfigTest.kt` — contrat du parsing.
- `plugin/src/test/kotlin/net/artisanmc/plugin/assistant/ImportSourceReaderTest.kt` — sécurité, récursivité et limites.
- `plugin/src/test/kotlin/net/artisanmc/plugin/assistant/ImportSourceWebSocketTest.kt` — adaptation WS asynchrone.

### Backend

- `backend/src/protocol.ts` — types wire des quatre messages.
- `backend/src/ws/hub.ts` — pending maps et fonctions de relais corrélées.
- `backend/src/ws/hub.test.ts` — offline, timeout, round-trip et erreurs.
- `backend/src/routes/userNetworks.ts` — route REST de listing contextualisée par Project.
- `backend/src/routes/userNetworks.test.ts` — auth, portée et traduction des erreurs.
- `backend/src/modules/assistant/serverAttachments.ts` — validation et résolution des références avant le tour.
- `backend/src/modules/assistant/serverAttachments.test.ts` — fusion, collisions et refus atomique.
- `backend/src/modules/assistant/routes.ts` — orchestre le préflight avant `WorkingCopy` et avant le modèle.
- `backend/src/modules/assistant/routes.test.ts` — garantit qu’un échec ne lance ni modèle ni débit.

### Éditeur

- `editor/src/lib/api/importSources.ts` — client typé du listing.
- `editor/src/lib/api/importSources.test.ts` — mapping des réponses et erreurs.
- `editor/src/lib/api/assistant.ts` — sérialise `serverAttachments` et expose les erreurs HTTP structurées.
- `editor/src/lib/api/assistant.test.ts` — compatibilité du payload et erreurs pré-SSE.
- `editor/src/features/assistant/importSourceTree.ts` — arbre, recherche, récursivité et résumé, sans React.
- `editor/src/features/assistant/importSourceTree.test.ts` — tests purs de sélection.
- `editor/src/features/assistant/ServerImportSourceDialog.tsx` — UI isolée de navigation.
- `editor/src/features/assistant/ServerImportSourceDialog.test.tsx` — loading, erreur, recherche et validation.
- `editor/src/features/assistant/AssistantChat.tsx` — intègre le menu d’origine et les groupes attachés.
- `editor/src/features/assistant/AssistantChat.test.tsx` — flux local/serveur et conservation du composer en erreur.
- `editor/src/features/assistant/AssistantBody.tsx` — transmet Network/Server/online au chat.
- `editor/src/routes/networks.$networkId.servers.$serverId.projects.$projectId.tsx` — fournit le contexte déjà connu de la route.
- `editor/src/locales/en.ts`, `editor/src/locales/fr.ts` — toute la copie visible.

### Documentation

- `docs/architecture/ws-protocol.md` — quatre messages et limites.
- `docs/architecture/rest-endpoints.md` — route de listing et extension du tour assistant.
- `docs-site/src/content/docs/getting-started/install-admin.md` — configuration des racines.
- `docs-site/src/content/docs/editor/assistant.md` — parcours utilisateur.
- `CHANGELOG.md` — entrée `[Unreleased]` pour l’endpoint et la fonctionnalité.

---

### Task 1: Parse configured sources and read them safely

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/config/PluginConfig.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt`
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/assistant/ImportSourceReader.kt`
- Modify: `plugin/src/main/resources/config.yml`
- Modify: `plugin/src/test/kotlin/net/artisanmc/plugin/PluginConfigTest.kt`
- Create: `plugin/src/test/kotlin/net/artisanmc/plugin/assistant/ImportSourceReaderTest.kt`
- Modify: `docs-site/src/content/docs/getting-started/install-admin.md`

**Interfaces:**
- Produces: `ImportSourceConfig`, `ImportSourceAccess`, `ImportSourceReader`, `ImportSelection`, `ImportSourceListing`, `ImportReadResult`.
- Consumes: Bukkit `FileConfiguration`, Java NIO `Path`/`Files`, `Logger`.

- [ ] **Step 1: Write failing configuration tests**

Add cases to `PluginConfigTest.kt` that assert exact ids, labels, paths, normalized lower-case extensions and disabled-source filtering:

```kotlin
@Test
fun `assistant import sources parse named roots`() {
    val yaml = YamlConfiguration()
    yaml.loadFromString("""
        assistant:
          import-sources:
            zmenu:
              enabled: true
              label: "zMenu"
              path: "plugins/zMenu/menus"
              extensions: [".YML", "yaml"]
            hidden:
              enabled: false
              label: "Hidden"
              path: "plugins/Hidden"
              extensions: [".yml"]
    """.trimIndent())

    assertEquals(
        listOf(ImportSourceConfig(
            id = "zmenu",
            label = "zMenu",
            path = "plugins/zMenu/menus",
            extensions = setOf(".yml", ".yaml"),
        )),
        PluginConfig.from(yaml).assistantImportSources,
    )
}
```

Also assert that ids outside `[a-z0-9][a-z0-9_-]*`, blank paths and empty extension sets are skipped instead of creating an unsafe source, and that each skipped declaration creates one `assistantImportSourceWarnings` entry.

- [ ] **Step 2: Write the failing reader tests**

Create `ImportSourceReaderTest.kt` with temporary roots. Use real files, not mocks:

```kotlin
private fun reader(root: Path, vararg sources: ImportSourceConfig) =
    ImportSourceReader(serverRoot = root, sources = sources.toList(), logger = null)

@Test
fun `lists allowed files recursively with normalized relative paths`() {
    val root = Files.createTempDirectory("artisan-import-")
    Files.createDirectories(root.resolve("plugins/zMenu/menus/categories"))
    Files.writeString(root.resolve("plugins/zMenu/menus/shop.yml"), "name: Shop")
    Files.writeString(root.resolve("plugins/zMenu/menus/categories/blocks.yaml"), "name: Blocks")
    Files.writeString(root.resolve("plugins/zMenu/menus/secret.txt"), "ignored")

    val listed = reader(root, source("zmenu", "plugins/zMenu/menus")).listAll()

    assertEquals(
        listOf("categories/blocks.yaml", "shop.yml"),
        listed.single().files.map { it.path },
    )
}

@Test
fun `one invalid selection rejects the whole read`() {
    val result = reader(root, source("zmenu", "allowed")).read(
        listOf(ImportSelection("zmenu", listOf("ok.yml", "../secret.yml"))),
    )
    assertEquals(ImportReadResult.Failure("invalid_path"), result)
}
```

Add explicit cases for hidden segments, absolute input, neighboring-prefix escape, unknown source, unsupported extension, missing file, directory input, symlink file, symlink intermediate directory, invalid UTF-8, 201 files, one file over 1 Mio, total over 8 Mio, and a source over 5 000 entries. Verify that an absent/unreadable root is omitted and logged, and that a source over 5 000 entries returns one listing with `error = "too_many_entries"` and no partial file list. Guard symlink cases with an assumption only when the test filesystem cannot create symlinks.

- [ ] **Step 3: Run the targeted plugin tests and verify RED**

Run:

```bash
cd plugin
./gradlew test --tests "net.artisanmc.plugin.PluginConfigTest" --tests "net.artisanmc.plugin.assistant.ImportSourceReaderTest"
```

Expected: compilation fails because the new types and reader do not exist.

- [ ] **Step 4: Implement the configuration contract**

Add these types and property in `PluginConfig.kt`:

```kotlin
data class ImportSourceConfig(
    val id: String,
    val label: String,
    val path: String,
    val extensions: Set<String>,
)

data class PluginConfig(
    val serverKey: String,
    val wsUrl: String,
    val editorConsoleOnly: Boolean,
    val language: String,
    val perPlayerLanguage: Boolean,
    val resourcePack: ResourcePackConfig,
    val assistantImportSources: List<ImportSourceConfig>,
    val assistantImportSourceWarnings: List<String>,
)
```

In `PluginConfig.from`, enumerate `assistant.import-sources` keys, require a safe id/non-blank path/non-empty extensions, ignore `enabled: false`, normalize extensions to lower case with one leading dot, and sort by id for deterministic output. Keep an absent section as an empty list so existing installations expose nothing until their config contains the new block. Collect rejected declarations in `assistantImportSourceWarnings`; log those warnings from both `ArtisanPlugin.onEnable()` and `ArtisanPlugin.reinit(cfg)`.

- [ ] **Step 5: Implement the isolated filesystem reader**

Create `ImportSourceReader.kt` with the following public-in-module contract:

```kotlin
data class ImportFileMeta(val path: String, val size: Long)
data class ImportSourceListing(
    val id: String,
    val label: String,
    val files: List<ImportFileMeta>,
    val error: String? = null,
)
data class ImportSelection(val sourceId: String, val paths: List<String>)
data class ImportedTextFile(val sourceId: String, val path: String, val content: String)

sealed interface ImportReadResult {
    data class Success(val files: List<ImportedTextFile>) : ImportReadResult
    data class Failure(val error: String, val message: String? = null) : ImportReadResult
}

interface ImportSourceAccess {
    fun listAll(): List<ImportSourceListing>
    fun read(selections: List<ImportSelection>): ImportReadResult
}
```

`ImportSourceReader` resolves relative configured roots against `serverRoot`, canonicalizes roots and targets, walks without following links, rejects any symbolic-link segment, and compares target containment using `Path.startsWith(rootCanonical)`. Listing reads only size metadata. Missing or unreadable roots are omitted and logged; a source over the listing limit is returned with `error = "too_many_entries"` and `files = emptyList()`. Reading validates every requested path and all limits before returning `Success`; collect into a temporary list and never return partial content.

Use named constants:

```kotlin
internal const val MAX_LISTED_ENTRIES = 5_000
internal const val MAX_FILES_PER_READ = 200
internal const val MAX_FILE_BYTES = 1024L * 1024L
internal const val MAX_TOTAL_BYTES = 8L * 1024L * 1024L
```

- [ ] **Step 6: Add distributed defaults and admin documentation**

Add the approved zMenu and DeluxeMenus entries to `config.yml`, including comments that the roots are read-only and explicitly exposed to Project members. Document relative versus absolute paths, extension filtering, symlink rejection and limits in `install-admin.md`.

- [ ] **Step 7: Run the targeted plugin tests and verify GREEN**

Run:

```bash
cd plugin
./gradlew test --tests "net.artisanmc.plugin.PluginConfigTest" --tests "net.artisanmc.plugin.assistant.ImportSourceReaderTest"
```

Expected: both test classes pass.

- [ ] **Step 8: Commit the safe reader slice**

```bash
git add plugin/src/main/kotlin/net/artisanmc/plugin/config/PluginConfig.kt plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt plugin/src/main/kotlin/net/artisanmc/plugin/assistant/ImportSourceReader.kt plugin/src/main/resources/config.yml plugin/src/test/kotlin/net/artisanmc/plugin/PluginConfigTest.kt plugin/src/test/kotlin/net/artisanmc/plugin/assistant/ImportSourceReaderTest.kt docs-site/src/content/docs/getting-started/install-admin.md
git commit -m "feat(plugin): add safe assistant import sources"
```

---

### Task 2: Relay source listing and reading over WebSocket

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt`
- Create: `plugin/src/test/kotlin/net/artisanmc/plugin/assistant/ImportSourceWebSocketTest.kt`
- Modify: `backend/src/protocol.ts`
- Modify: `backend/src/ws/hub.ts`
- Modify: `backend/src/ws/hub.test.ts`
- Modify: `docs/architecture/ws-protocol.md`

**Interfaces:**
- Consumes: `ImportSourceAccess.listAll()` and `.read()` from Task 1.
- Produces: `requestImportSourcesList(serverKeyId, timeoutMs?)` and `requestImportSourcesRead(serverKeyId, selections, timeoutMs?)`.
- Produces wire types: `ImportSourcesListMessage`, `ImportSourcesListResultMessage`, `ImportSourcesReadMessage`, `ImportSourcesReadResultMessage`.

- [ ] **Step 1: Write failing plugin WS adapter tests**

Create a fake `ImportSourceAccess`, inject it into `SyncedMenuProvider`, call private `handleMessage` through the established reflection helper, and await `setSendForTesting` with `CountDownLatch`:

```kotlin
private class FakeImportSourceAccess(
    private val listings: List<ImportSourceListing> = emptyList(),
    private val readResult: ImportReadResult = ImportReadResult.Success(emptyList()),
) : ImportSourceAccess {
    override fun listAll() = listings
    override fun read(selections: List<ImportSelection>) = readResult
}

private fun provider(importSources: ImportSourceAccess): SyncedMenuProvider =
    SyncedMenuProvider(
        roots = ProjectRoots(Files.createTempDirectory("artisan-projects-").toFile()),
        serverKey = "",
        wsUrl = "",
        logger = null,
        importSources = importSources,
    )

private fun handle(provider: SyncedMenuProvider, raw: String) {
    val method = provider.javaClass.getDeclaredMethod("handleMessage", String::class.java)
    method.isAccessible = true
    method.invoke(provider, raw)
}

@Test
fun `import_sources_list responds from the executor`() {
    val access = FakeImportSourceAccess(
        listings = listOf(ImportSourceListing(
            "zmenu", "zMenu", listOf(ImportFileMeta("shop.yml", 12)),
        )),
    )
    val sent = LinkedBlockingQueue<String>()
    val provider = provider(importSources = access).also { it.setSendForTesting(sent::add) }

    handle(provider, """{"type":"import_sources_list","request_id":"r1"}""")

    val json = jacksonObjectMapper().readTree(sent.poll(2, TimeUnit.SECONDS))
    assertEquals("import_sources_list_result", json["type"].asText())
    assertEquals("shop.yml", json["sources"][0]["files"][0]["path"].asText())
}
```

Add read-success, read-failure, malformed-selection and stopped-executor cases. Assert the handler returns promptly before the fake blocking reader is released, proving disk I/O is not performed on the callback thread.

- [ ] **Step 2: Write failing backend relay tests**

Extend `hub.test.ts` with offline, exact outgoing payload, correlated result, plugin error and 20 ms timeout for both functions:

```ts
test("round-trips import source metadata", async () => {
  const sent: Record<string, unknown>[] = [];
  registerConn("conn-import", (raw) => sent.push(JSON.parse(raw)));
  connToServerId.set("conn-import", "sk-import");
  try {
    const pending = requestImportSourcesList("sk-import");
    expect(sent[0]?.type).toBe("import_sources_list");
    await handlePluginMessage("conn-import", JSON.stringify({
      type: "import_sources_list_result",
      request_id: sent[0]?.request_id,
      ok: true,
      sources: [{ id: "zmenu", label: "zMenu", files: [{ path: "shop.yml", size: 12 }] }],
    }));
    expect(await pending).toMatchObject({ kind: "result", result: { ok: true } });
  } finally {
    connToServerId.delete("conn-import");
    connSenders.delete("conn-import");
  }
});
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
cd plugin
./gradlew test --tests "net.artisanmc.plugin.assistant.ImportSourceWebSocketTest"
```

Then:

```bash
cd backend
bun run test src/ws/hub.test.ts
```

Expected: missing constructor parameter, message types and relay functions.

- [ ] **Step 4: Implement plugin message adaptation and wiring**

Add a defaultable constructor dependency so existing tests remain small:

```kotlin
private val importSources: ImportSourceAccess = object : ImportSourceAccess {
    override fun listAll() = emptyList<ImportSourceListing>()
    override fun read(selections: List<ImportSelection>) = ImportReadResult.Success(emptyList())
},
```

Handle `import_sources_list` and `import_sources_read` by scheduling the entire call on `httpClient.dispatcher.executorService`, converting snake-case JSON at the boundary, and returning exactly one result with the original `request_id`. Do not put path validation in `SyncedMenuProvider`.

In both `SyncedMenuProvider` constructions in `ArtisanPlugin.kt`, inject:

```kotlin
importSources = ImportSourceReader(
    serverRoot = java.io.File(".").toPath(),
    sources = cfg.assistantImportSources,
    logger = logger,
),
```

- [ ] **Step 5: Implement backend protocol types and correlated relays**

Add exact wire interfaces in `protocol.ts` and include results in `PluginToServerMessage`, requests in `ServerToPluginMessage`:

```ts
export interface ImportSourcesListMessage {
  type: "import_sources_list";
  request_id: string;
}

export interface ImportSourcesListResultMessage {
  type: "import_sources_list_result";
  request_id: string;
  ok: boolean;
  sources?: {
    id: string;
    label: string;
    files: { path: string; size: number }[];
    error?: string | null;
  }[];
  error?: string;
  message?: string;
}

export interface ImportSourcesReadMessage {
  type: "import_sources_read";
  request_id: string;
  selections: { source_id: string; paths: string[] }[];
}

export interface ImportSourcesReadResultMessage {
  type: "import_sources_read_result";
  request_id: string;
  ok: boolean;
  files?: { source_id: string; path: string; content: string }[];
  error?: string;
  message?: string;
}
```

Mirror the `requestProjectRead` pattern in `hub.ts`: separate pending maps, offline short-circuit, timeout cleanup, sender call, and result dispatch in `handlePluginMessage`. Use 5 s for listing and 10 s for reading.

- [ ] **Step 6: Update the protocol documentation**

Add all four messages to `ws-protocol.md`, including directions, shapes, timeouts, old-plugin timeout behavior, UTF-8/read-only rule and the four numeric limits.

- [ ] **Step 7: Run both focused suites and verify GREEN**

Run:

```bash
cd plugin
./gradlew test --tests "net.artisanmc.plugin.assistant.ImportSourceWebSocketTest"
```

Then:

```bash
cd backend
bun run test src/ws/hub.test.ts
```

Expected: plugin adapter and backend relay tests pass with no hanging executor.

- [ ] **Step 8: Commit the relay slice**

```bash
git add plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt plugin/src/test/kotlin/net/artisanmc/plugin/assistant/ImportSourceWebSocketTest.kt backend/src/protocol.ts backend/src/ws/hub.ts backend/src/ws/hub.test.ts docs/architecture/ws-protocol.md
git commit -m "feat(assistant): relay server import sources"
```

---

### Task 3: Expose the authorized metadata listing to the editor

**Files:**
- Modify: `backend/src/routes/userNetworks.ts`
- Modify: `backend/src/routes/userNetworks.test.ts`
- Create: `editor/src/lib/api/importSources.ts`
- Create: `editor/src/lib/api/importSources.test.ts`
- Modify: `docs/architecture/rest-endpoints.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `requestImportSourcesList` from Task 2.
- Produces: `listImportSources(networkId, serverId, projectId): Promise<ImportSourcesResult>`.
- REST: `GET /api/v1/networks/:networkId/servers/:serverId/projects/:projectId/import-sources`.

- [ ] **Step 1: Write failing backend route tests**

Add a describe block that seeds a Network, Server and Project anchor, then covers 401, outsider 403, Project on another Server 404, offline 503, timeout 504, plugin error 502 and success:

```ts
async function waitForSentType(
  sent: Record<string, unknown>[],
  type: string,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const message = sent.find((entry) => entry.type === type);
    if (message) return message;
    await Bun.sleep(1);
  }
  throw new Error(`message ${type} was not sent`);
}

const path = `/api/v1/networks/${network.id}/servers/${keyId}/projects/${project.id}/import-sources`;
const pending = app.request(path, { headers: { Cookie: `artisan_user_session=${sessionId}` } });
const request = await waitForSentType(sent, "import_sources_list");
await handlePluginMessage(connId, JSON.stringify({
  type: "import_sources_list_result",
  request_id: request.request_id,
  ok: true,
  sources: [{ id: "zmenu", label: "zMenu", files: [{ path: "shop.yml", size: 12 }] }],
}));
const res = await pending;
expect(res.status).toBe(200);
expect(await res.json()).toEqual({
  sources: [{ id: "zmenu", label: "zMenu", files: [{ path: "shop.yml", size: 12 }] }],
});
```

- [ ] **Step 2: Run the backend route test and verify RED**

```bash
cd backend
bun run test src/routes/userNetworks.test.ts
```

Expected: 404 because the route is absent.

- [ ] **Step 3: Implement route scoping and error mapping**

Resolve Network/Server through existing `resolveNetworkServer`. Load `getProject(projectId)` and require both `project.networkId === resolved.networkId` and `project.serverKeyId === resolved.serverKeyId`; return 404 on mismatch to avoid disclosing another Project. Map relay outcomes:

```ts
if (outcome.kind === "offline") return c.json({ error: "server_offline" }, 503);
if (outcome.kind === "timeout") return c.json({ error: "fetch_timeout" }, 504);
if (!outcome.result.ok) {
  return c.json({
    error: outcome.result.error ?? "read_error",
    message: outcome.result.message ?? null,
  }, 502);
}
return c.json({ sources: outcome.result.sources ?? [] });
```

- [ ] **Step 4: Write the failing editor API tests**

Create `importSources.test.ts` and stub `fetch` for success, known errors and network failure:

```ts
it("returns typed source metadata", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    sources: [{ id: "zmenu", label: "zMenu", files: [{ path: "shop.yml", size: 12 }] }],
  }), { status: 200 })));

  await expect(listImportSources("n", "s", "p")).resolves.toEqual({
    ok: true,
    sources: [{ id: "zmenu", label: "zMenu", files: [{ path: "shop.yml", size: 12 }] }],
  });
});
```

Expected error union: `server_offline | fetch_timeout | read_error | network_error`.

- [ ] **Step 5: Run the editor API test and verify RED**

```bash
cd editor
npm test -- --run src/lib/api/importSources.test.ts
```

Expected: module/function not found.

- [ ] **Step 6: Implement the editor API client**

Create these exact types and return a discriminated result instead of throwing for expected availability errors:

```ts
export interface ImportSourceFile { path: string; size: number }
export interface ImportSource {
  id: string;
  label: string;
  files: ImportSourceFile[];
  error?: string | null;
}
export type ImportSourcesResult =
  | { ok: true; sources: ImportSource[] }
  | { ok: false; error: "server_offline" | "fetch_timeout" | "read_error" | "network_error" };
```

Use `credentials: "include"`, URL-encode all four path segments, parse the JSON body once and map unknown server errors to `read_error`.

- [ ] **Step 7: Update REST docs and changelog**

Add the route, response shape and error statuses to `rest-endpoints.md`. Add one `[Unreleased]` entry describing read-only server attachments and the new endpoint.

- [ ] **Step 8: Run focused backend/editor tests and verify GREEN**

Run:

```bash
cd backend
bun run test src/routes/userNetworks.test.ts
```

Then:

```bash
cd editor
npm test -- --run src/lib/api/importSources.test.ts
```

- [ ] **Step 9: Commit the listing slice**

```bash
git add backend/src/routes/userNetworks.ts backend/src/routes/userNetworks.test.ts editor/src/lib/api/importSources.ts editor/src/lib/api/importSources.test.ts docs/architecture/rest-endpoints.md CHANGELOG.md
git commit -m "feat(assistant): list authorized server files"
```

---

### Task 4: Resolve server attachments before an assistant turn

**Files:**
- Create: `backend/src/modules/assistant/serverAttachments.ts`
- Create: `backend/src/modules/assistant/serverAttachments.test.ts`
- Modify: `backend/src/modules/assistant/routes.ts`
- Modify: `backend/src/modules/assistant/routes.test.ts`
- Modify: `editor/src/lib/api/assistant.ts`
- Modify: `editor/src/lib/api/assistant.test.ts`
- Modify: `docs/architecture/rest-endpoints.md`

**Interfaces:**
- Consumes: `requestImportSourcesRead` from Task 2 and `resolveProjectAccess` already used by assistant routes.
- Produces: `ServerAttachmentSelection`, `resolveServerAttachments`, `AssistantRequestError`.
- Extends the assistant request body with `serverAttachments?: {sourceId: string; paths: string[]}[]`.

- [ ] **Step 1: Write failing resolver unit tests**

Create `serverAttachments.test.ts` with an injected read function:

```ts
test("namespaces returned files without colliding with local names", async () => {
  const read = mock(async () => ({
    kind: "result" as const,
    result: {
      type: "import_sources_read_result" as const,
      request_id: "r",
      ok: true,
      files: [{ source_id: "zmenu", path: "shop.yml", content: "name: Shop" }],
    },
  }));

  await expect(resolveServerAttachments("sk", [
    { sourceId: "zmenu", paths: ["shop.yml"] },
  ], read)).resolves.toEqual({
    ok: true,
    attachments: { "server:zmenu/shop.yml": "name: Shop" },
  });
});
```

Add malformed body, empty ids/paths, duplicate returned ids, offline, timeout and every plugin error mapping. Assert a result containing any invalid file returns no attachments.

- [ ] **Step 2: Write failing assistant route tests**

In `routes.test.ts`, seed a conversation with a server-backed Project and inject a fake provider. Bind a fake plugin connection, capture `import_sources_read`, reply, and assert `read_attachment` sees `server:zmenu/shop.yml`.

Add an error case where the plugin replies `invalid_path`; assert the HTTP response is 422, the provider was never invoked, no user/system message was saved, and the usage/credit state is unchanged.

- [ ] **Step 3: Run backend assistant tests and verify RED**

```bash
cd backend
bun run test src/modules/assistant/serverAttachments.test.ts src/modules/assistant/routes.test.ts
```

Expected: resolver missing and the current route ignores `serverAttachments`.

- [ ] **Step 4: Implement validation and resolution**

Create:

```ts
export interface ServerAttachmentSelection {
  sourceId: string;
  paths: string[];
}

export type ImportSourcesReadFn = typeof requestImportSourcesRead;

export type ResolvedServerAttachments =
  | { ok: true; attachments: Record<string, string> }
  | { ok: false; error: string; status: 404 | 422 | 502 | 503 | 504; message?: string | null };

export async function resolveServerAttachments(
  serverKeyId: string,
  raw: unknown,
  read: ImportSourcesReadFn = requestImportSourcesRead,
): Promise<ResolvedServerAttachments>;
```

`resolveServerAttachments(serverKeyId, raw, read = requestImportSourcesRead)` strictly validates the array, converts camelCase to the wire selection, maps the response to `server:<source>/<path>`, rejects duplicate ids, and maps statuses as follows:

- 404: `unknown_source`, `not_found`;
- 422: `invalid_input`, `invalid_path`, `unsupported_file`, `too_many_files`, `file_too_large`, `too_large`, `invalid_utf8`;
- 502: `read_error` and unknown plugin failures;
- 503: offline;
- 504: timeout.

- [ ] **Step 5: Integrate the preflight into the assistant route**

After conversation ownership and `resolveProjectAccess`, but before constructing `WorkingCopy`, appending transcript messages or entering `streamSSE`:

```ts
const serverResolved = await resolveServerAttachments(
  access.serverKeyId,
  (body as Record<string, unknown>).serverAttachments,
);
if (!serverResolved.ok) {
  return c.json({ error: serverResolved.error, message: serverResolved.message ?? null }, serverResolved.status);
}
const allAttachments = { ...attachments, ...serverResolved.attachments };
```

Use `allAttachments` for `WorkingCopy`, the attachment note, and the conversation title. Skip the relay entirely when the field is absent or an empty array. Preserve the current credit gate, but guarantee no debit/model call can occur after a failed preflight.

- [ ] **Step 6: Write failing client error tests**

Extend `assistant.test.ts`:

```ts
it("throws a structured error for server attachment preflight failures", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(
    JSON.stringify({ error: "invalid_path", message: "categories/x.yml" }),
    { status: 422, headers: { "Content-Type": "application/json" } },
  )));

  const stream = streamAssistant("c1", {
    text: "migrate",
    serverAttachments: [{ sourceId: "zmenu", paths: ["categories/x.yml"] }],
  });
  await expect(stream.next()).rejects.toMatchObject({
    name: "AssistantRequestError",
    code: "invalid_path",
    status: 422,
  });
});
```

- [ ] **Step 7: Implement the client request/error contract**

Add `serverAttachments` to the request body type and export:

```ts
export class AssistantRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message?: string | null,
  ) {
    super(message || code);
    this.name = "AssistantRequestError";
  }
}
```

Keep the dedicated 402 event behavior. For every other non-OK response, parse `{error,message}` and throw `AssistantRequestError` before touching `res.body`.

- [ ] **Step 8: Document the assistant endpoint extension**

Update the assistant route entry in `rest-endpoints.md` with `serverAttachments`, preflight status mapping, no-persistence guarantee and no-credit-on-preflight-failure behavior.

- [ ] **Step 9: Run focused backend/editor tests and verify GREEN**

```bash
cd backend
bun run test src/modules/assistant/serverAttachments.test.ts src/modules/assistant/routes.test.ts
```

```bash
cd editor
npm test -- --run src/lib/api/assistant.test.ts
```

- [ ] **Step 10: Commit the assistant preflight slice**

```bash
git add backend/src/modules/assistant/serverAttachments.ts backend/src/modules/assistant/serverAttachments.test.ts backend/src/modules/assistant/routes.ts backend/src/modules/assistant/routes.test.ts editor/src/lib/api/assistant.ts editor/src/lib/api/assistant.test.ts docs/architecture/rest-endpoints.md
git commit -m "feat(assistant): resolve server attachments before turns"
```

---

### Task 5: Build the server-source selector as an isolated UI

**Files:**
- Create: `editor/src/features/assistant/importSourceTree.ts`
- Create: `editor/src/features/assistant/importSourceTree.test.ts`
- Create: `editor/src/features/assistant/ServerImportSourceDialog.tsx`
- Create: `editor/src/features/assistant/ServerImportSourceDialog.test.tsx`
- Modify: `editor/src/locales/en.ts`
- Modify: `editor/src/locales/fr.ts`

**Interfaces:**
- Consumes: `listImportSources` and `ImportSource` from Task 3.
- Produces: `ServerAttachmentGroup` and `ServerImportSourceDialog`.

- [ ] **Step 1: Write failing pure tree tests**

Create tests for sorted reconstruction, recursive folder selection, intermediate checkbox state, filtering that retains ancestors, and summary deduplication:

```ts
it("selects every descendant of a folder", () => {
  const tree = buildImportTree([
    { path: "root.yml", size: 10 },
    { path: "categories/blocks.yml", size: 20 },
    { path: "categories/tools.yml", size: 30 },
  ]);
  const categories = tree.find((node) => node.path === "categories");
  if (!categories) throw new Error("categories node missing");
  const selected = toggleTreePath(new Set(), categories, true);
  expect([...selected].sort()).toEqual([
    "categories/blocks.yml",
    "categories/tools.yml",
  ]);
  expect(summarizeSelection(selected, tree)).toEqual({ count: 2, bytes: 50 });
});
```

- [ ] **Step 2: Write failing Dialog component tests**

Mock `listImportSources` and cover:

```tsx
const user = userEvent.setup();
const onAttach = vi.fn();
render(
  <ServerImportSourceDialog
    open
    onOpenChange={vi.fn()}
    networkId="n"
    serverId="s"
    projectId="p"
    onAttach={onAttach}
  />,
);
await user.click(await screen.findByRole("checkbox", { name: /categories/i }));
await user.click(screen.getByRole("button", { name: /attach|joindre/i }));
expect(onAttach).toHaveBeenCalledWith([
  {
    sourceId: "zmenu",
    label: "zMenu",
    files: [
      { path: "categories/blocks.yml", size: 20 },
      { path: "categories/tools.yml", size: 30 },
    ],
  },
]);
```

Also cover loading, no configured source, offline, timeout with Retry, per-source `error`, search, source switching, known-limit prevention and cancel.

- [ ] **Step 3: Run selector tests and verify RED**

```bash
cd editor
npm test -- --run src/features/assistant/importSourceTree.test.ts src/features/assistant/ServerImportSourceDialog.test.tsx
```

Expected: both modules are absent.

- [ ] **Step 4: Implement the pure tree model**

Use this boundary:

```ts
export interface ImportTreeNode {
  name: string;
  path: string;
  kind: "directory" | "file";
  size: number;
  children: ImportTreeNode[];
}

export function buildImportTree(files: ImportSourceFile[]): ImportTreeNode[];
export function descendantFiles(node: ImportTreeNode): ImportSourceFile[];
export function toggleTreePath(selected: Set<string>, node: ImportTreeNode, checked: boolean): Set<string>;
export function selectionState(selected: Set<string>, node: ImportTreeNode): "none" | "some" | "all";
export function filterImportTree(nodes: ImportTreeNode[], query: string): ImportTreeNode[];
export function summarizeSelection(selected: Set<string>, nodes: ImportTreeNode[]): { count: number; bytes: number };
```

Keep all mutations immutable so React updates reliably. Sort directories before files, then compare names case-insensitively with the raw name as deterministic tie-breaker.

- [ ] **Step 5: Implement the Dialog**

Export:

```ts
export interface ServerAttachmentGroup {
  sourceId: string;
  label: string;
  files: ImportSourceFile[];
}

export function ServerImportSourceDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  networkId: string;
  serverId: string;
  projectId: string;
  onAttach(groups: ServerAttachmentGroup[]): void;
}): JSX.Element;
```

Fetch on open and on Retry/Refresh. Use existing `Dialog`, `Button`, `Input` and semantic CSS tokens. Rebuild the tree from metadata, keep one selection set per source, disable Attach at zero files or when the total across all sources exceeds 200/8 Mio, and return every non-empty source group with files in sorted path order. A per-source listing error is visible and cannot be selected.

- [ ] **Step 6: Add all English and French copy**

Under `assistant.serverFiles`, add keys for source labels, search, empty, offline, timeout, retry, refresh, attach, cancel, summary, over-limit, expand and remove. Do not hard-code visible strings in the component.

- [ ] **Step 7: Run selector tests and verify GREEN**

Run:

```bash
cd editor
npm test -- --run src/features/assistant/importSourceTree.test.ts src/features/assistant/ServerImportSourceDialog.test.tsx
```

- [ ] **Step 8: Commit the isolated selector**

```bash
git add editor/src/features/assistant/importSourceTree.ts editor/src/features/assistant/importSourceTree.test.ts editor/src/features/assistant/ServerImportSourceDialog.tsx editor/src/features/assistant/ServerImportSourceDialog.test.tsx editor/src/locales/en.ts editor/src/locales/fr.ts
git commit -m "feat(editor): add server import source selector"
```

---

### Task 6: Integrate server groups into the assistant composer

**Files:**
- Modify: `editor/src/features/assistant/AssistantChat.tsx`
- Modify: `editor/src/features/assistant/AssistantChat.test.tsx`
- Modify: `editor/src/features/assistant/AssistantBody.tsx`
- Modify: `editor/src/features/assistant/AssistantBody.test.tsx`
- Modify: `editor/src/routes/networks.$networkId.servers.$serverId.projects.$projectId.tsx`
- Modify: `docs-site/src/content/docs/editor/assistant.md`

**Interfaces:**
- Consumes: `ServerImportSourceDialog`, `ServerAttachmentGroup`, `AssistantRequestError` and extended `streamAssistant`.
- Produces: complete user-facing local/server attachment flow.

- [ ] **Step 1: Write failing context-propagation tests**

Update `AssistantBody.test.tsx` so the chat receives the route context:

```tsx
render(
  <AssistantBody
    projectId={projectId("p")}
    networkId="n"
    serverId="s"
    serverOnline={false}
  />,
);
await user.click(screen.getByRole("button", { name: /new|nouvelle/i }));
expect(screen.getByTestId("assistant-panel")).toBeTruthy();
await user.click(screen.getByRole("button", { name: /attach|joindre/i }));
expect(screen.getByRole("menuitem", { name: /server|serveur/i })).toHaveAttribute("data-disabled");
```

Mock only the child when the test is about prop forwarding; keep one integration test with the real chat.

- [ ] **Step 2: Write failing composer integration tests**

Extend `AssistantChat.test.tsx` to cover:

- trombone opens Local/Server choices;
- local choice still clicks the hidden file input;
- server choice opens the Dialog;
- attached group renders `zMenu · 2 files`, expands, and removes;
- local and server attachments coexist in the payload;
- attachments-only send is enabled for a server group;
- pre-SSE `AssistantRequestError` preserves input and both attachment origins and does not add a user bubble;
- a successfully accepted stream clears both origins once.

Representative payload assertion:

```ts
expect(streamAssistant).toHaveBeenCalledWith("c1", expect.objectContaining({
  text: "migre tout",
  attachments: { "local.yml": "name: Local" },
  serverAttachments: [{
    sourceId: "zmenu",
    paths: ["categories/blocks.yml", "shop.yml"],
  }],
}));
```

- [ ] **Step 3: Run assistant UI tests and verify RED**

```bash
cd editor
npm test -- --run src/features/assistant/AssistantBody.test.tsx src/features/assistant/AssistantChat.test.tsx
```

Expected: missing props, menu, Dialog and server payload.

- [ ] **Step 4: Propagate route context explicitly**

Change the component contracts:

```ts
interface AssistantContextProps {
  projectId: ProjectId;
  networkId: string;
  serverId: string;
  serverOnline: boolean;
}
```

The Project route already owns `networkId`, `serverId` and `offline`; pass `serverOnline={!offline}` to `AssistantBody`, then forward all values to `AssistantChat`. Do not rediscover routing context inside the feature.

- [ ] **Step 5: Integrate the two attachment origins**

Keep local content as `Record<string, string>` and add:

```ts
const [serverGroups, setServerGroups] = useState<ServerAttachmentGroup[]>([]);
const serverFileCount = serverGroups.reduce((n, group) => n + group.files.length, 0);
```

Wrap the trombone with `DropdownMenu`; Local triggers the existing input and Server opens `ServerImportSourceDialog`. Merge a repeated source selection by path so a file appears once. Render each server source as a group chip with expandable file list and remove action.

Serialize groups as sorted explicit paths. A disabled Server item must include a visible/accessible offline explanation, while Local remains enabled.

- [ ] **Step 6: Preserve the composer until the stream is accepted**

Do not clear input or append the user bubble before the request can reject. Prime the generator first:

```ts
const stream = streamAssistant(convId.current, requestBody);
const first = await stream.next();
commitSentComposer(); // append bubble, clear input/local/server groups
if (!first.done) handleAssistantEvent(first.value);
for await (const event of stream) handleAssistantEvent(event);
```

Extract the existing event switch into `handleAssistantEvent` inside the component. If `stream.next()` throws `AssistantRequestError`, show the mapped localized message, retain the exact composer state, and do not append a transcript entry. Preserve existing behavior for a failure after acceptance: the sent bubble remains and the interrupted line appears.

- [ ] **Step 7: Update the user guide in the same commit**

Extend `docs-site/src/content/docs/editor/assistant.md` with Local versus Server, recursive selection, configured-source requirement, offline fallback, read-only guarantee, limits and the fact that files are read when Send is pressed.

- [ ] **Step 8: Run focused UI tests and verify GREEN**

Run:

```bash
cd editor
npm test -- --run src/features/assistant/AssistantBody.test.tsx src/features/assistant/AssistantChat.test.tsx
```

- [ ] **Step 9: Run the complete editor test suite and build**

```bash
cd editor
npm test -- --run
npm run lint
npm run build
```

Expected: all tests and lint pass; production build completes.

- [ ] **Step 10: Commit the integrated flow**

```bash
git add editor/src/features/assistant/AssistantChat.tsx editor/src/features/assistant/AssistantChat.test.tsx editor/src/features/assistant/AssistantBody.tsx editor/src/features/assistant/AssistantBody.test.tsx 'editor/src/routes/networks.$networkId.servers.$serverId.projects.$projectId.tsx' docs-site/src/content/docs/editor/assistant.md
git commit -m "feat(assistant): attach files from the linked server"
```

---

### Task 7: Verify the complete feature and audit documentation

**Files:**
- Inspect: all files changed by Tasks 1–6.
- Conditionally modify after review: only documentation identified by `sync-docs`.

**Interfaces:**
- Consumes: the complete end-to-end feature.
- Produces: verification evidence and a clean documentation-impact audit.

- [ ] **Step 1: Run the complete plugin suite and artifact build**

```bash
cd plugin
./gradlew test
./gradlew shadowJar
```

Expected: all plugin tests pass and the shadow JAR is produced.

- [ ] **Step 2: Run the complete backend suite**

```bash
cd backend
bun run test
```

Expected: the wrapper reports the isolated `artisan_test` database and all tests pass.

- [ ] **Step 3: Re-run the complete editor verification**

```bash
cd editor
npm test -- --run
npm run lint
npm run build
```

Expected: tests, lint and build all pass.

- [ ] **Step 4: Run the documentation impact audit**

Invoke the project `sync-docs` skill against the branch diff. Expected coverage:

- `hub.ts`/`protocol.ts` → `docs/architecture/ws-protocol.md`;
- `userNetworks.ts`/assistant REST contract → `docs/architecture/rest-endpoints.md` and `CHANGELOG.md`;
- `config.yml` → `install-admin.md`;
- user-facing assistant UI → `docs-site/.../editor/assistant.md`.

If the audit proposes a patch, present it for review as required by the skill, apply only the approved documentation changes, run `git diff --check`, then commit:

```bash
git add docs docs-site CHANGELOG.md
git commit -m "docs: align server attachment documentation"
```

If the audit finds no debt, do not create an empty commit.

- [ ] **Step 5: Inspect final diff and repository status**

```bash
git diff --check HEAD~6..HEAD
git status --short
git log -7 --oneline
```

Expected: no whitespace errors; only the user’s pre-existing unrelated changes remain unstaged; six feature commits are visible, plus the optional documentation-audit commit.

- [ ] **Step 6: Perform one manual dev-stack smoke test**

With a linked local server and a temporary allowed source containing two cross-referencing YAML menus:

1. Open a Project’s Assistant tab.
2. Choose **Attach → From server**.
3. Select their parent folder and verify the `2 files` summary.
4. Send “Migrate these menus to Artisan.”
5. Verify the assistant reads both namespaced attachments and emits the generated menus without modifying the source files.
6. Stop the Minecraft server and verify the server choice is disabled while local upload remains usable.

Record the observed result in the task handoff; do not commit test fixtures or server data.
