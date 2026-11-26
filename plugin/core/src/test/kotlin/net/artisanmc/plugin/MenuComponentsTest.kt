package net.artisanmc.plugin

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.model.MenuComponents
import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.yaml.ProjectReader
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame
import kotlin.test.assertTrue

/** `testdata/component-expansion.json`: a look that names a component, as the editor and the pack builder read it. */
class MenuComponentsTest {
    private val mapper = ObjectMapper()
    private val vector = mapper.readValue(File("../testdata/component-expansion.json"), Map::class.java)

    @Test fun `a menu's components are expanded as the editor expands them`() {
        for (case in vector["cases"] as List<*>) {
            case as Map<*, *>
            val files = case["components"] as Map<*, *>
            val module = case["module"] as String
            val expanded = MenuComponents.expandMenu(case["menu"]) { name ->
                MenuComponents.find(module, name) { scope, bare -> (files[scope] as? Map<*, *>)?.get(bare) }
            }
            assertEquals(mapper.valueToTree<JsonNode>(case["expanded"]), mapper.valueToTree(expanded), case["name"] as String)
        }
    }

    @Test fun `a menu without component is returned as it is`() {
        val menu = mapOf("elements" to listOf(mapOf("id" to "a", "material" to "STONE")))
        assertSame(menu, MenuComponents.expandMenu(menu) { null })
    }

    @Test fun `the server reads a look's component from its module, then from the common ones`() {
        val base = java.nio.file.Files.createTempDirectory("artisan_components_").toFile()
        val root = File(base, "modules")
        val shop = File(root, "shop").apply { mkdirs() }
        File(shop, "manifest.yaml").writeText("schema: manifest/v1\ndefault_lang: en\nlanguages: [en]\n")
        File(shop, "components").mkdirs()
        File(shop, "components/price.yml").writeText("""
            params:
              amount: { type: text, default: "0" }
            parts:
              - image: tag
              - label: "{amount} $"
                anchor: right
        """.trimIndent())
        File(shop, "menus").mkdirs()
        File(shop, "menus/main.yml").writeText("""
            schema: menu/v1
            id: main
            title: Shop
            size: 27
            elements:
              - id: buy
                positions: "0-2"
                component: { name: confirm, text: Buy }
              - id: cost
                positions: "9-11"
                component: { name: price, amount: 12 }
              - id: lost
                positions: "18-20"
                component: nowhere
        """.trimIndent())
        val roots = ProjectRoots(root)
        val theme = roots.theme("artisan")
        File(theme, "originals/components").mkdirs()
        File(theme, "originals/components/confirm.yml").writeText("""
            params:
              text: { type: text, default: OK }
            parts:
              - image: button.3x1
              - label: "{text}"
        """.trimIndent())

        val menu = ProjectReader(roots).readAll().single { it.projectId == "shop" }.menus.single()
        val looks = menu.yaml.allElements.associate { it.id to it.display }
        val buy = looks.getValue("buy")
        assertEquals(listOf("artisan:button.3x1"), buy.images.map { it.asset })
        assertEquals(listOf<Any?>("Buy"), buy.labels.map { it.text })
        val cost = looks.getValue("cost")
        assertEquals(listOf("shop:tag"), cost.images.map { it.asset })
        assertEquals(listOf<Any?>("12 $"), cost.labels.map { it.text })
        assertEquals("right", cost.labels.single().align)
        assertTrue(looks.getValue("lost").images.isEmpty())
        assertEquals("nowhere", looks.getValue("lost").component)
        base.deleteRecursively()
    }
}
