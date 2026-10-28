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
 * a hand or an older editor may have written. Both MUST bind to the same chain
 * here (the argument maps the handlers receive, [CoreActions] defaults included),
 * and the chain MUST be the step sequence the vector names — so a menu authored
 * in the editor runs exactly what the board shows.
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

    /** The wire key of a step: the action's name, or `if`. */
    private fun wireName(step: Step): String = when (step) {
        is Step.IfStep -> "if"
        is Step.ActionStep -> step.name
    }

    /**
     * A chain as the engine runs it: each action bound to its argument map. Numbers are
     * compared as doubles: a handler reads them through [Args] (`volume: 1` on the wire and
     * the declared default `1.0` are the same value to it), so a canonical form that drops a
     * default must still bind like the wire that spelled it out.
     */
    private fun bound(steps: List<Step>): List<Any> = steps.map { step ->
        when (step) {
            is Step.ActionStep -> step.name to numbersAsDouble(CoreActions.schema(step.name)?.bind(step.value) ?: step.value)
            is Step.IfStep -> mapOf(
                "cases" to step.cases.map { it.conditions to bound(it.steps) },
                "else" to bound(step.elseSteps),
            )
        }
    }

    private fun numbersAsDouble(v: Any?): Any? = when (v) {
        is Number -> v.toDouble()
        is Map<*, *> -> v.entries.associate { (k, e) -> k to numbersAsDouble(e) }
        is List<*> -> v.map(::numbersAsDouble)
        else -> v
    }

    @TestFactory
    fun `the keyed parser reads the vector like the editor`(): List<DynamicTest> =
        vector()["cases"].map { c ->
            DynamicTest.dynamicTest(c["name"].asText()) {
                val fromWire = KeyedStepParser.parseKeyed(plain(c["wire"]))
                val fromCanonical = KeyedStepParser.parseKeyed(plain(c["canonical"]))
                assertEquals(bound(fromCanonical), bound(fromWire), "wire and canonical must compile to the same chain")
                assertEquals(c["names"].map { it.asText() }, fromWire.map(::wireName), "top-level step names")
            }
        }
}
