package net.artisanmc.plugin

import net.artisanmc.plugin.lang.ShippedLang
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.nio.file.Path
import java.util.logging.Logger

/**
 * An add-on's messages kept in its module's folder: in a folder that holds its whole tree (ADR
 * `editable-module-tree`), `lang/<code>.yml` itself, merged key by key at each update; in a
 * folder still in the former layout, their defaults in `originals/lang/`.
 */
class ShippedLangTest {
    private val logger = Logger.getLogger("test")

    @Test
    fun `writes each bundled language at its own path, then follows the module where the owner did not write`(@TempDir tmp: Path) {
        val folder = tmp.toFile()
        val v1 = "reminder: Your reward waits\nclaimed: Claimed\n".toByteArray()
        assertEquals(listOf("lang/en.yml"), ShippedLang.write(folder, mapOf("en" to v1, "de" to null), logger, "rewards"))
        assertEquals(String(v1), File(folder, "lang/en.yml").readText())
        assertEquals(emptyList<String>(), ShippedLang.write(folder, mapOf("en" to v1), logger, "rewards"))

        val v2 = "reminder: Come back\nclaimed: Claimed\n".toByteArray()
        assertEquals(listOf("lang/en.yml"), ShippedLang.write(folder, mapOf("en" to v2), logger, "rewards"), "untouched: follows")
        assertEquals(String(v2), File(folder, "lang/en.yml").readText())

        File(folder, "lang/en.yml").writeText("reminder: Come back\nclaimed: Done!\n")
        val v3 = "reminder: Come back soon\nclaimed: Claimed\nstreak: Streak\n".toByteArray()
        ShippedLang.write(folder, mapOf("en" to v3), logger, "rewards")
        val merged = File(folder, "lang/en.yml").readText()
        assertEquals(true, "reminder: Come back soon" in merged, merged)
        assertEquals(true, "claimed: Done!" in merged, merged)
        assertEquals(true, "streak: Streak" in merged, merged)
    }

    @Test
    fun `leaves a file another template ships`(@TempDir tmp: Path) {
        val folder = tmp.toFile()
        File(folder, "artisan-shipped.yml").writeText(
            "files:\n  lang/en.yml: { module: guilds, template: main, version: 1, hash: abc }\n",
        )
        File(folder, "lang").mkdirs()
        File(folder, "lang/en.yml").writeText("a: mine\n")
        assertEquals(emptyList<String>(), ShippedLang.write(folder, mapOf("en" to "a: b\n".toByteArray()), logger, "guilds"))
        assertEquals("a: mine\n", File(folder, "lang/en.yml").readText())
    }

    @Test
    fun `former layout - writes each bundled language once under originals, again only when it changed`(@TempDir tmp: Path) {
        val folder = tmp.toFile()
        File(folder, "originals").mkdirs()
        val en = "reminder: Your reward waits\n".toByteArray()
        assertEquals(listOf("originals/lang/en.yml"), ShippedLang.write(folder, mapOf("en" to en, "de" to null), logger))
        assertEquals("reminder: Your reward waits\n", File(folder, "originals/lang/en.yml").readText())
        assertEquals(emptyList<String>(), ShippedLang.write(folder, mapOf("en" to en), logger))
        val changed = "reminder: Come back\n".toByteArray()
        assertEquals(listOf("originals/lang/en.yml"), ShippedLang.write(folder, mapOf("en" to changed), logger))
        assertEquals("reminder: Come back\n", File(folder, "originals/lang/en.yml").readText())
    }

    @Test
    fun `former layout - leaves a file a template ships`(@TempDir tmp: Path) {
        val folder = tmp.toFile()
        File(folder, "originals").mkdirs()
        File(folder, ".artisan").mkdirs()
        File(folder, ".artisan/origins.yaml").writeText(
            "files:\n  originals/lang/en.yml: { module: guilds, template: main, version: 1, hash: abc }\n",
        )
        assertEquals(emptyList<String>(), ShippedLang.write(folder, mapOf("en" to "a: b\n".toByteArray()), logger))
    }
}
