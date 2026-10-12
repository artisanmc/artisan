package net.artisanmc.plugin.scheduling

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

/** Le scheduler Bukkit n'existe pas sur Folia : tout passe par [Scheduler]. */
class SchedulerBoundaryTest {
    private val legacy = Regex("""getScheduler\(\)|server\.scheduler\b|BukkitRunnable|\bisPrimaryThread\b""")

    @Test
    fun `only the Paper adapters touch the Bukkit scheduler`() {
        val offenders = File(".").canonicalFile.walkTopDown()
            .onEnter { it.name != "build" && it.name != "test" && !it.name.startsWith(".") }
            .filter { it.isFile && it.extension == "kt" && it.name != "PaperSchedulers.kt" }
            .filter { file -> file.readLines().any { legacy.containsMatchIn(it.substringBefore("//")) } }
            .map { it.path }
            .toList()
        assertEquals(emptyList(), offenders)
    }
}
