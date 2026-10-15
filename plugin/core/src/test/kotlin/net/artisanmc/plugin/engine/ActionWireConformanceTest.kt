package net.artisanmc.plugin.engine

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory
import java.io.File

/**
 * Cross-stack conformance of the structured action wire (ADR
 * `structured-action-wire`): `testdata/action-wire-conformance.json` is the vector
 * the editor asserts against too (`lib/actions/actionWireConformance.test.ts`).
 *
 * The canonical form in the vector is what the editor writes; `wire` is a variant
 * a hand or an older editor may have written. Both MUST compile to the same chain
 * here, and the chain MUST be the step sequence the vector names — so a menu
 * authored in the editor runs exactly what the board shows.
 */
class ActionWireConformanceTest {
    private val mapper = ObjectMapper()

    private fun vector(): JsonNode {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            val f = File(dir, "testdata/action-wire-conformance.json")
            if (f.exists()) return mapper.readTree(f)
            dir = dir.parentFile
        }
        error("testdata/action-wire-conformance.json not found from ${System.getProperty("user.dir")}")
    }

    /** JSON tree → the plain maps/lists/scalars SnakeYAML hands the parser. */
    private fun plain(node: JsonNode): Any? = mapper.convertValue(node, Any::class.java)

    /** `OpenMenu` → `open_menu`, `PaginationNext` → `pagination_next`: the wire key. */
    private fun wireName(step: Step): String = when (step) {
        is Step.IfStep -> "if"
        is Step.ActionStep -> step.action::class.simpleName!!
            .replace(Regex("(?<=[a-z0-9])([A-Z])")) { "_" + it.value }
            .lowercase()
    }

    @TestFactory
    fun `the keyed parser reads the vector like the editor`(): List<DynamicTest> =
        vector()["cases"].map { c ->
            DynamicTest.dynamicTest(c["name"].asText()) {
                val fromWire = KeyedStepParser.parseKeyed(plain(c["wire"]))
                val fromCanonical = KeyedStepParser.parseKeyed(plain(c["canonical"]))
                assertEquals(fromCanonical, fromWire, "wire and canonical must compile to the same chain")
                assertEquals(c["names"].map { it.asText() }, fromWire.map(::wireName), "top-level step names")
            }
        }
}
