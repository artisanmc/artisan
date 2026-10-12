package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.plugin.items.CapturedItemStore
import org.bukkit.Material
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.io.File
import java.nio.file.Files

class CapturedItemStoreTest {
    private lateinit var projectsDir: File

    @BeforeEach fun setup() {
        MockBukkit.mock()
        projectsDir = Files.createTempDirectory("artisan_ci_").toFile()
    }
    @AfterEach fun teardown() = MockBukkit.unmock()

    /**
     * Canonical wrapped form: `item:` root key (what capture will produce).
     * Meta-free minimal fixtures — MockBukkit can't reload its own ItemMetaMock
     * (`meta: ==:` block); the real Paper runtime handles full meta fine.
     */
    private fun writeWrapped(projectId: String, itemId: String, type: Material, amount: Int) {
        val text = """
            item:
              ==: org.bukkit.inventory.ItemStack
              v: 1
              type: ${type.name}
              amount: $amount
        """.trimIndent()
        val dir = File(projectsDir, "$projectId/items").also { it.mkdirs() }
        File(dir, "$itemId.yml").writeText(text)
    }

    @Test
    fun `loads wrapped stacks from every project's items dir and resolves clones`() {
        writeWrapped("shop", "ci_sword", Material.DIAMOND_SWORD, 3)
        writeWrapped("other_project", "ci_apple", Material.APPLE, 1)
        val store = CapturedItemStore(projectsDir, null)
        store.reload()

        val sword = store.resolve("ci_sword")
        assertNotNull(sword)
        assertEquals(Material.DIAMOND_SWORD, sword!!.type)
        assertEquals(3, sword.amount)
        // Cross-project merge (mirrors how module files merge at runtime).
        assertEquals(Material.APPLE, store.resolve("ci_apple")!!.type)

        // resolve() must hand out clones — mutating a result must not corrupt the store.
        sword.amount = 64
        assertEquals(3, store.resolve("ci_sword")!!.amount)
    }

    @Test
    fun `tolerates a root-level serialized stack (no item wrapper)`() {
        val rootForm = """
            ==: org.bukkit.inventory.ItemStack
            v: 1
            type: EMERALD
            amount: 2
        """.trimIndent()
        val dir = File(projectsDir, "shop/items").also { it.mkdirs() }
        File(dir, "ci_root.yml").writeText(rootForm)

        val store = CapturedItemStore(projectsDir, null)
        store.reload()
        assertEquals(Material.EMERALD, store.resolve("ci_root")!!.type)
        assertEquals(2, store.resolve("ci_root")!!.amount)
    }

    @Test
    fun `skips unparseable files and unknown ids resolve to null`() {
        val dir = File(projectsDir, "shop/items").also { it.mkdirs() }
        File(dir, "ci_bad.yml").writeText("]: not yaml at all {{{")
        writeWrapped("shop", "ci_ok", Material.STONE, 1)

        val store = CapturedItemStore(projectsDir, null)
        store.reload() // must not throw
        assertNull(store.resolve("ci_bad"))
        assertNull(store.resolve("ci_ghost"))
        assertNotNull(store.resolve("ci_ok"))
    }

    @Test
    fun `SoftDepRegistry routes item refs through the store`() {
        writeWrapped("shop", "ci_key", Material.PAPER, 5)
        val store = CapturedItemStore(projectsDir, null)
        store.reload()
        val deps = net.artisanmc.plugin.engine.SoftDepRegistry(
            vault = null, papi = null, worldGuard = null,
            nexoItems = null, oraxenItems = null, itemsAdderItems = null,
            hdbHeads = null, capturedItems = store,
        )
        // Default count (1) keeps the captured amount (a 5-key bundle stays 5).
        val one = deps.buildCustomStack("item:ci_key", 1)!!
        assertEquals(Material.PAPER, one.type)
        assertEquals(5, one.amount)
        // An explicit count overrides.
        assertEquals(15, deps.buildCustomStack("item:ci_key", 15)!!.amount)
        // Dangling ref → null (caller falls back to vanilla lookup / STONE).
        assertNull(deps.buildCustomStack("item:ghost", 1))
    }

    /**
     * A legacy `meta.internal` blob that no longer inflates makes Bukkit log a
     * full ZipException stacktrace per file and silently drop the block-state.
     * The store must name the offending item instead, so the fix (re-capture)
     * is obvious from the log.
     */
    @Test
    fun `names the item when a legacy block-state blob is unreadable`() {
        val dead = java.util.Base64.getEncoder().encodeToString("not gzip".toByteArray())
        val dir = File(projectsDir, "shop/items").also { it.mkdirs() }
        File(dir, "ci_shulker.yml").writeText(
            """
            item:
              ==: org.bukkit.inventory.ItemStack
              v: 1
              type: SHULKER_BOX
              amount: 1
              meta:
                ==: ItemMeta
                meta-type: BLOCK_STATE
                internal: $dead
            """.trimIndent()
        )

        val warnings = mutableListOf<String>()
        val logger = object : java.util.logging.Logger("test", null) {
            override fun warning(msg: String) { warnings.add(msg) }
        }

        val store = CapturedItemStore(projectsDir, logger)
        store.reload() // must not throw

        assertTrue(
            warnings.any { it.contains("ci_shulker") && it.contains("block-state") },
            "expected a warning naming the item, got: $warnings",
        )
    }

    @Test
    fun `reload swaps atomically — removed files disappear`() {
        writeWrapped("shop", "ci_tmp", Material.STONE, 1)
        val store = CapturedItemStore(projectsDir, null)
        store.reload()
        assertNotNull(store.resolve("ci_tmp"))

        File(projectsDir, "shop/items/ci_tmp.yml").delete()
        store.reload()
        assertNull(store.resolve("ci_tmp"))
    }
}
