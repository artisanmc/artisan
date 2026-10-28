package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.items.CapturedItemStore
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.render.menu.MenuRenderer
import net.kyori.adventure.text.Component
import net.kyori.adventure.text.format.NamedTextColor
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer
import org.bukkit.Material
import org.bukkit.inventory.ItemStack
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.io.File
import java.nio.file.Files
import net.artisanmc.plugin.integrations.SoftDepRegistry

/**
 * A referenced item keeps its own presentation. The element's lore ADDS to the
 * lore the resolved stack already carries (shop lines under the item's own
 * lines) instead of replacing it — silently dropping it is what made a
 * captured ref feel lossy. A name can't concatenate: the element's title wins
 * when it declares one, and the item's own name stands when it doesn't.
 *
 * The store is faked in memory rather than written to disk: MockBukkit cannot
 * deserialize a `meta:` block, so an on-disk fixture can never carry a name or
 * lore (cf. CapturedItemStoreTest).
 */
class MenuRendererCapturedLoreTest {
    @BeforeEach fun setup() { MockBukkit.mock() }
    @AfterEach fun teardown() = MockBukkit.unmock()

    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()
    private val plain = PlainTextComponentSerializer.plainText()

    /** A store handing out one stack that carries its own name + lore. */
    private class FakeStore(private val id: String, private val stack: ItemStack) :
        CapturedItemStore(Files.createTempDirectory("artisan_fake_").toFile(), null) {
        override fun resolve(id: String): ItemStack? = if (id == this.id) stack.clone() else null
    }

    private fun capturedStack(name: String, lore: List<String>): ItemStack {
        val stack = ItemStack(Material.DIAMOND_SWORD, 1)
        val meta = stack.itemMeta!!
        meta.displayName(Component.text(name))
        if (lore.isNotEmpty()) meta.lore(lore.map { Component.text(it) })
        stack.itemMeta = meta
        return stack
    }

    private fun menuYaml(material: String, title: String?, lore: List<String>): MenuYaml = mapper.readValue(
        buildString {
            appendLine("schema: menu/v1")
            appendLine("id: shop")
            appendLine("title: []")
            appendLine("size: 9")
            appendLine("layers:")
            appendLine("  - id: main")
            appendLine("    name: Main")
            appendLine("    elements:")
            appendLine("      - id: icon")
            appendLine("        positions: \"0\"")
            appendLine("        material: \"$material\"")
            if (title != null) appendLine("        title: \"$title\"")
            if (lore.isNotEmpty()) {
                appendLine("        lore:")
                lore.forEach { appendLine("        - \"$it\"") }
            }
        },
    )

    private fun render(
        material: String,
        title: String? = null,
        lore: List<String> = emptyList(),
        captured: ItemStack? = capturedStack("Epee du VIP", listOf("Tranchante", "Rare")),
    ): ItemStack? {
        val deps = SoftDepRegistry(
            vault = null, papi = null, worldGuard = null,
            hdbHeads = null, capturedItems = captured?.let { FakeStore("ci_sword", it) },
        )
        val p = MockBukkit.getMock()!!.addPlayer()
        val menu = MenuCompiler.compile(menuYaml(material, title, lore), emptyMap())
        val slots = MenuRenderer.open(p, menu, "en", ExecutionContext(p), ConditionEvaluator(deps, CooldownStore())).slots
        return slots[0]
    }

    private fun loreOf(item: ItemStack?): List<String> =
        item?.itemMeta?.lore()?.map { plain.serialize(it) } ?: emptyList()

    @Test
    fun `authored lore defaults to white and preserves explicit colors`() {
        val lines = render("DIAMOND", lore = listOf("Plain", "<red>Red</red>", "\u00a7aGreen"))!!.itemMeta!!.lore()!!
        assertEquals(NamedTextColor.WHITE, lines[0].color())
        assertEquals(NamedTextColor.RED, lines[1].color())
        assertEquals(NamedTextColor.GREEN, lines[2].color())
    }

    @Test
    fun `element lore is appended to the referenced item's own lore`() {
        val item = render("item:ci_sword", lore = listOf("Prix : 500"))
        assertEquals(listOf("Tranchante", "Rare", "Prix : 500"), loreOf(item))
    }

    @Test
    fun `the item's lore stands alone when the element declares none`() {
        assertEquals(listOf("Tranchante", "Rare"), loreOf(render("item:ci_sword")))
    }

    @Test
    fun `the element title wins over the item's name, which stands otherwise`() {
        assertEquals(
            "Offre du jour",
            plain.serialize(render("item:ci_sword", title = "Offre du jour")!!.itemMeta!!.displayName()!!),
        )
        assertEquals(
            "Epee du VIP",
            plain.serialize(render("item:ci_sword")!!.itemMeta!!.displayName()!!),
        )
    }

    @Test
    fun `a stack without base lore is unaffected`() {
        val bare = capturedStack("Nu", emptyList())
        assertEquals(listOf("Prix : 500"), loreOf(render("item:ci_sword", lore = listOf("Prix : 500"), captured = bare)))
        assertEquals(listOf("Prix : 500"), loreOf(render("DIAMOND", lore = listOf("Prix : 500"))))
    }

    @Test
    fun `a dangling ref falls back without inheriting anything`() {
        assertEquals(listOf("Prix : 500"), loreOf(render("item:ghost", lore = listOf("Prix : 500"))))
    }
}
