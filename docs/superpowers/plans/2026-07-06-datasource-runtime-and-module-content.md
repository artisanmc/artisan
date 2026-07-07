# Data-Source Runtime + Module Content Enablers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer les trois enablers core qui permettent à un Add-on (premier client : Boutique) d'alimenter des menus Artisan avec ses données, de stocker son contenu dans le project, et d'exposer ses data sources à l'éditeur.

**Architecture:** Trois phases indépendamment shippables. **Phase A** branche le fetch des `ConnectorBinding` (`context_inputs[].source`) sur le `DataSourceRegistry` au rendu des menus (la "Phase B" annoncée dans `ContextBinder.kt`). **Phase B** ajoute `api.project` (lecture du contenu project par les modules) + le seam d'export éditeur pour que les modules contribuent des fichiers au bundle. **Phase C** remonte les data sources enregistrées dans le `hello` WS → table backend → endpoint editor-session → source picker de l'éditeur.

**Tech Stack:** Kotlin 2.0 / Paper 1.21.4 / MockBukkit (plugin) · Bun + Hono + Drizzle/PostgreSQL (backend) · React 19 + Vite + Zustand + Vitest (éditeur).

**Suite prévue (plan séparé):** `2026-07-06-boutique-addon.md` — le rewrite de Boutique en Add-on Artisan consommera ces trois enablers. Ne pas le commencer avant que ce plan soit mergé.

## Global Constraints

- Plugin : tests via `cd plugin && ./gradlew test`. Jamais de logique bloquante sur le thread WS OkHttp.
- Backend : **TOUJOURS `bun run test` — JAMAIS `bun test` direct** (le wrapper redirige vers `artisan_test` ; le direct wipe la DB dev).
- Backend : tout changement de `backend/src/db/schema.ts` DOIT inclure le fichier de migration généré par `bun run db:generate`, committé.
- Éditeur : tests via `cd editor && npm test`. Strings UI via react-i18next : clés ajoutées à `en.ts` **et** `fr.ts` dans le même commit — jamais de français/anglais en dur dans le JSX.
- Tout commit qui touche `net.artisanmc.modules.api.*` ou ajoute un endpoint REST ajoute une entrée `[Unreleased]` dans `CHANGELOG.md`.
- Docs same-commit : WS protocol → `docs/architecture/ws-protocol.md` ; API publique → `docs/architecture/api-surface.md` ; schéma DB → `docs/architecture/entities.md`.
- Git : conventional commits ; `git add` avec chemins explicites, jamais `git add -A` (WIP permanent sur le repo).
- Data source fetchers s'exécutent sur le main thread au rendu : contrat = retour rapide, pas d'I/O bloquant (servir depuis un cache).
- Hermetic invariant : les refs de data source peuvent dangler — l'éditeur ne bloque jamais sur une ref inconnue, le runtime gère l'absence (liste vide + WARN).

---

## Phase A — ConnectorBinding runtime (la "Phase B" du ContextBinder)

### Task 1: ContextBinder — fetch des sources + filter/sort/limit

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/ContextBinder.kt`
- Test: `plugin/src/test/kotlin/net/artisanmc/plugin/engine/ContextBinderSourceTest.kt` (create)

**Interfaces:**
- Consumes: `MenuYaml.contextInputs: List<ContextInputYaml>` où `ContextInputYaml.source: Map<String, Any>` porte le ConnectorBinding brut (`ref`, `params?`, `filter?`, `sort?`, `limit?`) — cf. `plugin/src/main/kotlin/net/artisanmc/plugin/model/ProjectBundle.kt:31-37`.
- Produces: `ContextBinder.bind(menu: MenuYaml, callerArgs: Map<String, Any>, fetchSource: ((ref: String, params: Map<String, Any?>) -> List<Map<String, Any?>>)? = null, logger: java.util.logging.Logger? = null): Map<String, Any>` — Task 2 passe un `fetchSource` currifié sur le player. L'ancienne signature 2-args reste valide (defaults).

Sémantique (alignée sur `docs/schema/menu/v1/schema.json` `$defs/ConnectorBinding`) :
1. Les args de l'appelant gagnent toujours par nom (comportement existant, inchangé).
2. Pour chaque input non bindé avec `source.ref` non vide **et** `fetchSource != null` : interpoler les `params` (`{name}` ← inputs déjà bindés), fetcher, appliquer `filter` (égalité string après interpolation), `sort` (`by` + `direction`, numérique si possible sinon lexicographique), `limit`.
3. Fetch en échec (ref inconnue, exception fetcher) → **un** WARN + fallback sur `default` (pas de crash, pas de retry — no theater).
4. `fetchSource == null` (chemins legacy/tests) → la source est ignorée, `default` s'applique.

- [ ] **Step 1: Écrire le test qui échoue**

```kotlin
package net.artisanmc.plugin.engine

import net.artisanmc.plugin.model.ContextInputYaml
import net.artisanmc.plugin.model.MenuYaml
import kotlin.test.*

class ContextBinderSourceTest {

    private fun menu(vararg inputs: ContextInputYaml) =
        MenuYaml(schema = "menu/v1", id = "m", contextInputs = inputs.toList())

    private val rows: List<Map<String, Any?>> = listOf(
        mapOf("id" to "sword", "category" to "weapons", "price" to 100),
        mapOf("id" to "apple", "category" to "food", "price" to 5),
        mapOf("id" to "bow", "category" to "weapons", "price" to 80),
    )

    @Test fun `input with a source ref is populated by the fetcher`() {
        val m = menu(ContextInputYaml(name = "items", type = "list", source = mapOf("ref" to "shop:items")))
        val out = ContextBinder.bind(m, emptyMap(), fetchSource = { ref, _ ->
            assertEquals("shop:items", ref); rows
        })
        assertEquals(rows, out["items"])
    }

    @Test fun `caller-provided value wins over the source`() {
        val m = menu(ContextInputYaml(name = "items", type = "list", source = mapOf("ref" to "shop:items")))
        var fetched = false
        val out = ContextBinder.bind(m, mapOf("items" to listOf("x")), fetchSource = { _, _ -> fetched = true; rows })
        assertFalse(fetched)
        assertEquals(listOf("x"), out["items"])
    }

    @Test fun `params interpolate previously bound inputs`() {
        val m = menu(
            ContextInputYaml(name = "category", type = "string", default = "weapons"),
            ContextInputYaml(name = "items", type = "list",
                source = mapOf("ref" to "shop:items", "params" to mapOf("cat" to "{category}"))),
        )
        var seenParams: Map<String, Any?>? = null
        ContextBinder.bind(m, emptyMap(), fetchSource = { _, params -> seenParams = params; rows })
        assertEquals("weapons", seenParams?.get("cat"))
    }

    @Test fun `filter keeps matching rows only`() {
        val m = menu(ContextInputYaml(name = "items", type = "list",
            source = mapOf("ref" to "shop:items", "filter" to mapOf("category" to "weapons"))))
        val out = ContextBinder.bind(m, emptyMap(), fetchSource = { _, _ -> rows })
        @Suppress("UNCHECKED_CAST")
        val bound = out["items"] as List<Map<String, Any?>>
        assertEquals(listOf("sword", "bow"), bound.map { it["id"] })
    }

