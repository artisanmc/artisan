# Data-driven menus runtime — Phase A : itération + pagination (plugin)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Le plugin rend réellement les éléments `iterates` (fenêtrage par page, `{alias.field}` résolu, clics par item) et la pagination devient fonctionnelle (actions `pagination_next/prev` + conditions `pagination_at_first/last`), à partir de listes présentes dans le contexte (args appelant / defaults). La livraison de données (connecteurs, `pack:` data sources) est la **Phase B** (plan séparé).

**Architecture:** Le wire `menu/v1` porte déjà `context_inputs` et `iterates` (l'éditeur les exporte) — le plugin les ignore. On ajoute : (1) parsing Jackson de ces champs ; (2) `ArgResolver` partagé qui résout `{name}` et `{alias.field}` (champ d'un Map) ; (3) `ContextBinder` qui applique les defaults déclarés (l'appelant gagne par nom, §15.4) ; (4) la boucle de rendu de `MenuRenderer` fenêtre les éléments itérants (pageSize = nb de slots de l'élément) avec un contexte par item, et mémorise `slotArgs` pour les clics ; (5) l'état de pagination voyage dans `ExecutionContext` (`pagination` demandé + `pageInfo` calculé au rendu), donc aucun changement de signature de `MenuProvider` ; les actions/conditions de pagination lisent/écrivent ce contexte et re-render via `openMenu`. Côté éditeur/assistant, `pagination_at_first/last` entrent dans le sous-ensemble une fois le runtime réel.

**Tech Stack:** Kotlin 2.0 + Paper 1.21.4, MockBukkit (JUnit 5, `./gradlew test`), Jackson ; éditeur React/TS (vitest), backend Bun.

**État des lieux vérifié (2026-06-11):**
- `transform.ts` exporte `context_inputs` (forme canonique `{name,type,default?,source:{ref}}` depuis le commit « canonical connector wire ») et `iterates` — RIEN à faire côté export pour la Phase A.
- `MenuYaml`/`ElementYaml` (plugin/model/PackBundle.kt) n'ont PAS ces champs (`@JsonIgnoreProperties` les avale).
- `MenuRenderer.open()` (plugin/render/MenuRenderer.kt) : une appearance par élément, `resolveText` remplace `{k}` par `toString` (pas de `{a.b}`), `buildItem` ne résout PAS les placeholders du `material`.
- `MenuSession(menuId, ctx, activeClicks)` — pas d'état de pagination ni d'args par slot.
- `ActionExecutor` : `PaginationNext/Prev -> Unit` ; `ConditionEvaluator` : `PaginationAtFirst/AtLast -> false`.
- `pack.dataSources` n'est PAS exporté (Phase B).

---

### Task 1 : Parsing wire — `context_inputs` + `iterates` dans les DTO Jackson

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/model/PackBundle.kt` (MenuYaml, ElementYaml + nouveaux DTO)
- Create: `plugin/src/test/kotlin/net/artisanmc/plugin/MenuYamlParsingTest.kt`

- [ ] **Step 1 : test RED**

```kotlin
package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.model.MenuYaml
import kotlin.test.*

class MenuYamlParsingTest {
    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()

    @Test
    fun `parses context_inputs and iterates from canonical menu yaml`() {
        val yaml = """
            schema: menu/v1
            id: shop
            title: []
            size: 27
            context_inputs:
              - name: category
                type: string
                default: all
              - name: shops
                type: list
                source:
                  ref: "chestshop:items"
            layers:
              - id: main
                name: Main
                elements:
                  - id: grid
                    positions: "10-16"
                    iterates: { source: shops, alias: shop }
                    appearances:
                      - material: "{shop.material}"
        """.trimIndent()
        val menu = mapper.readValue<MenuYaml>(yaml)
        assertEquals(2, menu.contextInputs.size)
        assertEquals("category", menu.contextInputs[0].name)
        assertEquals("all", menu.contextInputs[0].default)
        assertEquals("chestshop:items", menu.contextInputs[1].source["ref"])
        val el = menu.layers[0].elements[0]
        assertEquals("shops", el.iterates?.source)
        assertEquals("shop", el.iterates?.alias)
    }

