package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.integrations.SoftDepRegistry
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.render.menu.MenuRenderer
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

/** A lore line whose `{…}` give nothing is dropped; a line left empty in the YAML stays. */
class MenuRendererEmptyLoreLineTest {
    @BeforeEach fun setup() { MockBukkit.mock() }
    @AfterEach fun teardown() = MockBukkit.unmock()

    private val plain = PlainTextComponentSerializer.plainText()

    private fun lore(lines: List<String>, args: Map<String, Any>): List<String> {
        val yaml = """
            schema: menu/v1
            id: guild
            title: []
            size: 9
            layers:
              - id: main
                name: Main
                elements:
                  - id: member
                    positions: "0"
                    material: PAPER
                    lore:
            """.trimIndent() + "\n" + lines.joinToString("\n") { "          - '${it.replace("'", "''")}'" }
        val menu: MenuYaml = ObjectMapper(YAMLFactory()).registerKotlinModule().readValue(yaml)
        val deps = SoftDepRegistry(vault = null, papi = null, worldGuard = null, hdbHeads = null)
        val p = MockBukkit.getMock()!!.addPlayer()
        val runtime = MenuCompiler.compile(menu, emptyMap())
        return MenuRenderer.open(p, runtime, "en", ExecutionContext(p, args = args), ConditionEvaluator(deps, CooldownStore()))
            .slots[0]!!.itemMeta!!.lore()!!.map { plain.serialize(it) }
    }

    private val source = listOf(
        "<gray>Grade : {rank}",
        "",
        "{can_promote ? \"<yellow>Clic gauche : promouvoir\" : \"\"}",
        "<red>{can_kick ? \"Shift + clic droit : exclure\" : \"\"}",
        "<gray>{note}",
    )

    @Test
    fun `a rule on its own line shows only when it holds`() {
        val args = mapOf("rank" to "Officier", "can_promote" to true, "can_kick" to false, "note" to "")
        assertEquals(listOf("Grade : Officier", "", "Clic gauche : promouvoir"), lore(source, args))
    }

    @Test
    fun `every rule holding keeps every line`() {
        val args = mapOf("rank" to "Chef", "can_promote" to true, "can_kick" to true, "note" to "Fondateur")
        assertEquals(
            listOf("Grade : Chef", "", "Clic gauche : promouvoir", "Shift + clic droit : exclure", "Fondateur"),
            lore(source, args),
        )
    }

    @Test
    fun `a newline inside an expression does not split the line it is on`() {
        assertEquals(listOf("a{b\n}c", "d"), MenuRenderer.sourceLines("a{b\n}c\nd"))
    }
}