    @Test fun `sort desc and limit are applied after filter`() {
        val m = menu(ContextInputYaml(name = "items", type = "list",
            source = mapOf(
                "ref" to "shop:items",
                "sort" to mapOf("by" to "price", "direction" to "desc"),
                "limit" to 2,
            )))
        val out = ContextBinder.bind(m, emptyMap(), fetchSource = { _, _ -> rows })
        @Suppress("UNCHECKED_CAST")
        val bound = out["items"] as List<Map<String, Any?>>
        assertEquals(listOf("sword", "bow"), bound.map { it["id"] }) // 100, 80
    }

    @Test fun `fetcher failure falls back to default without throwing`() {
        val m = menu(ContextInputYaml(name = "items", type = "string", default = "none",
            source = mapOf("ref" to "shop:items")))
        val out = ContextBinder.bind(m, emptyMap(), fetchSource = { _, _ -> error("boom") })
        assertEquals("none", out["items"])
    }

    @Test fun `no fetcher leaves source inputs on their default`() {
        val m = menu(ContextInputYaml(name = "items", type = "string", default = "none",
            source = mapOf("ref" to "shop:items")))
        val out = ContextBinder.bind(m, emptyMap())
        assertEquals("none", out["items"])
    }
}
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd plugin && ./gradlew test --tests "net.artisanmc.plugin.engine.ContextBinderSourceTest"`
Expected: FAIL — compilation error (`bind` n'a pas de paramètre `fetchSource`).

- [ ] **Step 3: Implémenter**

Remplacer le corps de `ContextBinder.kt` (garder `coerce` tel quel, mettre à jour le KDoc — la "Phase B" est maintenant branchée) :

```kotlin
package net.artisanmc.plugin.engine

import net.artisanmc.plugin.model.MenuYaml
import org.bukkit.Bukkit
import java.util.logging.Logger

/**
 * Auto-binding §15.4 : les args de l'appelant (commande, open_menu.context,
 * alias d'itération) peuplent les context_inputs par nom ; les inputs à
 * `source` (ConnectorBinding) non fournis sont fetchés via [fetchSource]
 * (DataSourceRegistry curryfié sur le player, cf. MenuRenderer) ; les
 * defaults déclarés comblent le reste.
 */
object ContextBinder {
    fun bind(
        menu: MenuYaml,
        callerArgs: Map<String, Any>,
        fetchSource: ((ref: String, params: Map<String, Any?>) -> List<Map<String, Any?>>)? = null,
        logger: Logger? = null,
    ): Map<String, Any> {
        val out = callerArgs.toMutableMap()
        for (input in menu.contextInputs) {
            if (input.name.isEmpty() || out.containsKey(input.name)) continue
            val ref = (input.source["ref"] as? String)?.takeIf { it.isNotEmpty() }
            if (ref != null && fetchSource != null) {
                val rows = runCatching {
                    fetchSource(ref, interpolateValues(mapOf(input.source, "params"), out))
                }.getOrElse { e ->
                    logger?.warning("[Artisan] data source '$ref' failed for input '${input.name}': ${e.message}")
                    null
                }
                if (rows != null) {
                    out[input.name] = shape(rows, input.source, out)
                    continue
                }
            }
            val d = input.default ?: continue
            out[input.name] = coerce(d, input.type)
        }
        return out
    }

    /** filter (égalité string) → sort (numérique si possible) → limit. */
    private fun shape(
        rows: List<Map<String, Any?>>,
        source: Map<String, Any>,
        args: Map<String, Any>,
    ): List<Map<String, Any?>> {
        var result = rows
        val filter = mapOf(source, "filter")
        if (filter.isNotEmpty()) {
            result = result.filter { row ->
                filter.all { (field, expected) ->
                    row[field]?.toString() == interpolate(expected?.toString() ?: "", args)
                }
            }
        }
        val sort = source["sort"] as? Map<*, *>
        val by = sort?.get("by")?.toString()
        if (by != null) {
            val allNumeric = result.all { it[by]?.toString()?.toDoubleOrNull() != null }
            result = if (allNumeric) result.sortedBy { it[by].toString().toDouble() }
                     else result.sortedBy { it[by]?.toString() ?: "" }
            if (sort["direction"]?.toString() == "desc") result = result.reversed()
        }
        val limit = (source["limit"] as? Number)?.toInt()
        if (limit != null && limit > 0) result = result.take(limit)
        return result
    }

    private fun interpolate(raw: String, args: Map<String, Any>): String =
        Regex("\\{([a-z][a-z0-9_]*)}").replace(raw) { m -> args[m.groupValues[1]]?.toString() ?: m.value }

    private fun interpolateValues(map: Map<String, Any?>, args: Map<String, Any>): Map<String, Any?> =
        map.mapValues { (_, v) -> if (v is String) interpolate(v, args) else v }

    /** Sous-map nommée du ConnectorBinding brut ({} si absente/mal typée). */
    private fun mapOf(source: Map<String, Any>, key: String): Map<String, Any?> =
        (source[key] as? Map<*, *>)?.entries?.associate { it.key.toString() to it.value } ?: emptyMap()

    private fun coerce(raw: String, type: String): Any = when (type) {
        "integer" -> raw.toLongOrNull() ?: raw
        "number"  -> raw.toDoubleOrNull() ?: raw
        "boolean" -> raw.toBooleanStrictOrNull() ?: raw
        // Joueur hors-ligne → on garde la string brute ({target} reste rendable, pas de crash).
        "player"  -> Bukkit.getPlayerExact(raw) ?: raw
        else      -> raw
    }
}
```

Note : `private fun mapOf(...)` shadow le `kotlin.collections.mapOf` — si ça gêne le compilateur ou la lisibilité, renommer en `subMap` partout (3 call sites).

- [ ] **Step 4: Vérifier le vert + non-régression**

Run: `cd plugin && ./gradlew test`
Expected: PASS — la nouvelle suite ET les tests existants (l'ancien contrat 2-args est préservé par les defaults).

- [ ] **Step 5: Commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/plugin/engine/ContextBinder.kt plugin/src/test/kotlin/net/artisanmc/plugin/engine/ContextBinderSourceTest.kt
rtk git commit -m "feat(plugin): ContextBinder fetches ConnectorBinding sources (filter/sort/limit)"
```

---

### Task 2: Brancher le DataSourceRegistry au rendu (MenuRenderer → SyncedMenuProvider → ArtisanPlugin)

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/render/MenuRenderer.kt:36-51`
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt` (ctor ~ligne 63, `openMenu` ligne 166)
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt` (les DEUX sites de construction de `SyncedMenuProvider`, ~lignes 91-95 et ~247-251)
- Modify: `plugin/src/main/kotlin/net/artisanmc/modules/api/DataSourceDeclaration.kt` (KDoc contrat threading)
- Modify: `CHANGELOG.md`
- Test: `plugin/src/test/kotlin/net/artisanmc/plugin/MenuRendererDataSourceTest.kt` (create)

**Interfaces:**
- Consumes: `ContextBinder.bind(menu, args, fetchSource, logger)` (Task 1) ; `DataSourceRegistry.fetch(ref, player, params)` (existant, `@Stable`).
- Produces: `MenuRenderer.open(player, menu, lang, ctx, evaluator, lookupAsset, offsetEncoder, dataSources: DataSourceRegistry? = null)` — nouveau paramètre optionnel en dernière position, tous les appels existants compilent sans changement.

- [ ] **Step 1: Écrire le test qui échoue** (modelé sur `MenuRendererIterationTest.kt` — même harness MockBukkit + `BundleCompiler.compile`)

```kotlin
package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.modules.api.DataSourceDeclaration
import net.artisanmc.modules.api.DataSourceRegistry
import net.artisanmc.plugin.engine.BundleCompiler
import net.artisanmc.plugin.engine.ExecutionContext
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.render.MenuRenderer
import org.bukkit.Material
import kotlin.test.*

class MenuRendererDataSourceTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()
    private fun player() = MockBukkit.getMock()!!.addPlayer()

    private fun shopMenu(): MenuYaml = mapper.readValue(
        """
        schema: menu/v1
        id: shop
        title: []
        size: 27
        context_inputs:
          - name: items
            type: list
            source:
              ref: "boutique:items"
              filter: { category: "weapons" }
        layers:
          - id: main
            name: Main
            elements:
              - id: grid
                positions: "10-12"
                iterates: { source: items, alias: item }
                appearances:
                  - material: "{item.material}"
                    title: "{item.name}"
        """.trimIndent(),
    )

    @Test fun `iterating element renders rows fetched from a registered data source`() {
        val p = player()
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration(
            ref = "boutique:items",
            fetcher = { _, _ -> listOf(
                mapOf("id" to "sword", "name" to "Sword", "material" to "DIAMOND_SWORD", "category" to "weapons"),
                mapOf("id" to "apple", "name" to "Apple", "material" to "APPLE", "category" to "food"),
            ) },
        ))
        val menu = BundleCompiler.compile(shopMenu(), emptyMap())
        MenuRenderer.open(p, menu, "en", ExecutionContext(p), dataSources = registry)
        val inv = p.openInventory.topInventory
        assertEquals(Material.DIAMOND_SWORD, inv.getItem(10)?.type)
        assertNull(inv.getItem(11)) // apple filtrée (category != weapons)
    }

    @Test fun `unknown ref renders an empty grid without throwing`() {
        val p = player()
        val menu = BundleCompiler.compile(shopMenu(), emptyMap())
        MenuRenderer.open(p, menu, "en", ExecutionContext(p), dataSources = DataSourceRegistry())
        assertNull(p.openInventory.topInventory.getItem(10))
    }

    @Test fun `no registry keeps the legacy behavior`() {
        val p = player()
        val menu = BundleCompiler.compile(shopMenu(), emptyMap())
        MenuRenderer.open(p, menu, "en", ExecutionContext(p))
        assertNull(p.openInventory.topInventory.getItem(10))
    }
}
```

Si l'import de `BundleCompiler` diffère (vérifier son package réel via l'import dans `MenuRendererIterationTest.kt`), l'aligner.

- [ ] **Step 2: Vérifier l'échec**

Run: `cd plugin && ./gradlew test --tests "net.artisanmc.plugin.MenuRendererDataSourceTest"`
Expected: FAIL — `open` n'a pas de paramètre `dataSources`.

- [ ] **Step 3: Implémenter le wiring**

`MenuRenderer.kt` — ajouter l'import `net.artisanmc.modules.api.DataSourceRegistry`, le paramètre, et curryfier le player :

```kotlin
    fun open(
        player: Player,
        menu: BundleMenu,
        lang: String,
        ctx: ExecutionContext = ExecutionContext(player),
        evaluator: ConditionEvaluator = ConditionEvaluator.EMPTY,
        lookupAsset: (String) -> AssetEntry? = { null },
        offsetEncoder: OffsetEncoder = OffsetEncoder.EMPTY,
        dataSources: DataSourceRegistry? = null,
    ): MenuSession {
```

et remplacer la ligne 51 (`val boundCtx = ...`) par :

```kotlin
        // §15.4 : defaults déclarés (l'appelant gagne par nom) + fetch des
        // ConnectorBinding via le DataSourceRegistry, curryfié sur le player.
        val fetch: ((String, Map<String, Any?>) -> List<Map<String, Any?>>)? =
            dataSources?.let { reg -> { ref, params -> reg.fetch(ref, player, params) } }
        val boundCtx = ctx.copy(args = ContextBinder.bind(menu.yaml, ctx.args, fetch, Bukkit.getLogger()))
```

`SyncedMenuProvider.kt` — nouveau paramètre de constructeur (après `installedModules`, ligne ~63) :

```kotlin
    private val dataSources: net.artisanmc.modules.api.DataSourceRegistry? = null,
```

et ligne 166 :

```kotlin
        val session = MenuRenderer.open(player, menu, lang, ctx, evaluator, lookupAsset, offsetEncoderProvider(), dataSources)
```

`ArtisanPlugin.kt` — aux DEUX sites de construction de `SyncedMenuProvider` (celui avec `installedModules = ...` ligne ~94 et le site de réinit ligne ~250), ajouter :

```kotlin
            dataSources = api.dataSources,
```

`DataSourceDeclaration.kt` — compléter le KDoc du `fetcher` :

```kotlin
 * @param fetcher Pure function returning rows for a given player + params.
 *                Called on the server main thread at menu render time: MUST
 *                return fast (serve from an in-memory cache, no blocking I/O).
```

`CHANGELOG.md` — sous `[Unreleased]` / `### Added` :

```markdown
- Menus resolve `context_inputs[].source` (ConnectorBinding) through the `DataSourceRegistry` at render time — modules can now feed menu iteration via `api.dataSources.register(...)` (menu/v1 §14, "Phase B").
```

- [ ] **Step 4: Vérifier le vert**

Run: `cd plugin && ./gradlew test`
Expected: PASS, suite complète.

- [ ] **Step 5: Commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/plugin/render/MenuRenderer.kt plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt plugin/src/main/kotlin/net/artisanmc/modules/api/DataSourceDeclaration.kt plugin/src/test/kotlin/net/artisanmc/plugin/MenuRendererDataSourceTest.kt CHANGELOG.md
rtk git commit -m "feat(plugin): wire DataSourceRegistry into menu render (ConnectorBinding Phase B)"
```

---

## Phase B — Contenu module dans le project

### Task 3: `ProjectContentApi` + `ProjectContentReader`

**Files:**
- Create: `plugin/src/main/kotlin/net/artisanmc/modules/api/ProjectContentApi.kt`
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/project/ProjectContentReader.kt`
- Test: `plugin/src/test/kotlin/net/artisanmc/plugin/project/ProjectContentReaderTest.kt` (create)

**Interfaces:**
- Consumes: rien (pur filesystem).
- Produces: `interface ProjectContentApi { fun projectIds(): List<String>; fun list(projectId: String, dir: String): List<String>; fun read(projectId: String, relPath: String): String?; fun hasContent(dir: String): Boolean }` — Task 4 l'expose sur `ArtisanAPI` sous `val project`.

- [ ] **Step 1: Écrire le test qui échoue**

```kotlin
package net.artisanmc.plugin.project

import java.io.File
import java.nio.file.Files
import kotlin.test.*

class ProjectContentReaderTest {
    private lateinit var projectsDir: File
    private lateinit var reader: ProjectContentReader

    @BeforeTest fun setup() {
        projectsDir = Files.createTempDirectory("artisan-projects").toFile()
        File(projectsDir, "proj1/shop").mkdirs()
        File(projectsDir, "proj1/shop/items.yaml").writeText("items: []")
        File(projectsDir, "proj1/menus").mkdirs()
        File(projectsDir, "proj1/menus/main.yaml").writeText("id: main")
        File(projectsDir, "proj1/.artisan-sync.yaml").writeText("syncedHash: \"\"")
        File(projectsDir, ".artisan-trash").mkdirs()
        File(projectsDir, "proj2").mkdirs()
        reader = ProjectContentReader(projectsDir)
    }

    @AfterTest fun teardown() { projectsDir.deleteRecursively() }

    @Test fun `projectIds lists directories, hidden dirs excluded`() {
        assertEquals(listOf("proj1", "proj2"), reader.projectIds().sorted())
    }

    @Test fun `list returns relative file paths under the dir`() {
        assertEquals(listOf("items.yaml"), reader.list("proj1", "shop"))
        assertEquals(emptyList(), reader.list("proj1", "quests"))
        assertEquals(emptyList(), reader.list("nope", "shop"))
    }

    @Test fun `read returns file content or null`() {
        assertEquals("items: []", reader.read("proj1", "shop/items.yaml"))
        assertNull(reader.read("proj1", "shop/missing.yaml"))
    }

    @Test fun `hasContent is true when any project has a non-empty dir`() {
        assertTrue(reader.hasContent("shop"))
        assertFalse(reader.hasContent("quests"))
    }

    @Test fun `path traversal and artisan namespace are rejected`() {
        assertNull(reader.read("proj1", "../proj2/anything"))
        assertNull(reader.read("proj1", "..\\..\\secrets"))
        assertNull(reader.read("proj1", ".artisan-sync.yaml"))
        assertNull(reader.read("../..", "etc/passwd"))
    }
}
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd plugin && ./gradlew test --tests "net.artisanmc.plugin.project.ProjectContentReaderTest"`
Expected: FAIL — classes inexistantes.

- [ ] **Step 3: Implémenter**

`ProjectContentApi.kt` :

```kotlin
package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Stable

/**
 * Read-only view of the project content on disk for modules. Backed by
 * `plugins/Artisan/projects/`. Paths use '/' separators. The `.artisan*`
 * namespace (sync metadata, trash) is never exposed. Content refreshes on
 * bundle sync — modules should re-read in [ArtisanModule.onReload].
 */
@Stable
interface ProjectContentApi {
    /** Ids of projects present on disk (hidden directories excluded). */
    @Stable fun projectIds(): List<String>

    /** Relative file paths under `<projectId>/<dir>`, sorted. Empty if absent. */
    @Stable fun list(projectId: String, dir: String): List<String>

    /** UTF-8 content of a project file, or null if absent / outside the project root. */
    @Stable fun read(projectId: String, relPath: String): String?

    /** True if at least one project has a non-empty `<dir>/` folder (bootstrap check). */
    @Stable fun hasContent(dir: String): Boolean
}
```

`ProjectContentReader.kt` :

```kotlin
package net.artisanmc.plugin.project

import net.artisanmc.modules.api.ProjectContentApi
import java.io.File

class ProjectContentReader(private val projectsDir: File) : ProjectContentApi {

    override fun projectIds(): List<String> =
        projectsDir.listFiles()
            ?.filter { it.isDirectory && !it.name.startsWith(".") }
            ?.map { it.name }
            ?: emptyList()

    override fun list(projectId: String, dir: String): List<String> {
        val root = resolve(projectId, dir) ?: return emptyList()
        if (!root.isDirectory) return emptyList()
        return root.walkTopDown()
            .filter { it.isFile && !it.name.startsWith(".artisan") }
            .map { it.relativeTo(root).path.replace('\\', '/') }
            .sorted()
            .toList()
    }

    override fun read(projectId: String, relPath: String): String? {
        val f = resolve(projectId, relPath) ?: return null
        return if (f.isFile) f.readText(Charsets.UTF_8) else null
    }

    override fun hasContent(dir: String): Boolean = projectIds().any { pid ->
        resolve(pid, dir)?.let { it.isDirectory && !it.listFiles().isNullOrEmpty() } == true
    }

    /** Rejette la traversée hors project ('..', séparateurs dans l'id) et le namespace .artisan*. */
    private fun resolve(projectId: String, relPath: String): File? {
        if (projectId.contains("..") || projectId.contains('/') || projectId.contains('\\')) return null
        if (relPath.split('/', '\\').any { it == ".." || it.startsWith(".artisan") }) return null
        val projectRoot = File(projectsDir, projectId).canonicalFile
        val target = File(projectRoot, relPath).canonicalFile
        val inside = target == projectRoot ||
            target.path.startsWith(projectRoot.path + File.separator)
        return if (inside) target else null
    }
}
```

- [ ] **Step 4: Vérifier le vert**

Run: `cd plugin && ./gradlew test --tests "net.artisanmc.plugin.project.ProjectContentReaderTest"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/modules/api/ProjectContentApi.kt plugin/src/main/kotlin/net/artisanmc/plugin/project/ProjectContentReader.kt plugin/src/test/kotlin/net/artisanmc/plugin/project/ProjectContentReaderTest.kt
rtk git commit -m "feat(plugin): ProjectContentApi — read-only project content for modules"
```

---

### Task 4: Exposer `api.project` sur `ArtisanAPI` + docs

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/modules/api/ArtisanAPI.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt` (le site de construction d'`ArtisanAPI`, ~ligne 44)
- Modify: `docs/architecture/api-surface.md`, `CHANGELOG.md`
- Test: étendre le test existant d'`ArtisanAPI`/wiring si présent (`rtk grep "ArtisanAPI(" plugin/src/test` pour le trouver) ; sinon la compilation + suite complète suffit (pur wiring).

**Interfaces:**
- Consumes: `ProjectContentApi` + `ProjectContentReader` (Task 3).
- Produces: `ArtisanAPI.project: ProjectContentApi` (`@Stable`, since 1.2.0) — consommé par les Add-ons (Boutique lira `shop/*.yaml` par là).

- [ ] **Step 1: Ajouter la propriété**

Dans `ArtisanAPI.kt`, ajouter aux propriétés du constructeur (même style que `dataSources`) :

```kotlin
    @Stable val project: ProjectContentApi,
```

avec l'import `net.artisanmc.modules.api.ProjectContentApi` (même package — pas d'import nécessaire).

- [ ] **Step 2: Wirer dans ArtisanPlugin**

Au site de construction d'`ArtisanAPI` (~ligne 44, celui avec `dataSources = DataSourceRegistry(),`), ajouter :

```kotlin
                project = net.artisanmc.plugin.project.ProjectContentReader(java.io.File(dataFolder, "projects")),
```

Vérifier que `"projects"` correspond bien au répertoire utilisé par le provider filesystem existant (`rtk grep "projects" plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt`) et réutiliser la même référence si une constante existe.

- [ ] **Step 3: Vérifier le vert**

Run: `cd plugin && ./gradlew test`
Expected: PASS (le compilateur force la mise à jour de tout site de construction d'`ArtisanAPI`, y compris dans les tests — les mettre à jour avec un `ProjectContentReader(Files.createTempDirectory("p").toFile())` ou un fake inline `object : ProjectContentApi { ... }`).

- [ ] **Step 4: Docs**

`docs/architecture/api-surface.md` — après la section `SchemaRegistry`, ajouter :

```markdown
### `net.artisanmc.modules.api.ProjectContentApi`

Read-only project content on disk (`plugins/Artisan/projects/`). The `.artisan*` namespace is never exposed. Re-read in `onReload()` after a sync.

| Member | Type | Since |
|---|---|---|
| `projectIds()` | `List<String>` | 1.2.0 |
| `list(projectId: String, dir: String)` | `List<String>` | 1.2.0 |
| `read(projectId: String, relPath: String)` | `String?` | 1.2.0 |
| `hasContent(dir: String)` | `Boolean` | 1.2.0 |
```

et dans la table `ArtisanAPI` : `| project | ProjectContentApi | 1.2.0 |`.

`CHANGELOG.md` `[Unreleased]` / `### Added` :

```markdown
- `ArtisanAPI.project` (`ProjectContentApi`, since 1.2.0): read-only access to project files for modules — Add-ons store their content (e.g. `shop/items.yaml`) as standard project resources synced by the existing bundle pipeline.
```

- [ ] **Step 5: Commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/modules/api/ArtisanAPI.kt plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt docs/architecture/api-surface.md CHANGELOG.md
rtk git commit -m "feat(plugin): expose api.project (ProjectContentApi) on ArtisanAPI"
```

(+ les fichiers de test modifiés au Step 3 le cas échéant.)

---

### Task 5: Seam d'export éditeur — `FrontendModule.exportFiles`

**Files:**
- Modify: `editor/packages/editor-sdk/src/contract/types.ts`
- Modify: `editor/packages/editor-sdk/src/contract/registry.ts` (+ `editor/packages/editor-sdk/src/index.ts` pour le re-export)
- Modify: `editor/src/features/export/transform.ts` (fonction `transform`, ~ligne 663-728)
- Test: `editor/packages/editor-sdk/src/contract/registry.test.ts` (étendre) ; `editor/src/features/export/transform.test.ts` (étendre)

**Interfaces:**
- Consumes: le registre SDK existant (`registerModule`/`getModule` dans `registry.ts` — vérifier s'il expose une fonction de listing ; sinon l'ajouter, et vérifier dans `registry.test.ts` s'il existe déjà un reset de test à réutiliser).
- Produces: `FrontendModule.exportFiles?: (project: unknown) => Record<string, string>` + `collectModuleExportFiles(project: unknown): Record<string, string>` exportés du barrel `@artisan/editor-sdk`. `transform(pack)` inclut ces fichiers dans le bundle → ils passent hash/sync/download sans autre changement.

- [ ] **Step 1: Écrire le test SDK qui échoue** (dans `registry.test.ts`, en réutilisant le pattern de setup/reset des tests existants du fichier)

```typescript
describe("collectModuleExportFiles", () => {
  it("collects namespaced files from registered modules and drops out-of-namespace keys", () => {
    registerModule({
      id: "boutique",
      displayName: "Boutique",
      schemaVersion: "shop/v1",
      sidebar: { icon: () => null, label: "Boutique", to: "/m/boutique" },
      routes: [],
      exportFiles: () => ({
        "boutique/items.yaml": "items: []",
        "menus/hijack.yaml": "nope", // hors namespace → ignoré
      }),
    });
    expect(collectModuleExportFiles({})).toEqual({ "boutique/items.yaml": "items: []" });
  });

  it("returns {} when no module contributes files", () => {
    expect(collectModuleExportFiles({})).toEqual({});
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd editor && npm test -- packages/editor-sdk/src/contract/registry.test.ts`
Expected: FAIL — `collectModuleExportFiles` inexistant.

- [ ] **Step 3: Implémenter le SDK**

`types.ts`, dans `FrontendModule` :

```typescript
  /**
   * Files this module contributes to the project bundle on export, keyed by
   * project-relative path. Keys MUST live under "<moduleId>/" (enforced by
   * collectModuleExportFiles); out-of-namespace keys are dropped.
   */
  exportFiles?: (project: unknown) => Record<string, string>;
```

`registry.ts` (si aucune fonction de listing n'existe, ajouter `listModules(): FrontendModule[]` retournant les valeurs du Map interne) :

```typescript
export function collectModuleExportFiles(project: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const mod of listModules()) {
    if (!mod.exportFiles) continue;
    for (const [rel, content] of Object.entries(mod.exportFiles(project))) {
      if (!rel.startsWith(`${mod.id}/`)) continue;
      out[rel] = content;
    }
  }
  return out;
}
```

Re-exporter `collectModuleExportFiles` (et `listModules` si créé) depuis `editor/packages/editor-sdk/src/index.ts`.

- [ ] **Step 4: Test transform qui échoue** (dans `transform.test.ts`, avec le helper de construction de `Project` déjà utilisé par ce fichier)

```typescript
it("includes module-contributed files in the export map", () => {
  registerModule({
    id: "boutique",
    displayName: "Boutique",
    schemaVersion: "shop/v1",
    sidebar: { icon: () => null, label: "Boutique", to: "/m/boutique" },
    routes: [],
    exportFiles: () => ({ "boutique/items.yaml": "items: []" }),
  });
  const files = transform(makePack()); // helper existant du fichier
  const key = Object.keys(files).find((k) => k.endsWith("/boutique/items.yaml"));
  expect(key).toBeDefined();
  expect(files[key!]).toBe("items: []");
});
```

- [ ] **Step 5: Wirer transform**

Dans `transform.ts`, importer `collectModuleExportFiles` depuis `@artisan/editor-sdk`, et juste AVANT la ligne `files[`${base}/manifest.yaml`] = ...` (~ligne 728) :

```typescript
  for (const [rel, content] of Object.entries(collectModuleExportFiles(pack))) {
    files[`${base}/${rel}`] = content;
  }
