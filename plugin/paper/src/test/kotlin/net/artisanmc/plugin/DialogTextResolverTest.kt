package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.engine.ExecutionContext
import net.artisanmc.plugin.model.RuntimeDialog
import net.artisanmc.plugin.model.DialogYaml
import net.artisanmc.plugin.render.DialogTextResolver
import kotlin.test.*

/**
 * The dialog text resolution chain (i18n → args) lives in DialogTextResolver, apart
 * from DialogRenderer: the Paper 1.21.7 dialog API is not on the test classpath
 * (paper-api 1.21.1 through MockBukkit), so DialogRenderer cannot be loaded here.
 */
class DialogTextResolverTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()

    private fun dialog(yaml: String, langMap: Map<String, String> = emptyMap()): RuntimeDialog =
        RuntimeDialog(mapper.readValue<DialogYaml>(yaml), langMaps = mapOf("en" to langMap))

    private fun ctx(langMap: Map<String, String> = emptyMap()) =
        ExecutionContext(MockBukkit.getMock()!!.addPlayer("Steve"), langMap = langMap)

    @Test fun `title resolves builtin player placeholder`() {
        val d = dialog(
            """
            id: d
            title: "Hello {player.name}"
            buttons:
              - { id: ok, label: OK }
            """.trimIndent(),
        )
        val texts = DialogTextResolver.resolveAll(d, ctx(d.langMapWithFallback("en")))
        assertEquals("Hello Steve", texts.title)
    }

    @Test fun `body text and button labels resolve args, item bodies stay null`() {
        val d = dialog(
            """
            id: d
            title: T
            body:
              - { type: text, text: "Welcome {player}" }
              - { type: item, material: DIAMOND }
            buttons:
              - { id: ok, label: "Confirm, {player.name}" }
            """.trimIndent(),
        )
        val texts = DialogTextResolver.resolveAll(d, ctx(d.langMapWithFallback("en")))
        assertEquals(listOf<String?>("Welcome Steve", null), texts.bodyTexts)
        assertEquals(listOf("Confirm, Steve"), texts.buttonLabels)
    }

    @Test fun `input and option labels resolve args`() {
        val d = dialog(
            """
            id: d
            title: T
            inputs:
              - id: tier
                type: single_option
                label: "Tier for {player.name}"
                options:
                  - { value: basic, label: "Basic ({player})" }
            buttons:
              - { id: ok, label: OK }
            """.trimIndent(),
        )
        val texts = DialogTextResolver.resolveAll(d, ctx(d.langMapWithFallback("en")))
        assertEquals(listOf("Tier for Steve"), texts.inputLabels)
        assertEquals(listOf(listOf("Basic (Steve)")), texts.inputOptionLabels)
    }

    @Test fun `i18n resolves before args — same chain as MenuRenderer`() {
        val d = dialog(
            """
            id: d
            title: "{i18n:greet}"
            buttons:
              - { id: ok, label: OK }
            """.trimIndent(),
            langMap = mapOf("greet" to "Hi {player}"),
        )
        val texts = DialogTextResolver.resolveAll(d, ctx(d.langMapWithFallback("en")))
        assertEquals("Hi Steve", texts.title)
    }

    @Test fun `unknown placeholder stays literal`() {
        val d = dialog(
            """
            id: d
            title: "{nope} and {player.unknown_field}"
            buttons:
              - { id: ok, label: OK }
            """.trimIndent(),
        )
        val texts = DialogTextResolver.resolveAll(d, ctx(d.langMapWithFallback("en")))
        // ADR `expression-parity` §4, the two halves of the rule: an unbound ROOT
        // (`nope`) keeps its source so the typo is visible, while a bound root with
        // a missing FIELD renders empty — rows are allowed to omit fields, and the
        // rule stays uniform rather than special-casing fixed-shape objects.
        assertEquals("{nope} and ", texts.title)
    }
}
