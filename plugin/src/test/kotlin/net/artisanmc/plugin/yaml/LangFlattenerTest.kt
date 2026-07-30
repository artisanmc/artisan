package net.artisanmc.plugin.yaml

import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import java.io.File

/**
 * Cross-stack conformance: the Kotlin lang reader MUST agree with the shared
 * vector `testdata/lang-tree-conformance.json` — the same fixtures the TS suite
 * (`editor/src/lib/langTree.test.ts`) asserts against. The plugin only reads, so
 * both `cases` (bidirectional in the editor) and `readOnlyCases` are asserted
 * one way: flatten(tree) == flat.
 *
 * The fixture is located by walking up from the working dir, mirroring
 * `ActionDslConformanceTest`.
 */
class LangFlattenerTest {

    private data class Case(val name: String, val flat: Map<String, String>, val nested: Any?, val tree: Any?)
    private data class Fixtures(val cases: List<Case>, val readOnlyCases: List<Case>)

    private fun loadFixtures(): Fixtures {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            val f = File(dir, "testdata/lang-tree-conformance.json")
            if (f.exists()) {
                return ObjectMapper().registerKotlinModule()
                    .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
                    .readValue(f, Fixtures::class.java)
            }
            dir = dir.parentFile
        }
        error("conformance fixture not found from ${System.getProperty("user.dir")}")
    }

    @TestFactory
    fun `flatten matches the cross-stack vector`(): List<DynamicTest> {
        val fx = loadFixtures()
        return (fx.cases + fx.readOnlyCases).map { c ->
            DynamicTest.dynamicTest(c.name) {
                assertEquals(c.flat, LangFlattener.flatten(c.nested ?: c.tree ?: emptyMap<String, Any>()))
            }
        }
    }

    private val yaml = ObjectMapper(YAMLFactory()).registerKotlinModule()

    private fun flattenYaml(src: String): Map<String, String> =
        LangFlattener.flatten(yaml.readValue(src, Map::class.java))

    @Test
    fun `reads a nested tree as dotted keys`() {
        assertEquals(
            mapOf(
                "menus.shop_main.title" to "Boutique",
                "menus.shop_main.elements.back.default.title" to "<gray>Retour",
            ),
            flattenYaml(
                """
                menus:
                  shop_main:
                    title: Boutique
                    elements:
                      back:
                        default:
                          title: "<gray>Retour"
                """.trimIndent(),
            ),
        )
    }

    @Test
    fun `still reads the legacy flat form, and a mix of both`() {
        assertEquals(
            mapOf("menus.a.title" to "A", "menus.b.title" to "B", "other.k" to "v"),
            flattenYaml(
                """
                menus.a.title: A
                menus:
                  b.title: B
                other.k: v
                """.trimIndent(),
            ),
        )
    }

    @Test
    fun `coerces integer keys and non-string scalars, empty value is the sentinel`() {
        assertEquals(
            mapOf("data.rows.1.name" to "Blocs", "data.rows.2.name" to "", "data.n" to "42"),
            flattenYaml(
                """
                data:
                  n: 42
                  rows:
                    1:
                      name: Blocs
                    2:
                      name:
                """.trimIndent(),
            ),
        )
    }

    @Test
    fun `keeps a colon-bearing segment and multi-line values intact`() {
        assertEquals(
            mapOf(
                "menus.m.elements.item:ci_ab12.default.lore" to "{item.lore}\n<yellow>Prix",
            ),
            flattenYaml(
                """
                menus:
                  m:
                    elements:
                      "item:ci_ab12":
                        default:
                          lore: |-
                            {item.lore}
                            <yellow>Prix
                """.trimIndent(),
            ),
        )
    }
}