```

- [ ] **Step 6: Vérifier le vert**

Run: `cd editor && npm test`
Expected: PASS, suite complète (les round-trip tests existants ne voient pas de module registré → comportement inchangé).

- [ ] **Step 7: Commit**

```bash
rtk git add editor/packages/editor-sdk/src/contract/types.ts editor/packages/editor-sdk/src/contract/registry.ts editor/packages/editor-sdk/src/index.ts editor/packages/editor-sdk/src/contract/registry.test.ts editor/src/features/export/transform.ts editor/src/features/export/transform.test.ts
rtk git commit -m "feat(editor): FrontendModule.exportFiles — modules contribute files to the project bundle"
```

---

### Task 6: Régression — les dossiers module font partie du hash de project

But : verrouiller que `BundleHasher` inclut un dossier inconnu (ex. `shop/`) dans le hash — c'est ce qui garantit que le contenu module participe à la détection de sync/conflit. Comportement attendu déjà en place (seuls `.`-prefixés au top-level et `.artisan*` sont filtrés) ; ce test le fige.

**Files:**
- Test: `plugin/src/test/kotlin/net/artisanmc/plugin/BundleHasherModuleDirTest.kt` (create)

**Interfaces:**
- Consumes: `BundleHasher` (lire `plugin/src/main/kotlin/.../BundleHasher.kt` d'abord — le test ci-dessous suppose `hashAll(dir: File): String` ; adapter le nom d'appel exact si besoin, sans changer les assertions).

- [ ] **Step 1: Écrire le test**

```kotlin
package net.artisanmc.plugin

