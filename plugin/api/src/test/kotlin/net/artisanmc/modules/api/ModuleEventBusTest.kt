package net.artisanmc.modules.api

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class ModuleEventBusTest {
    @Test
    fun `subscribers receive published events of matching type`() {
        val bus = ModuleEventBus()
        val received = mutableListOf<String>()
        bus.subscribe(DataReloadEvent::class.java) { received.add((it as DataReloadEvent).dataSourceRef) }

        bus.publish(DataReloadEvent("shop:items"))

        assertEquals(listOf("shop:items"), received)
    }

    @Test
    fun `subscribers of other event types do not receive`() {
        val bus = ModuleEventBus()
        val received = mutableListOf<String>()
        bus.subscribe(DataReloadEvent::class.java) { received.add((it as DataReloadEvent).dataSourceRef) }

        bus.publish(ConfigReloadEvent("shop"))

        assertTrue(received.isEmpty())
    }

    private data class HomeSetEvent(val name: String) : ModuleEvent

    @Test
    fun `add-ons can publish and subscribe to their own events`() {
        val bus = ModuleEventBus()
        val received = mutableListOf<String>()
        bus.subscribe(HomeSetEvent::class.java) { received.add((it as HomeSetEvent).name) }
        bus.subscribe(DataReloadEvent::class.java) { received.add("wrong") }

        bus.publish(HomeSetEvent("base"))

        assertEquals(listOf("base"), received)
    }
}
