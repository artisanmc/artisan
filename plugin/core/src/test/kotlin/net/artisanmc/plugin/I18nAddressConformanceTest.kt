package net.artisanmc.plugin

import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.actiondsl.compileActionDsl
import net.artisanmc.modules.api.model.ModelField
import net.artisanmc.modules.api.model.ModelFieldType
import net.artisanmc.plugin.engine.ActionSchema
import net.artisanmc.plugin.engine.CoreActions
import net.artisanmc.plugin.engine.I18nAddress
import net.artisanmc.plugin.engine.KeyedStepParser
import net.artisanmc.plugin.model.MenuTitleLayer
import net.artisanmc.plugin.engine.MenuTitleParser
import net.artisanmc.plugin.engine.Step
import net.artisanmc.plugin.engine.assignI18nAddresses
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory
import java.io.File

/**
 * Plugin half of the i18n address contract, asserted against the shared vector
 * `testdata/i18n-address-conformance.json` — the same one the editor suite
 * (`editor/src/features/export/i18nAddressConformance.test.ts`) asserts.
 *
 * Inline mode makes these addresses load-bearing: the editor writes a
 * translation at the address of its key site, the plugin looks it up at the
 * address it re-derives from the file. One divergence and the translation is
 * invisible at runtime — silently, with the literal still rendering. Changing
 * the scheme means changing this vector and both suites.
 */
class I18nAddressConformanceTest {

    private fun vector(): JsonNode {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            val f = File(dir, "testdata/i18n-address-conformance.json")
            if (f.exists()) {
                return ObjectMapper().registerKotlinModule()
                    .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
                    .readTree(f)
            }
            dir = dir.parentFile
        }
        error("conformance vector not found from ${System.getProperty("user.dir")}")
    }

    private fun JsonNode.str(field: String): String = this[field].asText()
    private fun JsonNode.int(field: String): Int = this[field].asInt()

    private fun address(site: JsonNode): String = when (val kind = site.str("kind")) {
        "menu_title" -> I18nAddress.menuTitleLayer(site.str("menu_id"), site.int("layer_index"))
        "appearance" -> I18nAddress.appearance(
            site.str("menu_id"), site.str("element_id"), site.int("appearance_index"),
        )
        "appearance_title" -> "${I18nAddress.appearance(site.str("menu_id"), site.str("element_id"), site.int("appearance_index"))}.title"
        "appearance_lore" -> "${I18nAddress.appearance(site.str("menu_id"), site.str("element_id"), site.int("appearance_index"))}.lore"
        "click_prefix" -> I18nAddress.clickHandler(
            I18nAddress.appearance(site.str("menu_id"), site.str("element_id"), site.int("appearance_index")),
            site.str("click_type"),
        )
        "command_prefix" -> I18nAddress.command(site.str("command_id"))
        "dialog_title" -> I18nAddress.dialogTitle(site.str("dialog_id"))
        "dialog_body" -> I18nAddress.dialogBody(site.str("dialog_id"), site.int("body_index"))
        "dialog_input_label" -> I18nAddress.dialogInputLabel(site.str("dialog_id"), site.str("input_id"))
        "dialog_option_label" -> I18nAddress.dialogOptionLabel(
            site.str("dialog_id"), site.str("input_id"), site.str("option_value"),
        )
        "dialog_button_label" -> I18nAddress.dialogButtonLabel(site.str("dialog_id"), site.str("button_id"))
        "dialog_button_prefix" -> I18nAddress.dialogButton(site.str("dialog_id"), site.str("button_id"))
        else -> error("unknown site kind: $kind")
    }

    @TestFactory
    fun `key sites are addressed as the editor addresses them`(): List<DynamicTest> =
        vector()["sites"].map { site ->
            DynamicTest.dynamicTest(site.str("name")) {
                assertEquals(site.str("address"), address(site))
            }
        }

    /** Title layer descriptor → the YAML node the plugin would read from disk. */
    private fun layerNode(l: JsonNode): Any = when (l.str("kind")) {
        "background" -> mapOf("kind" to "background", "asset_id" to l.str("asset_id"))
        "glyph" -> mapOf("kind" to "glyph", "asset_id" to l.str("asset_id"), "x" to l.int("x"), "y" to l.int("y"))
        "plain" -> mapOf("kind" to "plain", "value" to l.str("value"))
        "textarea" -> mapOf(
            "kind" to "textarea", "value" to l.str("value"), "x" to l.int("x"), "y" to l.int("y"),
        )
        else -> mapOf("kind" to "text", "value" to l.str("value"), "x" to l.int("x"), "y" to l.int("y"))
    }

    @TestFactory
    fun `menu title layers are addressed as the editor addresses them`(): List<DynamicTest> =
        vector()["menu_titles"].map { case ->
            DynamicTest.dynamicTest(case.str("name")) {
                val layers = MenuTitleParser.parse(case["layers"].map { layerNode(it) }, case.str("menu_id"))
                val got = layers.mapNotNull {
                    when (it) {
                        is MenuTitleLayer.Plain -> it.value.address
                        is MenuTitleLayer.Text -> it.value.address
                        is MenuTitleLayer.Textarea -> it.value.address
                        else -> null
                    }
                }
                assertEquals(case["addresses"].map { it.asText() }, got)
            }
        }

    /** Every action address of a step tree, in the order the editor's visitor yields them. */
    private fun stepAddresses(steps: List<Step>): List<String> {
        val out = mutableListOf<String>()
        fun walk(list: List<Step>) {
            for (s in list) when (s) {
                is Step.ActionStep -> out.addAll(s.i18n.values)
                is Step.IfStep -> { s.cases.forEach { walk(it.steps) }; walk(s.elseSteps) }
            }
        }
        walk(steps)
        return out
    }

    /** A `declared_actions` wire entry (Presence shape) → the schema the addresser reads. */
    private fun schemaOf(decl: JsonNode): ActionSchema = ActionSchema(
        name = decl.str("name"),
        args = decl["args"].map { a ->
            ModelField(a.str("name"), typeOf(a["type"]), a["required"]?.asBoolean() ?: false)
        },
        primary = decl["primary"]?.takeUnless { it.isNull }?.asText(),
    )

    private fun typeOf(t: JsonNode): ModelFieldType = when (val kind = t.str("kind")) {
        "ltext" -> ModelFieldType.ltext()
        "list" -> ModelFieldType.list(typeOf(t["of"]))
        "actions" -> ModelFieldType.actions()
        "string" -> ModelFieldType.string()
        else -> error("unsupported field kind in vector: $kind")
    }

    /** The chain of a case: its legacy DSL, or its keyed steps read as the plugin reads a file. */
    private fun stepsOf(case: JsonNode): List<Step> =
        if (case.has("dsl")) compileActionDsl(case.str("dsl"))
        else KeyedStepParser.parseKeyed(ObjectMapper().convertValue(case["steps"], Any::class.java))

    @TestFactory
    fun `action texts are addressed as the editor addresses them`(): List<DynamicTest> =
        vector()["step_addresses"].map { case ->
            DynamicTest.dynamicTest(case.str("name")) {
                val declared = (case["declared_actions"] ?: emptyList<JsonNode>()).map { schemaOf(it) }.associateBy { it.name }
                val lookup = { name: String -> declared[name] ?: CoreActions.schema(name) }
                val steps = assignI18nAddresses(stepsOf(case), case.str("prefix"), lookup)
                assertEquals(case["addresses"].map { it.asText() }, stepAddresses(steps))
            }
        }
}