import java.io.File
import java.nio.file.Files
import kotlin.test.*

class BundleHasherModuleDirTest {
    @Test fun `module-owned dirs participate in the project hash`() {
        val dir = Files.createTempDirectory("artisan-hash").toFile()
        try {
            File(dir, "menus").mkdirs()
            File(dir, "menus/main.yaml").writeText("id: main")
            val base = BundleHasher.hashAll(dir)

            File(dir, "shop").mkdirs()
            File(dir, "shop/items.yaml").writeText("items: []")
            val withModule = BundleHasher.hashAll(dir)
            assertNotEquals(base, withModule)

            File(dir, "shop/items.yaml").writeText("items: [sword]")
            assertNotEquals(withModule, BundleHasher.hashAll(dir))

            // Le namespace .artisan reste exclu.
            File(dir, ".artisan-sync.yaml").writeText("x: 1")
            assertEquals(BundleHasher.hashAll(dir), BundleHasher.hashAll(dir))
        } finally { dir.deleteRecursively() }
    }
}
```

- [ ] **Step 2: Vérifier le vert (ou corriger)**

Run: `cd plugin && ./gradlew test --tests "net.artisanmc.plugin.BundleHasherModuleDirTest"`
Expected: PASS directement. S'il échoue parce que `BundleHasher` filtre les dossiers inconnus, NE PAS changer l'algo sans mettre à jour le vecteur de conformance partagé (`testdata/pack-hash-conformance.json` + `hashUtils.test.ts` backend) — remonter le point avant de continuer.

- [ ] **Step 3: Commit**

```bash
rtk git add plugin/src/test/kotlin/net/artisanmc/plugin/BundleHasherModuleDirTest.kt
rtk git commit -m "test(plugin): pin module-owned dirs into the project hash"
```

---

## Phase C — Data sources visibles dans l'éditeur

### Task 7: Plugin — `declarations()` + `data_sources` dans hello / modules_changed

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/modules/api/DataSourceRegistry.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/sync/WsClient.kt` (paramètre + payload hello — repérer le builder du hello via `rtk grep "installed_modules" plugin/src/main/kotlin/net/artisanmc/plugin/sync/WsClient.kt`)
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt` (pass-through ctor + `notifyModulesChanged`, ligne ~194)
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt` (les deux sites, à côté d'`installedModules`)
- Modify: `docs/architecture/ws-protocol.md`, `docs/architecture/api-surface.md`, `CHANGELOG.md`
- Test: étendre le test existant qui pinne le payload hello (`rtk grep -l "installed_modules" plugin/src/test` pour le localiser) + test unitaire `declarations()` dans le test existant du registry s'il y en a un, sinon dans `ContextBinderSourceTest`-voisin `DataSourceRegistryTest`.

**Interfaces:**
- Consumes: `DataSourceDeclaration(ref, fetcher, schemaHint)`.
- Produces: `DataSourceRegistry.declarations(): List<DataSourceDeclaration>` (`@Stable`, since 1.2.0). Wire : hello et `modules_changed` portent `data_sources: [{ ref, schema_hint }]` — consommé par Task 8.

- [ ] **Step 1: Test registry qui échoue**

```kotlin
@Test fun `declarations returns registered declarations`() {
    val reg = DataSourceRegistry()
    val decl = DataSourceDeclaration(ref = "shop:items", fetcher = { _, _ -> emptyList() }, schemaHint = "id, name, price")
    reg.register(decl)
    assertEquals(listOf(decl), reg.declarations())
}
```

- [ ] **Step 2: Implémenter `declarations()`**

```kotlin
    @Stable
    fun declarations(): List<DataSourceDeclaration> = sources.values.sortedBy { it.ref }
```

- [ ] **Step 3: Étendre le payload hello**

Dans `WsClient.kt`, à côté du paramètre `installedModules: () -> List<Map<String, String>>`, ajouter :

```kotlin
    private val dataSources: () -> List<Map<String, Any?>> = { emptyList() },
```

et dans la map du message hello, à côté de `"installed_modules" to installedModules()` :

```kotlin
        "data_sources" to dataSources(),
```

`SyncedMenuProvider.kt` : pass-through ctor `private val dataSourcesReport: () -> List<Map<String, Any?>> = { emptyList() }` → passé au `WsClient(...)` (ligne ~119) ; et dans `notifyModulesChanged` (~ligne 194), ajouter `"data_sources" to dataSourcesReport()` au message envoyé.

`ArtisanPlugin.kt`, aux deux sites, à côté d'`installedModules = ...` :

```kotlin
            dataSourcesReport = { api.dataSources.declarations().map { mapOf("ref" to it.ref, "schema_hint" to it.schemaHint) } },
```

- [ ] **Step 4: Étendre le test hello existant**

Dans le test localisé au préambule (celui qui asserte `installed_modules` dans le payload hello), enregistrer une déclaration et asserter :

```kotlin
// après le parsing JSON du hello capturé :
val ds = parsed["data_sources"] as List<Map<String, Any?>>
assertEquals("shop:items", ds.single()["ref"])
assertEquals("id, name, price", ds.single()["schema_hint"])
```

(adapter au style d'assertion du fichier — MockWebServer + Jackson dans la suite full-sync.)

- [ ] **Step 5: Vérifier le vert**

Run: `cd plugin && ./gradlew test`
Expected: PASS.

- [ ] **Step 6: Docs**

`ws-protocol.md` : dans la doc du message `hello` (et `modules_changed`), ajouter le champ :

```markdown
| `data_sources` | `[{ ref, schema_hint }]` | Data sources enregistrées dans le `DataSourceRegistry` au moment de l'envoi. Alimente le source picker de l'éditeur. Absent/vide sur les vieux plugins. |
```

`api-surface.md` : ligne `| declarations() | List<DataSourceDeclaration> | 1.2.0 |` dans la table `DataSourceRegistry`.

`CHANGELOG.md` `[Unreleased]` / `### Added` :

```markdown
- `DataSourceRegistry.declarations()` (since 1.2.0); `hello` and `modules_changed` now report `data_sources: [{ref, schema_hint}]` so the editor can surface live sources in the menu source picker.
```

- [ ] **Step 7: Commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/modules/api/DataSourceRegistry.kt plugin/src/main/kotlin/net/artisanmc/plugin/sync/WsClient.kt plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt docs/architecture/ws-protocol.md docs/architecture/api-surface.md CHANGELOG.md
rtk git commit -m "feat(plugin): report registered data sources in hello/modules_changed"
```

(+ fichiers de test modifiés.)

---

### Task 8: Backend — persistance `server_data_sources` + endpoint editor-session

**Files:**
- Modify: `backend/src/protocol.ts` (HelloMessage ligne ~13, ModulesChangedMessage ligne ~133)
- Modify: `backend/src/db/schema.ts` (nouvelle table, modelée sur `serverModules` ligne ~86)
- Create: `backend/drizzle/NNNN_server_data_sources.sql` (généré par `bun run db:generate` — commit obligatoire)
- Modify: `backend/src/ws/hub.ts` (persist, appelé au hello ligne ~214 et dans le handler `modules_changed`)
- Modify: `backend/src/routes/editorSession.ts` (nouvelle route après `/:token/modules` ligne ~133)
- Modify: `docs/architecture/entities.md`, `docs/architecture/rest-endpoints.md`, `CHANGELOG.md`
- Test: étendre le fichier de test qui couvre `persistServerModules` (le localiser : `rtk grep -l "persistServerModules" backend/src`) + `backend/src/routes/editorSession.test.ts`

**Interfaces:**
- Consumes: `hello.data_sources` / `modules_changed.data_sources` (Task 7).
- Produces: table `server_data_sources(server_key_id, ref, schema_hint, reported_at)` PK `(server_key_id, ref)` ; `GET /api/v1/editor-session/:token/data-sources` → `{ data_sources: [{ ref, schema_hint }] }` — consommé par Task 9.

- [ ] **Step 1: Types protocole**

Dans `protocol.ts`, ajouter à `HelloMessage` ET `ModulesChangedMessage` :

```typescript
  // Data sources registered plugin-side (DataSourceRegistry). Drives the
  // editor's menu source picker. Absent/empty on older plugins.
  data_sources?: { ref: string; schema_hint?: string | null }[];
```

- [ ] **Step 2: Table + migration**

Dans `schema.ts`, après `serverModules`, en copiant exactement le style de `serverModules` (imports, index/PK, commentaire) :

```typescript
// Data sources reported by the plugin at every `hello` / `modules_changed`.
// Presence only — feeds the editor's menu source picker; refs may dangle
// (hermetic invariant: the editor never blocks on an unknown ref).
export const serverDataSources = pgTable(
	"server_data_sources",
	{
		serverKeyId: uuid("server_key_id").notNull().references(() => serverKeys.id, { onDelete: "cascade" }),
		ref: text("ref").notNull(),
		schemaHint: text("schema_hint"),
		reportedAt: timestamp("reported_at").notNull().defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.serverKeyId, t.ref] })],
);
```

Run: `cd backend && bun run db:generate`
Expected: nouveau fichier `backend/drizzle/NNNN_*.sql` — le committer.

- [ ] **Step 3: Test hub qui échoue** (dans le fichier des tests `persistServerModules`, même setup)

```typescript
describe("persistServerDataSources", () => {
  it("upserts reported sources and prunes the ones no longer reported", async () => {
    const keyId = await makeServerKey(); // helper existant du fichier
    await persistServerDataSources(keyId, [
      { ref: "boutique:items", schema_hint: "id, name, price" },
      { ref: "boutique:categories", schema_hint: null },
    ]);
    await persistServerDataSources(keyId, [{ ref: "boutique:items", schema_hint: "id, name" }]);
    const rows = await db.select().from(serverDataSources).where(eq(serverDataSources.serverKeyId, keyId));
    expect(rows).toHaveLength(1);
    expect(rows[0].ref).toBe("boutique:items");
    expect(rows[0].schemaHint).toBe("id, name");
  });
});
```

Run: `cd backend && bun run test`
Expected: FAIL — `persistServerDataSources` inexistant. (**Jamais `bun test` direct.**)

- [ ] **Step 4: Implémenter hub + route**

Dans `hub.ts`, sous `persistServerModules`, même structure upsert+prune :

```typescript
/** Même sémantique que persistServerModules, pour les data sources reportées. */
export async function persistServerDataSources(
  serverKeyId: string,
  reported: { ref: string; schema_hint?: string | null }[],
) {
  for (const ds of reported) {
    await db.insert(serverDataSources)
      .values({ serverKeyId, ref: ds.ref, schemaHint: ds.schema_hint ?? null, reportedAt: new Date() })
      .onConflictDoUpdate({
        target: [serverDataSources.serverKeyId, serverDataSources.ref],
        set: { schemaHint: ds.schema_hint ?? null, reportedAt: new Date() },
      });
  }
  const keep = reported.map((d) => d.ref);
  await db.delete(serverDataSources).where(
    keep.length === 0
      ? eq(serverDataSources.serverKeyId, serverKeyId)
      : and(eq(serverDataSources.serverKeyId, serverKeyId), notInArray(serverDataSources.ref, keep)),
  );
}
```

(adapter les imports drizzle du fichier ; si `persistServerModules` utilise une autre stratégie d'upsert, la copier à l'identique). L'appeler fire-and-forget aux deux points d'entrée, à côté des appels `persistServerModules` existants (hello ~ligne 214, et le handler `modules_changed`) :

```typescript
    persistServerDataSources(keyId, hello.data_sources ?? []).catch(() => {});
