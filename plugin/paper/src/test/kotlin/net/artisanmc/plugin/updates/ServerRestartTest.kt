package net.artisanmc.plugin.updates

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ServerRestartTest {
    private val events = mutableListOf<String>()
    private var waiting: (() -> Unit)? = null
    private val restart = ServerRestart(
        announce = { events += "announce $it" },
        later = { ticks, task -> events += "wait $ticks"; waiting = task },
        restart = { events += "restart" },
    )

    @Test
    fun `players are told, then the server restarts after the countdown`() {
        assertNull(restart.request())
        assertEquals(listOf("announce 10", "wait 200"), events)
        waiting!!()
        assertEquals("restart", events.last())
    }

    @Test
    fun `a restart on its way is not asked twice`() {
        assertNull(restart.request())
        assertEquals("restart_in_progress", restart.request())
        assertEquals(1, events.count { it.startsWith("announce") })
    }
}