    @Test
    fun `menus without these fields still parse (back-compat)`() {
        val menu = mapper.readValue<MenuYaml>(
            """
            schema: menu/v1
            id: simple
            size: 9
            layers: []
            """.trimIndent(),
        )
        assertTrue(menu.contextInputs.isEmpty())
    }
}
```

- [ ] **Step 2 : RED** — `./gradlew test --tests "*MenuYamlParsingTest*"` → FAIL (champ inconnu / propriété absente).

- [ ] **Step 3 : implémentation** — dans `PackBundle.kt` :

```kotlin
@JsonIgnoreProperties(ignoreUnknown = true)
data class ContextInputYaml(
    val name: String = "",
    val type: String = "string",
    val default: String? = null,
    /** ConnectorBinding canonique ({ref, params?, filter?, sort?, limit?}) — consommé en Phase B. */
    val source: Map<String, Any> = emptyMap(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class IteratesYaml(val source: String = "", val alias: String = "")
```

`MenuYaml` gagne `@JsonProperty("context_inputs") val contextInputs: List<ContextInputYaml> = emptyList()` ; `ElementYaml` gagne `val iterates: IteratesYaml? = null`.

- [ ] **Step 4 : GREEN** — `./gradlew test --tests "*MenuYamlParsingTest*"` → PASS, puis suite complète.

- [ ] **Step 5 : commit** — `feat(plugin): parse menu/v1 context_inputs and iterates`

---

### Task 2 : `ArgResolver` — `{name}` et `{alias.field}` partagés

**Files:**
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/ArgResolver.kt`
- Create: `plugin/src/test/kotlin/net/artisanmc/plugin/ArgResolverTest.kt`

- [ ] **Step 1 : test RED**

```kotlin
package net.artisanmc.plugin

import net.artisanmc.plugin.engine.ArgResolver
import kotlin.test.*

class ArgResolverTest {
    @Test fun `resolves a flat arg`() {
        assertEquals("Hello Steve", ArgResolver.resolve("Hello {name}", mapOf("name" to "Steve")))
    }
    @Test fun `resolves a dotted field on a map value`() {
        val args = mapOf("shop" to mapOf("material" to "DIAMOND", "price" to 100))
        assertEquals("DIAMOND x100", ArgResolver.resolve("{shop.material} x{shop.price}", args))
    }
    @Test fun `resolves a bare alias bound to a primitive item`() {
        assertEquals("warp spawn", ArgResolver.resolve("warp {w}", mapOf("w" to "spawn")))
    }
    @Test fun `leaves unknown placeholders untouched`() {
        assertEquals("{nope} {shop.alpha}", ArgResolver.resolve("{nope} {shop.alpha}", mapOf("shop" to mapOf("a" to 1))))
    }
    @Test fun `does not touch i18n refs or papi tokens`() {
        val args = mapOf("k" to "v")
        assertEquals("{i18n:menus.x} %player_name%", ArgResolver.resolve("{i18n:menus.x} %player_name%", args))
    }
}
```

- [ ] **Step 2 : RED** — `./gradlew test --tests "*ArgResolverTest*"` → FAIL (classe absente).

- [ ] **Step 3 : implémentation**

```kotlin
package net.artisanmc.plugin.engine

/**
 * Résolution des placeholders de contexte `{name}` et `{alias.field}` (champ
 * d'un item Map d'une itération). Les refs `{i18n:…}` ne matchent pas le
 * pattern (deux-points) ; `%papi%` n'est pas concerné. Placeholder inconnu →
 * laissé tel quel (cohérent avec le comportement historique).
 */
object ArgResolver {
    private val PATTERN = Regex("\\{([a-z][a-z0-9_]*)(?:\\.([a-z0-9_]+))?}")

    fun resolve(text: String, args: Map<String, Any>): String =
        PATTERN.replace(text) { m ->
            val name = m.groupValues[1]
            val field = m.groupValues[2]
            val value = args[name] ?: return@replace m.value
            if (field.isEmpty()) value.toString()
            else (value as? Map<*, *>)?.get(field)?.toString() ?: m.value
        }
}
```

- [ ] **Step 4 : GREEN** puis brancher les 3 call-sites existants (mêmes tests de non-régression : suite complète) :
  - `MenuRenderer.resolveText` : remplacer la boucle `ctx.args.forEach { replace }` par `text = ArgResolver.resolve(text, ctx.args)`.
  - `MenuRenderer.open` → lambda `interpolate` : idem.
  - `ActionExecutor.resolveArgs` : corps → `ArgResolver.resolve(text, ctx.args)`.

- [ ] **Step 5 : suite complète** — `./gradlew test` → PASS (les tests resolveArgs existants couvrent la non-régression).

- [ ] **Step 6 : commit** — `feat(plugin): shared ArgResolver with {alias.field} map access`

---

### Task 3 : `ContextBinder` — defaults déclarés, l'appelant gagne (§15.4)

**Files:**
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/ContextBinder.kt`
- Create: `plugin/src/test/kotlin/net/artisanmc/plugin/ContextBinderTest.kt`

- [ ] **Step 1 : test RED**

```kotlin
package net.artisanmc.plugin

import net.artisanmc.plugin.engine.ContextBinder
import net.artisanmc.plugin.model.ContextInputYaml
import net.artisanmc.plugin.model.MenuYaml
import kotlin.test.*

class ContextBinderTest {
    private fun menu(vararg inputs: ContextInputYaml) =
        MenuYaml(id = "m", size = 9, contextInputs = inputs.toList())

    @Test fun `caller args win over defaults by name`() {
        val args = ContextBinder.bind(
            menu(ContextInputYaml(name = "category", type = "string", default = "all")),
            mapOf("category" to "tools"),
        )
        assertEquals("tools", args["category"])
    }
    @Test fun `declared default fills a missing input with type coercion`() {
        val args = ContextBinder.bind(
            menu(
                ContextInputYaml(name = "category", type = "string", default = "all"),
                ContextInputYaml(name = "page_size", type = "integer", default = "5"),
                ContextInputYaml(name = "vip", type = "boolean", default = "true"),
            ),
            emptyMap(),
        )
        assertEquals("all", args["category"])
        assertEquals(5L, args["page_size"])
        assertEquals(true, args["vip"])
    }
    @Test fun `input without default and without caller value stays absent`() {
        val args = ContextBinder.bind(menu(ContextInputYaml(name = "q", type = "string")), emptyMap())
        assertFalse(args.containsKey("q"))
    }
    @Test fun `caller args not declared as inputs pass through untouched`() {
        val args = ContextBinder.bind(menu(), mapOf("extra" to 1))
        assertEquals(1, args["extra"])
    }
}
```

- [ ] **Step 2 : RED** → FAIL (classe absente).

- [ ] **Step 3 : implémentation**

```kotlin
package net.artisanmc.plugin.engine

import net.artisanmc.plugin.model.MenuYaml

/**
 * Auto-binding §15.4 : les args de l'appelant (commande, open_menu.context,
 * alias d'itération) peuplent les context_inputs par nom ; les defaults
 * déclarés comblent le reste. Phase B branchera ici le fetch des inputs à
 * `source` (ConnectorBinding) non fournis par l'appelant.
 */
object ContextBinder {
    fun bind(menu: MenuYaml, callerArgs: Map<String, Any>): Map<String, Any> {
        val out = callerArgs.toMutableMap()
        for (input in menu.contextInputs) {
            if (input.name.isEmpty() || out.containsKey(input.name)) continue
            val d = input.default ?: continue
            out[input.name] = coerce(d, input.type)
        }
        return out
    }

    private fun coerce(raw: String, type: String): Any = when (type) {
        "integer" -> raw.toLongOrNull() ?: raw
        "number"  -> raw.toDoubleOrNull() ?: raw
        "boolean" -> raw.toBooleanStrictOrNull() ?: raw
        else      -> raw
    }
}
```

- [ ] **Step 4 : GREEN** ; **Step 5 : commit** — `feat(plugin): ContextBinder — declared defaults, caller wins`

---

### Task 4 : État de pagination dans `ExecutionContext` + `MenuSession.slotArgs`

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/ExecutionContext.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/MenuSessionStore.kt`

Pas de test dédié (structures pures) — couvertes par les Tasks 5–7.

- [ ] **Step 1 : implémentation**

```kotlin
// ExecutionContext.kt
package net.artisanmc.plugin.engine

import org.bukkit.entity.Player

/** Page courante + nombre de pages d'un élément itérant, calculés au rendu. */
data class PageInfo(val page: Int, val pageCount: Int)

data class ExecutionContext(
    val player: Player,
    val args: Map<String, Any> = emptyMap(),
    val lang: String = "en",
    val langMap: Map<String, String> = emptyMap(),
    /** Pages demandées par élément itérant (elementId → page). Écrit par pagination_next/prev. */
    val pagination: Map<String, Int> = emptyMap(),
    /** Snapshot du dernier rendu (clamps + pageCount). Lu par les conditions pagination_at_*. */
    val pageInfo: Map<String, PageInfo> = emptyMap(),
)
```

```kotlin
// MenuSessionStore.kt — MenuSession gagne les args par slot (item d'itération du slot cliqué)
data class MenuSession(
    val menuId: String,
    val ctx: ExecutionContext,
    val activeClicks: Map<Int, Map<ClickType, ClickHandler>>,
    val slotArgs: Map<Int, Map<String, Any>> = emptyMap(),
)
```

- [ ] **Step 2 : compiler + suite** — `./gradlew test` → PASS (champs avec defaults, aucun call-site à changer).

- [ ] **Step 3 : commit** — `feat(plugin): pagination state on ExecutionContext + per-slot session args`

---

### Task 5 : `MenuRenderer` — binding, itération fenêtrée, `{alias.field}`, material résolu

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/render/MenuRenderer.kt`
- Create: `plugin/src/test/kotlin/net/artisanmc/plugin/MenuRendererIterationTest.kt`

- [ ] **Step 1 : test RED** (pattern MockBukkit d'`ActionExecutorTest` ; `BundleMenu` construit via `BundleCompiler.compile`)

```kotlin
package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.render.MenuRenderer
import org.bukkit.Material
import kotlin.test.*

class MenuRendererIterationTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()
    private fun player() = MockBukkit.getMock()!!.addPlayer()

    /** 3 slots (10-12), liste de 5 items → page 0 = 3 premiers, page 1 = 2 derniers. */
    private fun gridMenu(): MenuYaml = mapper.readValue(
        """
        schema: menu/v1
        id: shop
        title: []
        size: 27
        context_inputs:
          - { name: shops, type: list }
        layers:
          - id: main
            name: Main
            elements:
              - id: grid
                positions: "10-12"
                iterates: { source: shops, alias: shop }
                appearances:
                  - material: "{shop.material}"
                    title: "{shop.name}"
                    click:
                      left:
                        steps:
                          - { kind: action, action: { type: run_command, command: "buy {shop.id}" } }
        """.trimIndent(),
    )

    private fun shops(n: Int): List<Map<String, Any>> = (1..n).map {
        mapOf("id" to "s$it", "name" to "Shop $it", "material" to if (it % 2 == 0) "DIAMOND" else "EMERALD")
    }

    @Test fun `renders one item per list entry within the element slots`() {
        val p = player()
        val menu = BundleCompiler.compile(gridMenu(), emptyMap())
        val session = MenuRenderer.open(p, menu, "en", ExecutionContext(p, args = mapOf("shops" to shops(2))))
        val inv = p.openInventory.topInventory
        assertEquals(Material.EMERALD, inv.getItem(10)?.type)  // s1
        assertEquals(Material.DIAMOND, inv.getItem(11)?.type)  // s2
        assertNull(inv.getItem(12))                            // pas de 3e item
        assertEquals("shop", session.menuId)
    }

    @Test fun `windowing — page 1 shows the remainder and pageInfo is exposed`() {
        val p = player()
        val menu = BundleCompiler.compile(gridMenu(), emptyMap())
        val session = MenuRenderer.open(
            p, menu, "en",
            ExecutionContext(p, args = mapOf("shops" to shops(5)), pagination = mapOf("grid" to 1)),
        )
        val inv = p.openInventory.topInventory
        assertNotNull(inv.getItem(10)) // s4
        assertNotNull(inv.getItem(11)) // s5
        assertNull(inv.getItem(12))
        assertEquals(PageInfo(page = 1, pageCount = 2), session.ctx.pageInfo["grid"])
    }

    @Test fun `requested page beyond the end is clamped`() {
        val p = player()
        val menu = BundleCompiler.compile(gridMenu(), emptyMap())
        val session = MenuRenderer.open(
            p, menu, "en",
            ExecutionContext(p, args = mapOf("shops" to shops(5)), pagination = mapOf("grid" to 99)),
        )
        assertEquals(1, session.ctx.pageInfo["grid"]?.page)
    }

    @Test fun `slotArgs carry the per-item alias for click execution`() {
        val p = player()
        val menu = BundleCompiler.compile(gridMenu(), emptyMap())
        val session = MenuRenderer.open(p, menu, "en", ExecutionContext(p, args = mapOf("shops" to shops(2))))
        @Suppress("UNCHECKED_CAST")
        val item0 = session.slotArgs[10]?.get("shop") as? Map<String, Any>
        assertEquals("s1", item0?.get("id"))
        assertTrue(session.activeClicks.containsKey(10))
    }

    @Test fun `empty or missing list renders nothing and yields one empty page`() {
        val p = player()
        val menu = BundleCompiler.compile(gridMenu(), emptyMap())
        val session = MenuRenderer.open(p, menu, "en", ExecutionContext(p))
        assertNull(p.openInventory.topInventory.getItem(10))
        assertEquals(PageInfo(0, 1), session.ctx.pageInfo["grid"])
    }

    @Test fun `declared default fills an arg used by a non-iterating element`() {
        val p = player()
        val yaml: MenuYaml = mapper.readValue(
            """
            schema: menu/v1
            id: m
            title: []
            size: 9
            context_inputs:
              - { name: label, type: string, default: Hi }
            layers:
              - id: l
                name: L
                elements:
                  - id: btn
                    positions: "0"
                    appearances:
                      - material: STONE
                        title: "{label}"
            """.trimIndent(),
        )
        val menu = BundleCompiler.compile(yaml, emptyMap())
        val session = MenuRenderer.open(p, menu, "en", ExecutionContext(p))
        assertEquals("Hi", session.ctx.args["label"])
    }
}
```

- [ ] **Step 2 : RED** — `./gradlew test --tests "*MenuRendererIterationTest*"` → FAIL.

- [ ] **Step 3 : implémentation** — dans `MenuRenderer.open`, après `langMap` :

```kotlin
// §15.4 : defaults déclarés (l'appelant gagne par nom).
val boundCtx = ctx.copy(args = ContextBinder.bind(menu.yaml, ctx.args))

// Pré-calcul des fenêtres de pagination de chaque élément itérant.
val pageInfo = mutableMapOf<String, PageInfo>()
for (layer in menu.yaml.layers) for (element in layer.elements) {
    val iter = element.iterates ?: continue
    val slots = parsePositions(element.positions, menu.yaml.size)
    val list = boundCtx.args[iter.source] as? List<*> ?: emptyList<Any>()
    val pageSize = slots.size.coerceAtLeast(1)
    val pageCount = ((list.size + pageSize - 1) / pageSize).coerceAtLeast(1)
    val requested = boundCtx.pagination[element.id] ?: 0
    pageInfo[element.id] = PageInfo(requested.coerceIn(0, pageCount - 1), pageCount)
}
val renderCtx = boundCtx.copy(pageInfo = pageInfo)
```

Remplacer `ctx` par `renderCtx` dans `interpolate`, et la boucle d'éléments devient :

```kotlin
val slotArgs = mutableMapOf<Int, Map<String, Any>>()
for (layer in menu.yaml.layers) {
    for (element in layer.elements) {
        val compiledList = menu.compiledAppearances[element.id] ?: emptyList()
        val slots = parsePositions(element.positions, menu.yaml.size)
        val iter = element.iterates
        if (iter == null) {
            val chosen = compiledList.firstOrNull { evaluator.evaluateAll(it.conditions, renderCtx) } ?: continue
            val item = buildItem(chosen.yaml, langMap, renderCtx, evaluator.deps)
            for (slot in slots) {
                inv.setItem(slot, item)
                if (chosen.clicks.isNotEmpty()) activeClicks[slot] = chosen.clicks
            }
            continue
        }
        // Élément itérant : une entrée de la liste par slot, fenêtrée par page.
        val list = renderCtx.args[iter.source] as? List<*> ?: emptyList<Any>()
        val info = renderCtx.pageInfo[element.id] ?: PageInfo(0, 1)
        val window = list.drop(info.page * slots.size).take(slots.size)
        window.forEachIndexed { i, entry ->
            val slot = slots[i]
            val itemArgs = mapOf(iter.alias to (entry ?: ""))
            val itemCtx = renderCtx.copy(args = renderCtx.args + itemArgs)
            val chosen = compiledList.firstOrNull { evaluator.evaluateAll(it.conditions, itemCtx) }
                ?: return@forEachIndexed
            inv.setItem(slot, buildItem(chosen.yaml, langMap, itemCtx, evaluator.deps))
            if (chosen.clicks.isNotEmpty()) {
                activeClicks[slot] = chosen.clicks
                slotArgs[slot] = itemArgs
            }
        }
    }
}
```

`buildItem` : résoudre le material via le contexte avant `Material.valueOf` :

```kotlin
val resolvedMaterial = app.material?.let { ArgResolver.resolve(it, ctx.args) }
val item = resolvedMaterial?.let { mat ->
    deps.buildCustomStack(mat, count)
        ?: runCatching { Material.valueOf(mat.uppercase()) }.getOrNull()?.let { ItemStack(it, count) }
} ?: ItemStack(Material.STONE, count)
```

Retour : `return MenuSession(menu.id, renderCtx.copy(lang = lang, langMap = langMap), activeClicks, slotArgs)`.

- [ ] **Step 4 : GREEN** puis suite complète. **Step 5 : commit** — `feat(plugin): render iterating elements — windowed pages, per-item scope`

---

### Task 6 : `MenuListener` — contexte par slot au clic

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/render/MenuListener.kt:25`
- Modify: `plugin/src/test/kotlin/net/artisanmc/plugin/ActionExecutorTest.kt` (test du merge via exécution directe)

- [ ] **Step 1 : test RED** — dans `ActionExecutorTest` (le listener est une glue fine ; on teste la sémantique du merge) :

```kotlin
@Test fun `clicking an iterated slot resolves the alias in run_command`() {
    val p = player()
    val sessionCtx = ExecutionContext(p, args = mapOf("shops" to listOf(mapOf("id" to "s1"))))
    val slotArgs = mapOf("shop" to mapOf("id" to "s1"))
    // Le listener merge session.ctx.args + slotArgs[slot] avant handle().
    val merged = sessionCtx.copy(args = sessionCtx.args + slotArgs)
    val resolved = executor().resolveArgs("buy {shop.id}", merged)
    assertEquals("buy s1", resolved)
}
```

- [ ] **Step 2 : RED→GREEN** — le test passe déjà après Task 2 (ArgResolver) ; c'est l'oracle du contrat. Modifier le listener :

```kotlin
// MenuListener.onClick — remplacer executor.handle(handler, session!!.ctx) par :
val slotCtx = session!!.ctx.copy(
    args = session.ctx.args + (session.slotArgs[event.rawSlot] ?: emptyMap()),
)
executor.handle(handler, slotCtx)
```

- [ ] **Step 3 : suite complète** → PASS. **Step 4 : commit** — `feat(plugin): per-slot iteration scope on click`

---

### Task 7 : Pagination — actions réelles + conditions réelles

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/ActionExecutor.kt` (PaginationNext/Prev)
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/ConditionEvaluator.kt` (PaginationAtFirst/AtLast)
- Modify: `plugin/src/test/kotlin/net/artisanmc/plugin/ActionExecutorTest.kt`, `ConditionEvaluatorTest.kt`

- [ ] **Step 1 : tests RED**

`ConditionEvaluatorTest` :

```kotlin
@Test fun `pagination_at_first true on page 0, false after`() {
    val p = /* player du pattern existant du fichier */
    val ev = ConditionEvaluator.EMPTY
    val first = ExecutionContext(p, pageInfo = mapOf("grid" to PageInfo(0, 3)))
    val mid   = ExecutionContext(p, pageInfo = mapOf("grid" to PageInfo(1, 3)))
    assertTrue(ev.evaluate(Condition.PaginationAtFirst("grid"), first))
    assertFalse(ev.evaluate(Condition.PaginationAtFirst("grid"), mid))
}
@Test fun `pagination_at_last true on the final page`() {
    val last = ExecutionContext(p, pageInfo = mapOf("grid" to PageInfo(2, 3)))
    assertTrue(ConditionEvaluator.EMPTY.evaluate(Condition.PaginationAtLast("grid"), last))
}
@Test fun `element_id omitted targets the single iterating element`() {
    val one = ExecutionContext(p, pageInfo = mapOf("grid" to PageInfo(0, 2)))
    assertTrue(ConditionEvaluator.EMPTY.evaluate(Condition.PaginationAtFirst(null), one))
}
@Test fun `no iterating element — at_first and at_last are both true (hide both pagers)`() {
    val none = ExecutionContext(p)
    assertTrue(ConditionEvaluator.EMPTY.evaluate(Condition.PaginationAtFirst(null), none))
    assertTrue(ConditionEvaluator.EMPTY.evaluate(Condition.PaginationAtLast(null), none))
}
```

`ActionExecutorTest` (stub provider enregistre déjà `lastOpenedMenuId`/`lastMenuCtx`) :

```kotlin
@Test fun `pagination_next advances the page and re-renders`() {
    val p = player()
    sessions.set(p, MenuSession("shop", ExecutionContext(p), emptyMap()))
    val ctx = ExecutionContext(p, pageInfo = mapOf("grid" to PageInfo(0, 3)))
    executor().execute(listOf(Action.PaginationNext("grid")), ctx)
    assertEquals("shop", lastOpenedMenuId)
    assertEquals(1, lastMenuCtx?.pagination?.get("grid"))
}
@Test fun `pagination_next clamps at the last page (no re-render)`() {
    val p = player()
    sessions.set(p, MenuSession("shop", ExecutionContext(p), emptyMap()))
    val ctx = ExecutionContext(p, pagination = mapOf("grid" to 2), pageInfo = mapOf("grid" to PageInfo(2, 3)))
    executor().execute(listOf(Action.PaginationNext("grid")), ctx)
    assertNull(lastOpenedMenuId)
}
@Test fun `pagination_prev with no element_id targets every iterating element`() {
    val p = player()
    sessions.set(p, MenuSession("shop", ExecutionContext(p), emptyMap()))
    val ctx = ExecutionContext(
        p,
        pagination = mapOf("grid" to 1, "side" to 1),
        pageInfo = mapOf("grid" to PageInfo(1, 3), "side" to PageInfo(1, 2)),
    )
    executor().execute(listOf(Action.PaginationPrev(null)), ctx)
    assertEquals(0, lastMenuCtx?.pagination?.get("grid"))
    assertEquals(0, lastMenuCtx?.pagination?.get("side"))
}
```

- [ ] **Step 2 : RED** → FAIL (stubs actuels).

- [ ] **Step 3 : implémentation**

`ConditionEvaluator` :

```kotlin
is Condition.PaginationAtFirst -> pageInfoFor(ctx, condition.elementId)?.let { it.page <= 0 } ?: true
is Condition.PaginationAtLast  -> pageInfoFor(ctx, condition.elementId)?.let { it.page >= it.pageCount - 1 } ?: true
```

```kotlin
private fun pageInfoFor(ctx: ExecutionContext, elementId: String?): PageInfo? =
    if (elementId != null) ctx.pageInfo[elementId] else ctx.pageInfo.values.singleOrNull()
```

`ActionExecutor` (remplace `is Action.PaginationNext, is Action.PaginationPrev -> Unit`) :

```kotlin
is Action.PaginationNext -> return paginate(ctx, action.elementId, +1)
is Action.PaginationPrev -> return paginate(ctx, action.elementId, -1)
```

```kotlin
/** Avance/recule la page des éléments ciblés (clamp aux bornes) puis re-rend le menu courant. */
private fun paginate(ctx: ExecutionContext, elementId: String?, delta: Int): ExecutionContext {
    val session = sessions.get(ctx.player) ?: return ctx
    val targets = if (elementId != null) listOf(elementId) else ctx.pageInfo.keys.toList()
    var pagination = ctx.pagination
    for (t in targets) {
        val info = ctx.pageInfo[t] ?: continue
        val next = (info.page + delta).coerceIn(0, info.pageCount - 1)
        if (next != info.page) pagination = pagination + (t to next)
    }
    if (pagination == ctx.pagination) return ctx
    val newCtx = ctx.copy(pagination = pagination)
    menuProvider.openMenu(ctx.player, session.menuId, newCtx.lang, newCtx)
    return newCtx
}
```

- [ ] **Step 4 : GREEN** + suite complète. **Step 5 : commit** — `feat(plugin): working pagination — actions advance pages, at_first/at_last real`

---

### Task 8 : Oracle d'intégration — boucle complète paginate → re-render

**Files:**
- Modify: `plugin/src/test/kotlin/net/artisanmc/plugin/MenuRendererIterationTest.kt`

- [ ] **Step 1 : test** (RED si un raccord manque, sinon oracle vert) — simule le cycle réel : open → clic next (via executor + provider réel branché sur MenuRenderer) → la page 2 est rendue.

```kotlin
@Test fun `full loop — pagination_next re-renders the next window`() {
    val p = player()
    val pluginInstance = MockBukkit.load(ArtisanPlugin::class.java)
    val menu = BundleCompiler.compile(gridMenu(), emptyMap())
    val sessions = MenuSessionStore()
    lateinit var executor: ActionExecutor
    val provider = object : net.artisanmc.plugin.provider.MenuProvider {
        override fun load() {}
        override fun findMenu(menuId: String) = menu
        override fun openMenu(player: org.bukkit.entity.Player, menuId: String, lang: String, ctx: ExecutionContext) {
            sessions.set(player, MenuRenderer.open(player, menu, lang, ctx))
        }
        override fun openDialog(player: org.bukkit.entity.Player, dialogId: String, lang: String, ctx: ExecutionContext) {}
        override fun allBundles() = emptyList<net.artisanmc.plugin.model.PackBundle>()
    }
    executor = ActionExecutor(pluginInstance, provider, sessions, SoftDepRegistry.EMPTY, CooldownStore(), ConditionEvaluator.EMPTY)

    provider.openMenu(p, "shop", "en", ExecutionContext(p, args = mapOf("shops" to shops(5))))
    val before = sessions.get(p)!!
    assertEquals(0, before.ctx.pageInfo["grid"]?.page)

    executor.execute(listOf(Action.PaginationNext("grid")), before.ctx)

    val after = sessions.get(p)!!
    assertEquals(1, after.ctx.pageInfo["grid"]?.page)
    assertNull(p.openInventory.topInventory.getItem(12)) // page 1 n'a que 2 items
}
```

- [ ] **Step 2 : GREEN** + suite complète. **Step 3 : commit** — `test(plugin): end-to-end pagination loop oracle`

---

### Task 9 : Éditeur + assistant — `pagination_at_first/last` entrent dans le sous-ensemble

**Files:**
- Modify: `editor/src/domain/types.ts` (Condition union)
- Modify: `editor/src/schema/menuV1ToDomain.ts` (DOMAIN_CONDITIONS + cases)
- Modify: `editor/src/features/canvas/properties/ConditionListEditor.tsx` (TYPES + defaultCondition + ConditionInline)
- Modify: `editor/src/features/flow/labels.ts` (conditionSummary)
- Modify: `editor/src/schema/menuV1ToDomain.test.ts`
- Modify: `backend/src/modules/assistant/grounding.ts` (SUPPORTED_CONDITIONS)
- Modify: `backend/src/modules/assistant/validate.test.ts` (acceptance + retirer ces types des tests de rejet)
- Modify: `backend/src/modules/assistant/grounding/menu-v1-authoring-guide.md` (table conditions + note « NOT in subset » : il ne reste que `expression` ; caveat pagination supprimé)

- [ ] **Step 1 : test RED éditeur** (`menuV1ToDomain.test.ts`) :

```ts
it("imports pagination_at_first / pagination_at_last", () => {
  const src = minimalMenu({
    if: [
      { type: "pagination_at_first", element_id: "grid" },
      { type: "pagination_at_last" },
    ],
  });
  const r = menuV1ToDomain(src, opts);
  expect(r.unsupported).toEqual([]);
  expect(r.menu.layers[0]!.elements[0]!.appearances[0]!.if).toEqual([
    { type: "pagination_at_first", elementId: "grid" },
    { type: "pagination_at_last" },
  ]);
});
```

- [ ] **Step 2 : implémentation éditeur**
  - Domaine : `| { type: "pagination_at_first"; elementId?: string } | { type: "pagination_at_last"; elementId?: string }` (camelCase domaine ; ces deux conditions NE passent PAS par le passthrough → mapping explicite des deux côtés).
  - `menuV1ToDomain.condition()` : `case "pagination_at_first": return { type: "pagination_at_first", ...(c.element_id ? { elementId: c.element_id } : {}) };` (idem `at_last`). Ajouter les deux à `DOMAIN_CONDITIONS`.
  - `transform.serializeCondition()` : ces deux types nécessitent un cas explicite (snake_case) :
    ```ts
    if (c.type === "pagination_at_first" || c.type === "pagination_at_last") {
      return { type: c.type, ...(c.elementId ? { element_id: c.elementId } : {}) };
    }
    ```
  - `ConditionListEditor` : TYPES += `{ value: "pagination_at_first", label: "on first page", chip: "⏮" }` / `{ value: "pagination_at_last", label: "on last page", chip: "⏭" }` ; `defaultCondition` → `{ type, }` sans elementId ; `ConditionInline` → un `<Input placeholder="(all iterables)" value={condition.elementId ?? ""} …>` optionnel.
  - `labels.conditionSummary` : `case "pagination_at_first": return condition.elementId ? \`first page of ${condition.elementId}\` : "on first page";` (idem last).
  - Étendre la fixture round-trip (`menuV1ToDomain.roundtrip.test.ts`) : une condition `pagination_at_first` sur l'appearance du bouton pager.

- [ ] **Step 3 : backend** — `SUPPORTED_CONDITIONS` += les deux types ; `validate.test.ts` : retirer `pagination_at_first/last` des tests de rejet (il ne reste QUE `expression` comme exemple hors-subset) et les ajouter au test d'acceptation ; guide : deux lignes dans la table conditions, note « NOT in subset » réduite à `expression`, suppression du caveat « pagination no-op » de la section Runtime caveats (désormais faux), et le caveat iterates devient : « server runtime renders caller-provided lists; connector/pack data delivery is Phase B — flag when a menu depends on a connector ».

- [ ] **Step 4 : suites** — `npm test` (éditeur), `bun run test` (backend) → PASS.

- [ ] **Step 5 : commit** — `feat(editor,assistant): pagination_at_first/last join the importable subset`

---

### Task 10 : Docs + CHANGELOG

**Files:**
- Modify: `docs/architecture/schemas-codegen.md` (gaps : itération/pagination fermés ; restants = connecteurs/pack-data (Phase B) + expression)
- Modify: `CHANGELOG.md` `[Unreleased]`

- [ ] **Step 1 :** déplacer « `context_inputs` / itération » et « pagination » vers la section **Fermés** de schemas-codegen.md avec une ligne chacun (binder §15.4, fenêtrage par slots, `{alias.field}`, clamp + at_first/at_last réels) ; préciser que la livraison de données (connecteurs/`pack:`) reste ouverte (Phase B).
- [ ] **Step 2 :** entrée CHANGELOG `Added` décrivant le runtime (mêmes points, 3-4 lignes).
- [ ] **Step 3 : commit** — `docs: data-driven runtime phase A status`

---

## Self-review

- **Couverture spec** : §15.4 auto-binding (T3, T5) ; itération fenêtrée + alias scope (T5, T6) ; pagination actions/conditions/cycle complet (T7, T8) ; alignement subset/KB (T9) ; docs (T10). Livraison de données = hors scope assumé (Phase B), caveat KB mis à jour en conséquence. ✓
- **Pas de placeholders** : chaque étape code porte le code ; les seuls renvois sont vers des patterns de fichiers existants nommés. ✓
- **Cohérence de types** : `PageInfo(page, pageCount)` (T4) utilisé tel quel en T5/T7/T8 ; `MenuSession.slotArgs` (T4) consommé en T5/T6 ; `ContextInputYaml`/`IteratesYaml` (T1) consommés en T3/T5 ; `Condition.PaginationAtFirst(elementId: String?)` existe déjà dans Condition.kt (champ `elementId`). ✓
- **Risque connu** : `SyncedMenuProvider.openMenu` passe `ctx` au renderer sans le toucher → la pagination voyage dans `ExecutionContext`, aucun changement d'interface `MenuProvider`. Vérifier en T5 que `SyncedMenuProvider` ne reconstruit pas un `ExecutionContext` neuf (sinon propager `pagination`).

## Suite (Phase B — plan séparé)

Livraison de données : export `pack.dataSources` → `data/<id>.yaml` (`data/v1`) + manifest, lecture plugin (`PackReader`/`BundleDownloader`), résolution `source.ref` dans `ContextBinder` (refs `pack:` → données du bundle ; autres → `DataSourceRegistry.fetch`), `params`/`filter`/`sort`/`limit` du ConnectorBinding, premier connecteur réel (EssentialsX warps) comme preuve de bout en bout.