```

Dans `editorSession.ts`, après la route `/:token/modules` :

```typescript
// Data sources reported by this session's server — feeds the menu source picker.
router.get("/:token/data-sources", async (c) => {
  const session = await validateAccessToken(c.req.param("token"));
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const rows = await db
    .select()
    .from(serverDataSources)
    .where(eq(serverDataSources.serverKeyId, session.serverKeyId));
  return c.json({ data_sources: rows.map((r) => ({ ref: r.ref, schema_hint: r.schemaHint })) });
});
```

- [ ] **Step 5: Test route** (dans `editorSession.test.ts`, même pattern que le test de `/:token/modules`)

```typescript
it("GET /:token/data-sources returns reported sources, 401 on bad token", async () => {
  // setup session + insert serverDataSources rows via le helper du fichier
  const res = await app.request(`/api/v1/editor-session/${token}/data-sources`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.data_sources).toEqual([{ ref: "boutique:items", schema_hint: "id, name, price" }]);
  const bad = await app.request(`/api/v1/editor-session/not-a-token/data-sources`);
  expect(bad.status).toBe(401);
});
```

- [ ] **Step 6: Vérifier le vert**

Run: `cd backend && bun run test`
Expected: PASS, suite complète.

- [ ] **Step 7: Docs + commit**

`entities.md` : ajouter `server_data_sources` à côté de la description de `server_modules`. `rest-endpoints.md` : ligne d'index pour la nouvelle route → pointe vers `editorSession.ts`. `CHANGELOG.md` : `- GET /api/v1/editor-session/:token/data-sources — data sources reported by the connected server.`

```bash
rtk git add backend/src/protocol.ts backend/src/db/schema.ts backend/drizzle backend/src/ws/hub.ts backend/src/routes/editorSession.ts docs/architecture/entities.md docs/architecture/rest-endpoints.md CHANGELOG.md
rtk git commit -m "feat(backend): persist server-reported data sources + editor-session endpoint"
```

(+ fichiers de test.)

---

### Task 9: Éditeur — data sources live dans le source picker

**Files:**
- Create: `editor/src/lib/api/dataSources.ts`
- Create: `editor/src/state/serverDataSourcesStore.ts`
- Modify: le call site de `useModulesStore.integrate` (le localiser : `rtk grep -rn "integrate(" editor/src --include=*.tsx`) — déclencher `load()` au même endroit
- Modify: `editor/src/features/canvas/properties/MenuProperties.tsx` (`SourcePickerOptions`, ligne ~459)
- Modify: `editor/src/locales/en.ts`, `editor/src/locales/fr.ts`
- Modify: `docs/architecture/editor-internals.md` (section édition de menu / source picker)
- Test: `editor/src/state/serverDataSourcesStore.test.ts` (create)

**Interfaces:**
- Consumes: `GET /api/v1/editor-session/:token/data-sources` (Task 8).
- Produces: `useServerDataSourcesStore` → `{ sources: ServerDataSource[], status, load(accessToken) }` avec `ServerDataSource = { ref: string; schemaHint: string | null }` ; une section "On this server" dans le picker qui appelle `onPick(ref)` comme les sections existantes.

- [ ] **Step 1: Test store qui échoue** (modelé sur `modulesStore.test.ts` — même technique de mock de fetch)

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useServerDataSourcesStore } from "./serverDataSourcesStore";

describe("serverDataSourcesStore", () => {
  beforeEach(() => {
    useServerDataSourcesStore.setState({ sources: [], status: "idle" });
  });

  it("loads sources from the endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data_sources: [{ ref: "boutique:items", schema_hint: "id, name" }],
    }))));
    await useServerDataSourcesStore.getState().load("tok");
    expect(useServerDataSourcesStore.getState().sources).toEqual([
      { ref: "boutique:items", schemaHint: "id, name" },
    ]);
    expect(useServerDataSourcesStore.getState().status).toBe("ready");
  });

  it("stays idle-safe on failure (empty list, no throw)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await useServerDataSourcesStore.getState().load("tok");
    expect(useServerDataSourcesStore.getState().sources).toEqual([]);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd editor && npm test -- src/state/serverDataSourcesStore.test.ts`
