package net.artisanmc.plugin.engine

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.modules.api.model.ModelField
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import java.io.File

/**
 * Completeness of the core vocabulary (ADR `extensible-document-kinds`, R1): every
 * action of `$defs.Action` in `docs/schema/menu/v1/schema.json` has exactly one
 * [ActionSchema] in [CoreActions], with the same arguments (names, required flags,
 * types, defaults), and no core schema exists outside the published schema.
 */
class CoreActionSchemaConformanceTest {
    private val mapper = ObjectMapper()

    private fun schema(): JsonNode {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            val f = File(dir, "docs/schema/menu/v1/schema.json")
            if (f.exists()) return mapper.readTree(f)
            dir = dir.parentFile
        }
        error("docs/schema/menu/v1/schema.json not found from ${System.getProperty("user.dir")}")
    }

    /**
     * Published in `$defs.Action` so that a Trigger's chain validates at any depth, but
     * registered by the `triggers` module, not by [CoreActions].
     */
    private val moduleActions = setOf("set_event")

    /** `{ name: spec }` of every core `$defs.Action` alternative. */
    private fun actions(): Map<String, JsonNode> =
        // Without `required`: the branch for actions modules declare at runtime, named by pattern.
        schema()["\$defs"]["Action"]["oneOf"].filter { it.has("required") }.associate { alt ->
            val name = alt["required"][0].asText()
            name to alt["properties"][name]
        }.filterKeys { it !in moduleActions }

    @Test fun `the core schemas and the published vocabulary are the same set`() {
        assertEquals(actions().keys.sorted(), CoreActions.all.map { it.name }.sorted())
        assertEquals(CoreActions.all.size, CoreActions.all.map { it.name }.toSet().size, "one schema per name")
    }

    @TestFactory
    fun `each core schema matches its published arguments`(): List<DynamicTest> = actions().map { (name, spec) ->
        DynamicTest.dynamicTest(name) {
            val core = CoreActions.schema(name) ?: error("no core schema for $name")
            val alternatives = spec["oneOf"]?.toList() ?: listOf(spec)
            val objectForm = alternatives.firstOrNull { it["type"]?.asText() == "object" }
            val scalarForms = alternatives.filter { it["type"]?.asText() != "object" }
            when {
                // `close_menu: null`: no argument at all.
                objectForm == null && scalarForms.all { it["type"]?.asText() == "null" } ->
                    assertTrue(core.args.isEmpty(), "$name declares no argument")
                // `give_xp: 5`, `send_message: <ltext>`: the only argument is the primary.
                objectForm == null -> {
                    assertEquals(1, core.args.size, "$name has exactly one argument")
                    assertEquals(core.args[0].name, core.primary, "$name binds its scalar to its only argument")
                    assertTypeMatches(name, core.args[0], scalarForms.first { it["type"]?.asText() != "null" })
                }
                else -> {
                    val props = objectForm["properties"]
                    assertEquals(props.fieldNames().asSequence().toList(), core.args.map { it.name }, "$name arguments")
                    val required = objectForm["required"]?.map { it.asText() }?.toSet() ?: emptySet()
                    assertEquals(required, core.args.filter { it.isRequired }.map { it.name }.toSet(), "$name required arguments")
                    if (scalarForms.isNotEmpty()) assertNotNull(core.primary, "$name has a scalar form, so a primary argument")
                    for (arg in core.args) {
                        val prop = props[arg.name]
                        assertTypeMatches(name, arg, prop)
                        prop["default"]?.let { d ->
                            assertEquals(mapper.convertValue(d, Any::class.java), arg.default, "$name.${arg.name} default")
                        }
                    }
                }
            }
        }
    }

    /** The declared [ModelField] kind the JSON Schema fragment stands for. */
    private fun assertTypeMatches(action: String, arg: ModelField, prop: JsonNode) {
        val expected = when {
            prop["\$ref"]?.asText() == "#/\$defs/LText" -> "ltext"
            prop["enum"] != null -> "enum"
            else -> when (prop["type"]?.asText()) {
                "string" -> if (arg.type.kind == "document_ref") "document_ref" else "string"
                "integer" -> "integer"
                "number" -> "number"
                "boolean" -> "boolean"
                "object" -> "map"
                "array" -> "list"
                else -> error("$action.${arg.name}: unexpected schema fragment $prop")
            }
        }
        assertEquals(expected, arg.type.kind, "$action.${arg.name} type")
        if (expected == "enum") assertEquals(prop["enum"].map { it.asText() }, arg.type.values, "$action.${arg.name} enum values")
    }
}
