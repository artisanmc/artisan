package net.artisanmc.plugin

import net.artisanmc.plugin.HotReloadGuard.Entry
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HotReloadGuardTest {
    private val suite = listOf(
        Entry("Artisan", true, emptySet()),
        Entry("MSQuests", true, setOf("Artisan", "PlaceholderAPI")),
        Entry("ArtisanGuilds", true, setOf("Artisan", "Vault")),
        Entry("ArtisanGuildQuests", true, setOf("MSQuests", "ArtisanGuilds")),
        Entry("ArtisanAuctions", false, setOf("Artisan")),
        Entry("Vault", true, emptySet()),
    )

    @Test
    fun `dependents are transitive, nearest first, and only running plugins`() {
        assertEquals(listOf("MSQuests", "ArtisanGuilds", "ArtisanGuildQuests"), HotReloadGuard.dependents("Artisan", suite))
    }

    @Test
    fun `a plugin used by another names it`() {
        assertEquals(listOf("ArtisanGuildQuests"), HotReloadGuard.dependents("MSQuests", suite))
    }

    @Test
    fun `a leaf has no dependents`() {
        assertEquals(emptyList(), HotReloadGuard.dependents("ArtisanGuildQuests", suite))
    }

    @Test
    fun `names compare without case`() {
        assertEquals(listOf("ArtisanGuildQuests"), HotReloadGuard.dependents("msquests", suite))
    }

    @Test
    fun `a dependency cycle ends`() {
        val cycle = listOf(Entry("A", true, setOf("B")), Entry("B", true, setOf("A")))
        assertEquals(listOf("B"), HotReloadGuard.dependents("A", cycle))
    }

    @Test
    fun `no warning without dependents`() {
        assertNull(HotReloadGuard.reloadedWarning(emptyList()))
        assertNull(HotReloadGuard.disabledWarning("MSQuests", emptyList()))
    }

    @Test
    fun `warnings name the broken plugins`() {
        assertTrue(HotReloadGuard.reloadedWarning(listOf("MSQuests"))!!.contains("MSQuests"))
        assertTrue(HotReloadGuard.disabledWarning("MSQuests", listOf("ArtisanGuildQuests"))!!.contains("ArtisanGuildQuests"))
    }
}