Expected: FAIL — module inexistant.

- [ ] **Step 3: Implémenter**

`lib/api/dataSources.ts` :

```typescript
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface ServerDataSource {
  ref: string;
  schemaHint: string | null;
}

/** Data sources reported by the connected server. [] on any non-OK response. */
export async function fetchServerDataSources(accessToken: string): Promise<ServerDataSource[]> {
  const res = await fetch(`${API_URL}/api/v1/editor-session/${accessToken}/data-sources`);
  if (!res.ok) return [];
  const data = (await res.json()) as { data_sources?: { ref: string; schema_hint?: string | null }[] };
  return (data.data_sources ?? []).map((d) => ({ ref: d.ref, schemaHint: d.schema_hint ?? null }));
}
```

`state/serverDataSourcesStore.ts` :

```typescript
import { create } from "zustand";
import { fetchServerDataSources, type ServerDataSource } from "@/lib/api/dataSources";

interface ServerDataSourcesState {
  sources: ServerDataSource[];
  status: "idle" | "loading" | "ready";
  load: (accessToken: string) => Promise<void>;
}

export const useServerDataSourcesStore = create<ServerDataSourcesState>((set, get) => ({
  sources: [],
  status: "idle",
  async load(accessToken: string) {
    if (get().status !== "idle") return;
    set({ status: "loading" });
    const sources = await fetchServerDataSources(accessToken);
    set({ sources, status: "ready" });
  },
}));
```

