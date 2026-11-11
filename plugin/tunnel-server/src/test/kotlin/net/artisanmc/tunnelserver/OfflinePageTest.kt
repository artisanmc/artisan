package net.artisanmc.tunnelserver

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class OfflinePageTest {
    @Test
    fun `the browser's first language picks French`() {
        assertTrue(OfflinePage.french("fr-FR,fr;q=0.9,en;q=0.8"))
        assertTrue(OfflinePage.french("FR"))
        assertFalse(OfflinePage.french("en-US,fr;q=0.9"))
        assertFalse(OfflinePage.french(null))
    }

    @Test
    fun `the host is escaped and each reason has its own title`() {
        val offline = OfflinePage.html(OfflinePage.Reason.OFFLINE, "<b>.artisanmc.app", french = false)
        assertTrue(offline.contains("&lt;b&gt;.artisanmc.app"))
        assertFalse(offline.contains("<b>"))
        assertTrue(offline.contains("This Minecraft server is offline"))
        assertTrue(OfflinePage.html(OfflinePage.Reason.NO_ANSWER, "x", french = true).contains("ne répond pas"))
    }
}
