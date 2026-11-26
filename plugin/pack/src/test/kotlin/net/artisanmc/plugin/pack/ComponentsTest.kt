package net.artisanmc.plugin.pack

import com.fasterxml.jackson.databind.ObjectMapper
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame

/** `testdata/component-expansion.json`: a look that names a component, as the editor reads it. */
class ComponentsTest {
    private val mapper = ObjectMapper()
    private val vector = mapper.readValue(File("../testdata/component-expansion.json"), Map::class.java)

    @Test fun `a menu's components are expanded as the editor expands them`() {
        for (case in vector["cases"] as List<*>) {
            case as Map<*, *>
            val files = case["components"] as Map<*, *>
            val module = case["module"] as String
            val expanded = Components.expandMenu(case["menu"]) { name ->
                Components.find(module, name) { scope, bare -> (files[scope] as? Map<*, *>)?.get(bare) }
            }
            assertEquals(mapper.valueToTree<com.fasterxml.jackson.databind.JsonNode>(case["expanded"]), mapper.valueToTree(expanded), case["name"] as String)
        }
    }

    @Test fun `a menu without component is returned as it is`() {
        val menu = mapOf("elements" to listOf(mapOf("id" to "a", "material" to "STONE", "states" to listOf(emptyMap<String, Any?>()))))
        assertSame(menu, Components.expandMenu(menu) { null })
    }
}