Au call site de `useModulesStore.integrate(accessToken)`, ajouter juste à côté :

```typescript
useServerDataSourcesStore.getState().load(accessToken);
```

- [ ] **Step 4: Section picker**

Dans `SourcePickerOptions` (`MenuProperties.tsx` ~ligne 459), lire le store et rendre une troisième section après "Connectors", en dédupliquant contre les connectors déjà importés :

```tsx
  const serverSources = useServerDataSourcesStore((s) => s.sources);
  const knownRefs = new Set((pack.importedConnectors ?? []).map((c) => c.ref));
  const liveSources = serverSources.filter((s) => !knownRefs.has(s.ref));
```

```tsx
      {liveSources.length > 0 ? (
        <>
          {(hasProjectData || hasConnectors) ? <DropdownMenuSeparator /> : null}
          <DropdownMenuLabel className="text-[9px] uppercase text-[var(--text-faint)]">
            {t("menuProperties.refSectionServer")}
          </DropdownMenuLabel>
          {liveSources.map((s) => (
            <DropdownMenuItem
              key={s.ref}
              onSelect={() => onPick(s.ref as SourceRef)}
              title={s.schemaHint ?? undefined}
              className="cursor-pointer text-[11px] focus:bg-[var(--surface-raised-2)]"
            >
              <span className="mr-1">🛰</span>
              <span className="font-mono">{s.ref}</span>
              {s.schemaHint ? (
                <span className="ml-auto text-[9px] text-[var(--text-faint)]">{s.schemaHint}</span>
              ) : null}
            </DropdownMenuItem>
          ))}
        </>
      ) : null}
```

Mettre à jour la condition du fallback "no sources" existant : `!hasProjectData && !hasConnectors && liveSources.length === 0`.

Locales — `en.ts` : `refSectionServer: "On this server"` ; `fr.ts` : `refSectionServer: "Sur ce serveur"` (dans le bloc `menuProperties` existant).

- [ ] **Step 5: Vérifier le vert**

Run: `cd editor && npm test`
Expected: PASS, suite complète.

- [ ] **Step 6: Doc + commit**

`editor-internals.md` : dans la section sur l'édition de menu / contextInputs, une phrase : le source picker liste désormais les data sources live du serveur connecté (`server_data_sources`, section "On this server"), en plus des project data et des connectors importés ; les refs restent librement saisissables (invariant hermétique).

```bash
rtk git add editor/src/lib/api/dataSources.ts editor/src/state/serverDataSourcesStore.ts editor/src/state/serverDataSourcesStore.test.ts editor/src/features/canvas/properties/MenuProperties.tsx editor/src/locales/en.ts editor/src/locales/fr.ts docs/architecture/editor-internals.md
rtk git commit -m "feat(editor): surface live server data sources in the menu source picker"
```

(+ le fichier du call site `integrate`.)

---

## Vérification finale

- [ ] `cd plugin && ./gradlew test` — vert
- [ ] `cd backend && bun run test` — vert (**jamais `bun test`**)
- [ ] `cd editor && npm test` — vert
- [ ] Relire `CHANGELOG.md` `[Unreleased]` : 4 entrées (Phase B renderer, api.project, declarations()/hello, endpoint data-sources)
- [ ] Migration drizzle committée
- [ ] Invoquer `/sync-docs` pour auditer la dette doc résiduelle contre `doc-impact-map.yaml`

## Suite

Plan séparé `2026-07-06-boutique-addon.md` (à écrire une fois ce plan mergé) : rewrite de Boutique en Add-on Artisan — `BoutiqueModule : ArtisanModule` (data sources `boutique:categories`/`boutique:items` servies depuis `api.project`, command `boutique:buy` → `TransactionManager` conservé tel quel), schema `shop/v1`, menus/dialog `menu/v1` + `dialog/v1` de bootstrap, module éditeur `@artisan/boutique-editor` (table + `<SchemaForm>` + `exportFiles`), migration one-shot du `config.yml` MenuAPI.
