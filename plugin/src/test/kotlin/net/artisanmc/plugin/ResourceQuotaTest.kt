package net.artisanmc.plugin

import net.artisanmc.plugin.project.ResourceEntry
import net.artisanmc.plugin.project.ResourceQuota
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class ResourceQuotaTest {
    private fun entries(n: Int) = (0 until n).map { ResourceEntry("personal", "menus/$it.yaml", "personal") }

    @Test fun `creation reaches quota but another creation is denied`() {
        assertEquals(null, ResourceQuota.assess(10, false, entries(9), "personal", false, listOf("menus/new.yaml")))
        assertEquals("free_quota_reached", ResourceQuota.assess(10, false, entries(10), "personal", false, listOf("menus/new.yaml")))
    }

    @Test fun `over quota only explicit deletion and module changes remain available`() {
        assertEquals("free_quota_exceeded", ResourceQuota.assess(10, false, entries(11), "personal", false, listOf("menus/0.yaml")))
        assertEquals(null, ResourceQuota.assess(10, false, entries(11), "personal", false, deletes = listOf("menus/0.yaml")))
        assertEquals("free_quota_exceeded", ResourceQuota.assess(10, false, entries(11), "personal", false, deletes = listOf("lang/en.yaml")))
        assertEquals(null, ResourceQuota.assess(10, false, entries(11), "addon", true, listOf("menus/other.yaml")))
    }

    @Test fun `whole batch and paid access`() {
        assertEquals("free_quota_reached", ResourceQuota.assess(10, false, entries(9), "personal", false, listOf("menus/a.yaml", "menus/b.yaml")))
        assertEquals(null, ResourceQuota.assess(10, true, entries(249), "personal", false, listOf("menus/new.yaml")))
        assertEquals("free_quota_reached", ResourceQuota.assess(10, true, entries(250), "personal", false, listOf("menus/new.yaml")))
    }
}
