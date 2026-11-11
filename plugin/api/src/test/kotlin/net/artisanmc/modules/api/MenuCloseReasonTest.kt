package net.artisanmc.modules.api

import net.artisanmc.modules.api.menu.MenuCloseReason
import org.bukkit.event.inventory.InventoryCloseEvent
import kotlin.test.Test
import kotlin.test.assertEquals

class MenuCloseReasonTest {
    @Test fun `every Paper close reason has the same name here`() {
        InventoryCloseEvent.Reason.entries.forEach { assertEquals(it.name, MenuCloseReason.named(it.name).name) }
    }

    @Test fun `null or an unknown name is UNKNOWN`() {
        assertEquals(MenuCloseReason.UNKNOWN, MenuCloseReason.named(null))
        assertEquals(MenuCloseReason.UNKNOWN, MenuCloseReason.named("SOMETHING_NEW"))
    }
}
