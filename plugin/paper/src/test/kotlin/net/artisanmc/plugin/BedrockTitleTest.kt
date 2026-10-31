package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.engine.MenuCompiler
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.render.menu.MenuRenderer
import net.artisanmc.plugin.render.title.BedrockTitle
import kotlin.test.*

class BedrockTitleTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private fun menu(yaml: String) = ObjectMapper(YAMLFactory()).registerKotlinModule().readValue<MenuYaml>(yaml.trimIndent())

    @Test fun `the key matches the one the editor computes`() {
        // sha256("lobby:shop") starts with 0x97 0xfa: U+F880 + 0x97 % 0x7F, U+F880 + 0xfa % 0x7F.
        assertEquals("", BedrockTitle.key("lobby", "shop"))
        assertNotEquals(BedrockTitle.key("lobby", "shop"), BedrockTitle.key("lobby", "shop2"))
    }

    @Test fun `only chests of 3 or 6 rows with a visible inventory are styled`() {
        assertTrue(BedrockTitle.supports(menu("id: a\nsize: 27")))
        assertTrue(BedrockTitle.supports(menu("id: a\nsize: 54")))
        assertFalse(BedrockTitle.supports(menu("id: a\nsize: 36")))
        assertFalse(BedrockTitle.supports(menu("id: a\nsize: 27\nplayer_inventory: hidden")))
        assertFalse(BedrockTitle.supports(menu("id: a\nsize: 5\ninventory_type: hopper")))
    }

    @Test fun `marker, key, one pair per image button, then the padded text fields`() {
        val yaml = menu("""
            id: shop
            size: 54
            title:
              - kind: text
                value: "Hello {player.name}"
                x: 20
                y: 30
              - kind: background
                asset: frame
              - kind: textarea
                value: "a\nb"
                x: 1
                y: 2
                width: 80
                line_height: 9
                alignment: left
            elements:
              - id: buy
                positions: "30-32"
                image: { asset: buy }
                states:
                  - if: [{ type: has_level, level: 10 }]
                    title: VIP
                  - if: [{ type: has_level, level: 5 }]
                    image: { asset: buy_gold }
              - id: list
                positions: "0-8"
                iterates: { source: items, alias: it }
                image: { asset: buy }
              - id: plain
                positions: "40"
                material: STONE
        """)
        val compiled = MenuCompiler.compile(yaml, emptyMap(), defaultLang = "en").copy(projectId = "lobby")
        val buy = yaml.allElements.first()
        assertEquals(listOf(buy), BedrockTitle.buttons(yaml))
        val state2 = compiled.compiledAppearances.getValue("buy").first { it.yaml === buy.states[1] }
        val title = BedrockTitle.compile(compiled, mapOf("buy" to state2)) { value -> "<bold>${value.key}</bold> Iban" }
        val expected = StringBuilder()
            .append('').append(BedrockTitle.key("lobby", "shop"))
            .append('').append('')
            .append(BedrockTitle.field("Hello {player.name} Iban", BedrockTitle.TEXT_FIELD))
            .append(BedrockTitle.field("a\nb Iban", BedrockTitle.TEXTAREA_FIELD))
            .toString()
        assertEquals(expected, title)

        // No matching appearance: state 0; a field longer than its length is cut.
        val none = BedrockTitle.compile(compiled, mapOf("buy" to null)) { "x".repeat(200) }
        assertEquals('', none[4])
        assertEquals(3 * (1 + 2 + 2) + BedrockTitle.TEXT_FIELD + BedrockTitle.TEXTAREA_FIELD, none.toByteArray(Charsets.UTF_8).size)
    }

    @Test fun `a field is exactly its bytes, cut at a character boundary, padded with PAD then spaces`() {
        val bytes = { s: String -> s.toByteArray(Charsets.UTF_8).size }
        // 24 ASCII bytes + 40 free = 12 PAD + 2 PAD2: no space left to shift a centred line.
        val ascii = BedrockTitle.field("Bien le bonjour bedrock!", 64)
        assertEquals(64, bytes(ascii))
        assertEquals("Bien le bonjour bedrock!" + "${BedrockTitle.PAD}".repeat(12) + "${BedrockTitle.PAD2}".repeat(2), ascii)
        // é is 2 bytes: 5 free = 1 PAD + 1 PAD2.
        assertEquals("é" + "${BedrockTitle.PAD}" + "${BedrockTitle.PAD2}", BedrockTitle.field("é", 7))
        // A 2-byte character that does not fit is left out, not cut in half.
        assertEquals("aa" + " ", BedrockTitle.field("aaé", 3))
        assertEquals(10, bytes(BedrockTitle.field("€€€€€", 10)))
    }

    @Test fun `a Bedrock player's menu opens like a Java player's`() {
        // MockBukkit does not expose the opened view's title, so this only checks
        // the Bedrock branch of MenuRenderer renders; the title itself is covered above.
        val yaml = menu("""
            id: shop
            size: 27
            title: "Shop"
            elements: []
        """)
        val compiled = MenuCompiler.compile(yaml, emptyMap())
        val player = MockBukkit.getMock()!!.addPlayer()
        MenuRenderer.open(player, compiled, "en", bedrock = { true })
        assertEquals(27, player.openInventory.topInventory.size)
        MenuRenderer.open(player, compiled, "en")
        assertEquals(27, player.openInventory.topInventory.size)
    }
}
