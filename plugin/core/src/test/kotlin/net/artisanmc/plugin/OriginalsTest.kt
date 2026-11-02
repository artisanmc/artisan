package net.artisanmc.plugin

import net.artisanmc.plugin.engine.RuntimeMenu
import net.artisanmc.plugin.model.DocumentKinds
import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.protocol.EditorPaths
import net.artisanmc.plugin.yaml.ProjectReader
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.nio.file.Path

/** A module's originals (design `originaux-modules`): what the engine reads, and who may write them. */
class OriginalsTest {

    private fun write(dir: File, rel: String, content: String) {
        File(dir, rel).also { it.parentFile.mkdirs() }.writeText(content)
    }

    private fun module(tmp: Path): File = tmp.resolve("guilds").toFile().also {
        write(it, "artisan-module.yml", "schema: module/v1\n")
        write(it, "originals/originals.yml", "module: guilds\nversion: 1\nrequired: [menus/main.yml]\n")
        write(it, "originals/menus/main.yml", "schema: menu/v1\nsize: 27\ntitle: Main\n")
        write(it, "originals/menus/ranks.yml", "schema: menu/v1\nsize: 27\ntitle: Ranks\n")
        write(it, "originals/menus/top.yml", "schema: menu/v1\nsize: 27\ntitle: Top\n")
    }

    private fun read(dir: File, skipped: MutableList<String> = mutableListOf()) =
        ProjectReader(ProjectRoots(dir.parentFile), null, { emptyMap() }) { _, path, reason -> skipped += "$path: $reason" }
            .readAll().single()

    private fun title(p: net.artisanmc.plugin.engine.RuntimeProject, id: String) = p.menus.first { it.id == id }.yaml.title

    @Test
    fun `originals are read, the owner's file wins, an exclusion removes one`(@TempDir tmp: Path) {
        val m = module(tmp)
        write(m, "rangs/menus/ranks.yml", "schema: menu/v1\nsize: 27\ntitle: Mine\n")
        write(m, "artisan-module.yml", "schema: module/v1\noriginals:\n  exclude: [menus/top.yaml]\n")
        val p = read(m)
        assertEquals(listOf("main", "ranks"), p.menus.map { it.id })
        assertEquals("Main", title(p, "main"))
        assertEquals("Mine", title(p, "ranks"))
    }

    @Test
    fun `a required original cannot be excluded`(@TempDir tmp: Path) {
        val m = module(tmp)
        write(m, "artisan-module.yml", "schema: module/v1\noriginals:\n  exclude: [menus/main.yml]\n")
        val skipped = mutableListOf<String>()
        val p = read(m, skipped)
        assertTrue("main" in p.menus.map { it.id })
        assertEquals(listOf("artisan-module.yml: originals_required: menus/main.yml"), skipped)
    }

    @Test
    fun `the module's variants and rules come from originals, the owner's rules win`(@TempDir tmp: Path) {
        val m = module(tmp)
        write(m, "originals/variants.yml", "schema: variants/v1\nrules:\n  - variant: textured\n")
        write(m, "originals/variants/textured/menus/main.yml", "schema: menu/v1\nsize: 27\ntitle: Main T\n")
        write(m, "variants/textured/menus/ranks.yml", "schema: menu/v1\nsize: 27\ntitle: Ranks mine\n")
        var p = read(m)
        assertEquals("Main T", (p.variantDocument("textured", DocumentKinds.MENU.kind, "main") as RuntimeMenu).yaml.title)
        assertEquals("Ranks mine", (p.variantDocument("textured", DocumentKinds.MENU.kind, "ranks") as RuntimeMenu).yaml.title)
        assertEquals(listOf("textured"), p.variantRules.map { it.variant })

        write(m, "variants.yml", "schema: variants/v1\nrules:\n  - variant: textured\n    enabled: false\n")
        p = read(m)
        assertEquals(false, p.variantRules.single().enabled)
    }

    @Test
    fun `the editor reads originals but never writes them`() {
        assertFalse(EditorPaths.isWritable("originals/menus/main.yml"))
        assertTrue(EditorPaths.isReadable("originals/menus/main.yml"))
        assertTrue(EditorPaths.isWritable("menus/main.yml"))
    }
}
