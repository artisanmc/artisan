package net.artisanmc.plugin

import net.artisanmc.plugin.project.ProjectRoots
import java.io.File
import java.nio.file.Files
import java.util.logging.Handler
import java.util.logging.Level
import java.util.logging.LogRecord
import java.util.logging.Logger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * An Add-on root wins over a core-root directory of the same id, with a warning.
 * A stale core-root copy is not inert: the day the Add-on fails to enable, nothing
 * registers its root and `all()` re-exposes the stale tree as the live project.
 */
class ProjectRootsShadowingTest {

    private fun captureLogger(out: MutableList<String>): Logger =
        Logger.getAnonymousLogger().apply {
            useParentHandlers = false
            addHandler(object : Handler() {
                override fun publish(record: LogRecord) {
                    if (record.level.intValue() >= Level.WARNING.intValue()) out.add(record.message)
                }
                override fun flush() {}
                override fun close() {}
            })
        }

    private fun project(root: File, id: String): File =
        File(root, id).apply { mkdirs(); File(this, "manifest.yaml").writeText("schema: manifest/v1\n") }

    @Test
    fun `registering over a core-root directory of the same id warns`() {
        val core = Files.createTempDirectory("artisan_roots_").toFile()
        project(core, "boutique_shop")
        val addonDir = Files.createTempDirectory("artisan_addon_").toFile()
        val warnings = mutableListOf<String>()

        ProjectRoots(core, captureLogger(warnings)).register("boutique_shop", addonDir)

        assertEquals(1, warnings.size, "expected exactly one warning — got $warnings")
        val w = warnings.single()
        assertTrue("boutique_shop" in w, "warning must name the project: $w")
        assertTrue(core.resolve("boutique_shop").path in w, "warning must name the shadowed dir: $w")
    }

    @Test
    fun `registering a root with no core-root twin is silent`() {
        val core = Files.createTempDirectory("artisan_roots_").toFile()
        val addonDir = Files.createTempDirectory("artisan_addon_").toFile()
        val warnings = mutableListOf<String>()

        ProjectRoots(core, captureLogger(warnings)).register("quests", addonDir)

        assertEquals(emptyList(), warnings)
    }

    @Test
    fun `re-registering the same directory is not a shadowing`() {
        // An Add-on whose root IS its core-root dir (or a re-register on reload)
        // must not cry wolf.
        val core = Files.createTempDirectory("artisan_roots_").toFile()
        val dir = project(core, "same")
        val warnings = mutableListOf<String>()

        ProjectRoots(core, captureLogger(warnings)).register("same", dir)

        assertEquals(emptyList(), warnings)
    }

    @Test
    fun `the registered root still wins the resolution`() {
        val core = Files.createTempDirectory("artisan_roots_").toFile()
        project(core, "boutique_shop")
        val addonDir = Files.createTempDirectory("artisan_addon_").toFile()
        val roots = ProjectRoots(core, captureLogger(mutableListOf()))

        roots.register("boutique_shop", addonDir)

        assertEquals(addonDir, roots.dirFor("boutique_shop"))
        assertEquals(addonDir, roots.all()["boutique_shop"])
    }
}
