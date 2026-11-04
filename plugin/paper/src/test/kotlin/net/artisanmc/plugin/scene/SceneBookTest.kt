package net.artisanmc.plugin.scene

import net.artisanmc.modules.api.scene.SceneElement
import net.artisanmc.modules.api.scene.SceneTransform
import be.seeseemelk.mockbukkit.MockBukkit
import org.bukkit.Material
import org.bukkit.inventory.ItemStack
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SceneBookTest {

    /** Records what the book asks; a handle is "<key>#<n>". */
    private class FakeBackend : DisplayBackend {
        val log = mutableListOf<String>()
        val alive = mutableSetOf<String>()
        private var n = 0
        override fun spawn(viewer: UUID, anchor: Anchor, element: SceneElement): Any =
            "${element.key()}#${n++}".also { log += "spawn $it"; alive += it }
        override fun update(handle: Any, element: SceneElement, transitionTicks: Int) {
            log += "update $handle $transitionTicks"
        }
        override fun remove(handle: Any) {
            log += "remove $handle"
            check(alive.remove(handle as String)) { "removed twice or unknown: $handle" }
        }
    }

    private val backend = FakeBackend()
    private val book = SceneBook(backend)
    private val alex = UUID.randomUUID()
    private val sam = UUID.randomUUID()
    private val overworld = UUID.randomUUID()
    private val nether = UUID.randomUUID()
    private val here = Anchor.Point(overworld, 0.0, 64.0, 0.0)

    private fun text(key: String, y: Double = 0.0, mm: String = "hi") =
        SceneElement.Text.of(key, SceneTransform.offset(0.0, y, 0.0), mm)

    @Test
    fun `showing again keeps unchanged elements, updates changed ones and removes the missing`() {
        book.show(alex, "m:s", here, listOf(text("a"), text("b"), text("c")), 0)
        backend.log.clear()
        book.show(alex, "m:s", here, listOf(text("a"), text("b", y = 1.0), text("d")), 10)
        assertEquals(listOf("update b#1 10", "spawn d#3", "remove c#2"), backend.log)
        assertEquals(setOf("a#0", "b#1", "d#3"), backend.alive)
    }

    @Test
    fun `an element whose type changes is respawned`() {
        MockBukkit.mock()
        try {
            book.show(alex, "m:s", here, listOf(text("a")), 0)
            book.show(alex, "m:s", here, listOf(SceneElement.Item.of("a", SceneTransform.ORIGIN, ItemStack(Material.STONE))), 0)
            assertEquals(listOf("spawn a#0", "remove a#0", "spawn a#1"), backend.log)
        } finally {
            MockBukkit.unmock()
        }
    }

    @Test
    fun `a new anchor respawns the scene`() {
        book.show(alex, "m:s", here, listOf(text("a")), 0)
        book.show(alex, "m:s", here.copy(x = 5.0), listOf(text("a")), 0)
        assertEquals(listOf("spawn a#0", "remove a#0", "spawn a#1"), backend.log)
    }

    @Test
    fun `hide removes every element and forgets the scene`() {
        book.show(alex, "m:s", here, listOf(text("a"), text("b")), 0)
        book.hide(alex, "m:s")
        assertTrue(backend.alive.isEmpty())
        assertFalse(book.isShown(alex, "m:s"))
        book.hide(alex, "m:s") // unknown: nothing
    }

    @Test
    fun `quitting ends the viewer's scenes only`() {
        book.show(alex, "m:a", here, listOf(text("a")), 0)
        book.show(sam, "m:a", here, listOf(text("a")), 0)
        assertEquals(1, book.endViewer(alex))
        assertEquals(setOf("a#1"), backend.alive)
        assertTrue(book.isShown(sam, "m:a"))
    }

    @Test
    fun `changing world ends the scenes of other worlds`() {
        book.show(alex, "m:here", here, listOf(text("a")), 0)
        book.show(alex, "m:there", Anchor.Point(nether, 0.0, 0.0, 0.0), listOf(text("b")), 0)
        assertEquals(1, book.endOutsideWorld(alex, nether))
        assertEquals(listOf("m:there"), book.scenesOf(alex))
    }

    @Test
    fun `an anchor that leaves the world ends its scenes for every viewer`() {
        val npc = UUID.randomUUID()
        val onNpc = Anchor.OnEntity(overworld, npc, 2.2, Any())
        book.show(alex, "m:marker", onNpc, listOf(text("a")), 0)
        book.show(sam, "m:marker", onNpc, listOf(text("a")), 0)
        book.show(sam, "m:other", here, listOf(text("b")), 0)
        assertTrue(book.anchors(npc))
        assertEquals(2, book.endAnchor(npc))
        assertFalse(book.anchors(npc))
        assertEquals(listOf("m:other"), book.scenesOf(sam))
    }

    @Test
    fun `the anchor entity is compared by id, not by object`() {
        val npc = UUID.randomUUID()
        book.show(alex, "m:s", Anchor.OnEntity(overworld, npc, 2.0, Any()), listOf(text("a")), 0)
        book.show(alex, "m:s", Anchor.OnEntity(overworld, npc, 2.0, Any()), listOf(text("a", mm = "new")), 0)
        assertEquals(listOf("spawn a#0", "update a#0 0"), backend.log)
    }

    @Test
    fun `a module's scenes end with its plugin, the others stay`() {
        book.show(alex, "quests:marker", here, listOf(text("a")), 0)
        book.show(alex, "conversations:box", here, listOf(text("b")), 0)
        assertEquals(1, book.endNamespace("quests"))
        assertEquals(listOf("conversations:box"), book.scenesOf(alex))
        assertEquals(1, book.endAll())
        assertTrue(backend.alive.isEmpty())
    }

    @Test
    fun `two elements with one key are refused before anything spawns`() {
        assertFailsWith<IllegalArgumentException> {
            book.show(alex, "m:s", here, listOf(text("a"), text("a")), 0)
        }
        assertTrue(backend.log.isEmpty())
    }

    @Test
    fun `element keys are checked by the API`() {
        assertFailsWith<IllegalArgumentException> { text("Not A Key") }
        assertFailsWith<IllegalArgumentException> { SceneTransform(0.0, 0.0, 0.0, 0f, 0f) }
    }
}
