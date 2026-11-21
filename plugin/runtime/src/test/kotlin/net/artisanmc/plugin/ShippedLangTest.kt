package net.artisanmc.plugin

import net.artisanmc.plugin.lang.ShippedLang
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.nio.file.Path
import java.util.logging.Logger

/** An add-on's messages kept in its module's folder: their defaults in `originals/lang/`, for the editor. */
class ShippedLangTest {
    private val logger = Logger.getLogger("test")

    @Test
    fun `writes each bundled language once, again only when it changed`(@TempDir tmp: Path) {
        val folder = tmp.toFile()
        val en = "reminder: Your reward waits\n".toByteArray()
        assertEquals(listOf("originals/lang/en.yml"), ShippedLang.write(folder, mapOf("en" to en, "de" to null), logger))
        assertEquals("reminder: Your reward waits\n", File(folder, "originals/lang/en.yml").readText())
        assertEquals(emptyList<String>(), ShippedLang.write(folder, mapOf("en" to en), logger))
        val changed = "reminder: Come back\n".toByteArray()
        assertEquals(listOf("originals/lang/en.yml"), ShippedLang.write(folder, mapOf("en" to changed), logger))
        assertEquals("reminder: Come back\n", File(folder, "originals/lang/en.yml").readText())
    }

    @Test
    fun `leaves a file a template ships`(@TempDir tmp: Path) {
        val folder = tmp.toFile()
        File(folder, ".artisan").mkdirs()
        File(folder, ".artisan/origins.yaml").writeText(
            "files:\n  originals/lang/en.yml: { module: guilds, template: main, version: 1, hash: abc }\n",
        )
        assertEquals(emptyList<String>(), ShippedLang.write(folder, mapOf("en" to "a: b\n".toByteArray()), logger))
    }
}
