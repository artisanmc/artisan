package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.render.HeadRef
import net.artisanmc.plugin.render.MenuRenderer
import org.bukkit.Material
import org.bukkit.inventory.meta.SkullMeta
import kotlin.test.*

class MenuRendererHeadTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()
    private fun player() = MockBukkit.getMock()!!.addPlayer()

    private val B64 = "eyJ0ZXh0dXJlcyI6e319"

    private fun headMenu(material: String, head: String): MenuYaml = mapper.readValue(
        """
        schema: menu/v1
        id: heads
        title: []
        size: 9
        layers:
          - id: main
            name: Main
            elements:
              - id: hd
                positions: "0"
                material: $material
                head: "$head"
        """.trimIndent(),
    )

    private fun render(material: String, head: String, args: Map<String, Any> = emptyMap()): org.bukkit.inventory.ItemStack? {
        val p = player()
        val menu = BundleCompiler.compile(headMenu(material, head), emptyMap())
        MenuRenderer.open(p, menu, "en", ExecutionContext(p, args = args))
        return p.openInventory.topInventory.getItem(0)
    }

    @Test fun `basehead applies a textures profile with a deterministic uuid`() {
        val item = render("PLAYER_HEAD", "basehead:$B64")
        assertEquals(Material.PLAYER_HEAD, item?.type)
        val meta = item?.itemMeta as SkullMeta
        val profile = meta.playerProfile
        assertNotNull(profile)
        assertEquals(HeadRef.uuidFor(B64), profile.id)
        assertEquals(B64, profile.properties.first { it.name == "textures" }.value)
    }

    @Test fun `raw base64 without prefix is treated as basehead`() {
        val meta = render("PLAYER_HEAD", B64)?.itemMeta as SkullMeta
        assertNotNull(meta.playerProfile)
    }

    @Test fun `playerhead sets the owning player`() {
        val meta = render("PLAYER_HEAD", "playerhead:Notch")?.itemMeta as SkullMeta
        assertEquals("Notch", meta.owningPlayer?.name)
    }

    @Test fun `playerhead resolves context placeholders`() {
        val meta = render("PLAYER_HEAD", "playerhead:{owner}", args = mapOf("owner" to "Steve"))
            ?.itemMeta as SkullMeta
        assertEquals("Steve", meta.owningPlayer?.name)
    }

    @Test fun `playerhead resolves PAPI placeholders like title and lore do`() {
        val p = player()
        val menu = BundleCompiler.compile(headMenu("PLAYER_HEAD", "playerhead:%player_name%"), emptyMap())
        val fakePapi = object : PapiProvider() {
            override fun resolve(player: org.bukkit.entity.Player, text: String): String =
                text.replace("%player_name%", player.name)
        }
        val deps = SoftDepRegistry(
            vault = null, papi = fakePapi, worldGuard = null,
            nexoItems = null, oraxenItems = null, itemsAdderItems = null, hdbHeads = null,
        )
        MenuRenderer.open(p, menu, "en", ExecutionContext(p), ConditionEvaluator(deps, CooldownStore()))
        val meta = p.openInventory.topInventory.getItem(0)?.itemMeta as SkullMeta
        assertEquals(p.name, meta.owningPlayer?.name)
    }

    @Test fun `hdb without HeadDatabase falls back to a plain player head`() {
        val item = render("PLAYER_HEAD", "hdb:128276")
        assertEquals(Material.PLAYER_HEAD, item?.type)
        assertNull((item?.itemMeta as SkullMeta).playerProfile)
    }

    @Test fun `head is ignored when material is not PLAYER_HEAD`() {
        val item = render("STONE", "basehead:$B64")
        assertEquals(Material.STONE, item?.type)
    }

    @Test fun `unparseable head renders the plain head without crashing`() {
        val item = render("PLAYER_HEAD", "wat:123")
        assertEquals(Material.PLAYER_HEAD, item?.type)
    }
}
