package net.artisanmc.plugin.actiondsl

import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory
import java.io.File

/**
 * Cross-stack conformance for the leaf expression evaluator (ADR `action-dsl`
 * §6). The Kotlin [evalLeaf] MUST agree with the TS `editor/src/lib/expr/`
 * engine on the boolean result of every fixture in
 * `testdata/action-dsl-eval-conformance.json` — the same vector the TS suite
 * (`editor/src/lib/actionDsl/leafEval.test.ts`) asserts against.
 *
 * Fixture discovery mirrors [ActionDslConformanceTest] (walk up from cwd). No
 * `%papi%` in the shared fixtures (papi needs a live provider — tested
 * separately in [LeafEvalTest]).
 */
class LeafEvalConformanceTest {

    private data class Fixture(
        val name: String,
        val expr: String,
        val scope: Map<String, Any?>,
        val expected: Boolean,
    )

    private fun loadFixtures(): List<Fixture> {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            val f = File(dir, "testdata/action-dsl-eval-conformance.json")
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
        error("eval conformance fixture not found from ${System.getProperty("user.dir")}")
    }

    @TestFactory
    fun `leaf eval boolean matches the cross-stack vector`(): List<DynamicTest> =
        loadFixtures().map { fx ->
            DynamicTest.dynamicTest(fx.name) {
                val value = evalLeaf(fx.expr, fx.scope)
                assertEquals(
                    fx.expected,
                    toLeafBoolean(value),
                    "evalLeaf('${fx.expr}') coerced to boolean must equal expected for '${fx.name}'",
                )
            }
        }
}
