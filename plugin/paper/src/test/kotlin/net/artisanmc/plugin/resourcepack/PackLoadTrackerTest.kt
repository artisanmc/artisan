package net.artisanmc.plugin.resourcepack

import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Who has the pack (`textured`, `has_resource_pack`): a pack that stops working no longer counts. */
class PackLoadTrackerTest {
    private val player = UUID.randomUUID()
    private val pack = UUID.randomUUID()

    @Test fun `a failed reload of the loaded pack drops the player back to no pack`() {
        val t = PackLoadTracker()
        t.status(player, pack, "SUCCESSFULLY_LOADED")
        assertTrue(t.hasLoaded(player))
        t.status(player, pack, "FAILED_RELOAD")
        assertFalse(t.hasLoaded(player))
    }

    @Test fun `a refused or discarded pack of Artisan drops it too, sent directly`() {
        val t = PackLoadTracker().apply { delegated = false; pushed(pack) }
        t.status(player, pack, "SUCCESSFULLY_LOADED")
        t.status(player, pack, "DISCARDED")
        assertFalse(t.hasLoaded(player))
    }

    @Test fun `another plugin's pack failing leaves the loaded one alone`() {
        val t = PackLoadTracker()
        t.status(player, pack, "SUCCESSFULLY_LOADED")
        t.status(player, UUID.randomUUID(), "FAILED_DOWNLOAD")
        t.status(player, UUID.randomUUID(), "DECLINED")
        assertTrue(t.hasLoaded(player))
    }

    @Test fun `steps on the way do not count as lost`() {
        val t = PackLoadTracker()
        t.status(player, pack, "SUCCESSFULLY_LOADED")
        t.status(player, pack, "ACCEPTED")
        t.status(player, pack, "DOWNLOADED")
        assertTrue(t.hasLoaded(player))
    }
}
