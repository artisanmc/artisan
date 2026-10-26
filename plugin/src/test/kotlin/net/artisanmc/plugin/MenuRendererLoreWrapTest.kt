package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.render.MenuRenderer
import net.kyori.adventure.text.format.NamedTextColor
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

/** The project's `lore_max_width` wraps lore lines after placeholders are resolved. */
class MenuRendererLoreWrapTest {
    @BeforeEach fun setup() { MockBukkit.mock() }
    @AfterEach fun teardown() = MockBukkit.unmock()

    private val plain = PlainTextComponentSerializer.plainText()

    private fun menu(lore: String): MenuYaml = ObjectMapper(YAMLFactory()).registerKotlinModule().readValue(
        """
        schema: menu/v1
        id: shop
        title: []
        size: 9
        layers:
          - id: main
            name: Main
            elements:
              - id: icon
                positions: "0"
                material: DIAMOND
                lore:
                  - "$lore"
        """.trimIndent(),
    )

    private fun lore(width: Int, line: String, args: Map<String, Any> = emptyMap()) = run {
        val deps = SoftDepRegistry(
            economy = net.artisanmc.modules.api.EconomyRegistry(), papi = null, worldGuard = null,
            nexoItems = null, oraxenItems = null, itemsAdderItems = null, hdbHeads = null,
        )
        val p = MockBukkit.getMock()!!.addPlayer()
        val bundle = BundleCompiler.compile(menu(line), emptyMap()).copy(loreMaxWidth = width)
        MenuRenderer.open(p, bundle, "en", ExecutionContext(p, args = args), ConditionEvaluator(deps, CooldownStore()))
            .slots[0]!!.itemMeta!!.lore()!!
    }

    @Test
    fun `a long line wraps and keeps its color on the continuation`() {
        val lines = lore(30, "<red>aaaa bbbb")
        assertEquals(listOf("aaaa", "bbbb"), lines.map { plain.serialize(it) })
        assertEquals(NamedTextColor.RED, lines[1].color())
    }

    @Test
    fun `placeholders are resolved before wrapping`() {
        assertEquals(listOf("aaaa", "bbbb"), lore(30, "{desc}", mapOf("desc" to "aaaa bbbb")).map { plain.serialize(it) })
    }

    @Test
    fun `zero width leaves lines untouched`() {
        assertEquals(listOf("aaaa bbbb"), lore(0, "aaaa bbbb").map { plain.serialize(it) })
    }
}
