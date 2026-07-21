package net.artisanmc.plugin.actiondsl

import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory
import java.io.File

/**
 * Cross-stack conformance: the Kotlin Action DSL codec MUST agree, on the TEXT
 * round-trip, with the shared vector `testdata/action-dsl-conformance.json` — the
 * same fixtures the TS suite (`editor/src/lib/actionDsl/actionDsl.test.ts`)
 * asserts against. Cf. ADR `docs/decisions/action-dsl.md`. The AST-JSON in the
 * fixture is TS-shaped, so we assert the language-agnostic invariant instead:
 *   - print(parse(dsl))          == canonicalDsl
 *   - print(parse(canonicalDsl)) == canonicalDsl  (idempotent)
 *
 * The fixture file is located by walking up from the working dir, mirroring
 * `BundleHashConformanceTest`'s discovery of `pack-hash-conformance.json`.
 */
class ActionDslConformanceTest {

    private data class Fixture(val name: String, val dsl: String, val canonicalDsl: String)

    private fun loadFixtures(): List<Fixture> {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            val f = File(dir, "testdata/action-dsl-conformance.json")
            if (f.exists()) {
                val mapper = ObjectMapper().registerKotlinModule()
                    .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
                return mapper.readValue(f, mapper.typeFactory.constructCollectionType(List::class.java, Fixture::class.java))
            }
            dir = dir.parentFile
        }
        error("conformance fixture not found from ${System.getProperty("user.dir")}")
    }

    @TestFactory
    fun `text round-trip matches the cross-stack vector`(): List<DynamicTest> =
        loadFixtures().map { fx ->
            DynamicTest.dynamicTest(fx.name) {
                assertEquals(
                    fx.canonicalDsl,
                    printActionDsl(parseActionDsl(fx.dsl)),
                    "print(parse(dsl)) must equal canonicalDsl for '${fx.name}'",
                )
                assertEquals(
                    fx.canonicalDsl,
                    printActionDsl(parseActionDsl(fx.canonicalDsl)),
                    "print(parse(canonicalDsl)) must be idempotent for '${fx.name}'",
                )
            }
        }
}
