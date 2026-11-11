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

    @Test fun `a Map result (config Project source) binds whole without shaping`() {
        val m = menu(ContextInputYaml(name = "settings", type = "object", source = mapOf("ref" to "pack:settings")))
        val out = ContextBinder.bind(m, emptyMap(), fetchSource = { _, _ ->
            mapOf("currency" to "coins", "motd" to "Welcome")
        })
        assertEquals(mapOf("currency" to "coins", "motd" to "Welcome"), out["settings"])
    }

    @Test fun `a null fetch result falls through to the declared default`() {
        val m = menu(ContextInputYaml(name = "q", type = "string", default = "all", source = mapOf("ref" to "pack:gone")))
        val out = ContextBinder.bind(m, emptyMap(), fetchSource = { _, _ -> null })
        assertEquals("all", out["q"])
    }
}
