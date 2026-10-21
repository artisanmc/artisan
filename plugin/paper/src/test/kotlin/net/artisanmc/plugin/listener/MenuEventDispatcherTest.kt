package net.artisanmc.plugin.listener

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.modules.api.menu.MenuClickEvent
import net.artisanmc.modules.api.menu.MenuOpenEvent
import net.artisanmc.modules.api.menu.MenuRef
import org.bukkit.event.inventory.ClickType
import java.util.logging.Logger
import kotlin.test.*

class MenuEventDispatcherTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val dispatcher = MenuEventDispatcher(Logger.getLogger("test"))
    private val menu = MenuRef("shop", "main")

    @Test fun `a listener cancelling the open stops it`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        dispatcher.onOpen { it.isCancelled = true }
        assertFalse(dispatcher.open(MenuOpenEvent(player, menu, emptyMap())))
    }

    @Test fun `a cancelled subscription is no longer called, and a failing listener does not stop the others`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        val seen = mutableListOf<Int>()
        val subscription = dispatcher.onClick { seen.add(it.slot) }
        dispatcher.onClick { error("boom") }
        assertTrue(dispatcher.click(MenuClickEvent(player, menu, 3, ClickType.LEFT, true)))
        subscription.cancel()
        dispatcher.click(MenuClickEvent(player, menu, 4, ClickType.LEFT, true))
        assertEquals(listOf(3), seen)
    }

    @Test fun `the listeners a disabling plugin loaded are removed, and a broken one does not stop the open`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        dispatcher.onOpen { throw NoClassDefFoundError("a closed jar") }
        assertTrue(dispatcher.open(MenuOpenEvent(player, menu, emptyMap())))

        dispatcher.onOpen { it.isCancelled = true }
        dispatcher.onClick { }
        assertEquals(0, dispatcher.releaseLoadedBy(java.net.URLClassLoader(arrayOf())))
        assertEquals(3, dispatcher.releaseLoadedBy(javaClass.classLoader))
        assertTrue(dispatcher.open(MenuOpenEvent(player, menu, emptyMap())))
    }
}
