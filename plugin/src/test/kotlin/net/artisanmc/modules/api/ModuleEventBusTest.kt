package net.artisanmc.modules.api

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class ModuleEventBusTest {
    @Test
    fun `subscribers receive published events of matching type`() {
        val bus = ModuleEventBus()
        val received = mutableListOf<String>()
        bus.subscribe(DataReloadEvent::class.java) { received.add((it as DataReloadEvent).dataSourceRef) }

        bus.publish(DataReloadEvent(dataSourceRef = "shop:items"))

        assertEquals(listOf("shop:items"), received)
    }

    @Test
    fun `subscribers of other event types do not receive`() {
        val bus = ModuleEventBus()
        val received = mutableListOf<String>()
        bus.subscribe(DataReloadEvent::class.java) { received.add((it as DataReloadEvent).dataSourceRef) }

        bus.publish(ConfigReloadEvent(moduleId = "shop"))

        assertTrue(received.isEmpty())
    }
}
