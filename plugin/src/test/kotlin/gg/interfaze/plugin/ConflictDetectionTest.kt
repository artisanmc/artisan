package gg.interfaze.plugin

import gg.interfaze.plugin.provider.SyncAction
import gg.interfaze.plugin.provider.detectSyncAction
import kotlin.test.Test
import kotlin.test.assertEquals

class ConflictDetectionTest {

    @Test
    fun `in sync when disk hash matches backend hash`() {
        val result = detectSyncAction(diskHash = "h1", syncedHash = "", backendHash = "h1")
        assertEquals(SyncAction.IN_SYNC, result)
    }

    @Test
    fun `auto sync when disk equals synced but backend is newer`() {
        val result = detectSyncAction(diskHash = "original", syncedHash = "original", backendHash = "backend_newer")
        assertEquals(SyncAction.AUTO_SYNC, result)
    }

    @Test
    fun `local only when disk changed but backend hash equals synced`() {
        val result = detectSyncAction(diskHash = "disk_v3", syncedHash = "original", backendHash = "original")
        assertEquals(SyncAction.LOCAL_ONLY, result)
    }

    @Test
    fun `conflict when disk synced and backend all differ`() {
        val result = detectSyncAction(diskHash = "disk_v3", syncedHash = "original", backendHash = "backend_v2")
        assertEquals(SyncAction.CONFLICT, result)
    }
}
