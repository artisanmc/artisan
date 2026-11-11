package net.artisanmc.plugin.expr

import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory
import java.io.File

/**
 * Cross-stack conformance for the Template engine (ADR `expression-parity` §1).
 * Every fixture of `testdata/template-conformance.json` must render to the exact
 * same string here and in the editor — the TS suite
 * (`editor/src/lib/expr/template/conformance.test.ts`) asserts the same vector.
 *
 * That equality is what makes the editor's preview trustworthy: a menu author
 * sees in the browser precisely what the player will read in game.
 */
class TemplateConformanceTest {

    private data class Fixture(
        val name: String,
        val template: String,
        val scope: Map<String, Any?>,
        val papi: Map<String, String>? = null,
        val lang: Map<String, String>? = null,
        /** Fixed clock so `until()` is deterministic. */
        val now: Long? = null,
        val expected: String? = null,
        val expectedPrefix: String? = null,
    )

    private fun loadFixtures(): List<Fixture> {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            val f = File(dir, "testdata/template-conformance.json")
            if (f.exists()) {
                val mapper = ObjectMapper().registerKotlinModule()
                    .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
                return mapper.readValue(
                    f,
                    mapper.typeFactory.constructCollectionType(List::class.java, Fixture::class.java),
                )
            }
            dir = dir.parentFile
        }
        error("template conformance fixture not found from ${System.getProperty("user.dir")}")
    }

    @TestFactory
    fun `template rendering matches the cross-stack vector`(): List<DynamicTest> =
        loadFixtures().map { fx ->
            DynamicTest.dynamicTest(fx.name) {
                val papi = fx.papi ?: emptyMap()
                val lang = fx.lang ?: emptyMap()
                val out = renderTemplate(
                    fx.template,
                    ExprScope(
                        fx.scope,
                        { name -> papi[name] },
                        null,
                        { fx.now ?: 0L },
                        { key -> lang[key] },
                    ),
                    { key -> lang[key] },
                )
                if (fx.expectedPrefix != null) {
                    assertTrue(
                        out.startsWith(fx.expectedPrefix),
                        "'${fx.template}' should start with '${fx.expectedPrefix}' but was '$out'",
                    )
                } else {
                    assertEquals(fx.expected, out, "rendering '${fx.template}'")
                }
            }
        }
}
