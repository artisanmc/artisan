package net.artisanmc.plugin

import net.artisanmc.plugin.project.ProjectFilesReader
import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.project.ProjectSnapshot
import net.artisanmc.plugin.project.ResourceInventory
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File

class ResourceInventoryTest {
    @TempDir lateinit var temp: File

    /** What a reload loads: the texts of every Project `roots` lists. */
    private fun loaded(roots: ProjectRoots) = ProjectSnapshot(
        files = roots.all().mapValues { (_, dir) -> ProjectFilesReader.readAll(dir) },
        binaries = emptyMap(), skipped = emptyMap(),
    )

    @Test fun `counts editable roots even when YAML is invalid`() {
        val core = File(temp, "projects").also { it.mkdirs() }
        val personal = File(core, "personal").also { it.mkdirs() }
        File(personal, "menus/nested/broken.yaml").also { it.parentFile.mkdirs(); it.writeText("{{ invalid") }
        File(personal, "commands/root.yml").also { it.parentFile.mkdirs(); it.writeText("invalid") }
        File(personal, "lang/en.yaml").also { it.parentFile.mkdirs(); it.writeText("x") }
        val addon = File(temp, "addon").also { it.mkdirs() }
        File(addon, "dialogs/sample.yaml").also { it.parentFile.mkdirs(); it.writeText("invalid") }
        val roots = ProjectRoots(core)
        roots.register("addon_project", addon)

        val inventory = ResourceInventory.of(loaded(roots), roots)

        assertEquals(2, inventory.count { it.origin == "personal" })
        assertEquals(1, inventory.count { it.origin == "module" })
    }

    @Test fun `does not count a core copy shadowed by a registered module`() {
        val core = File(temp, "projects").also { it.mkdirs() }
        File(core, "addon_project/menus/stale.yaml").also { it.parentFile.mkdirs(); it.writeText("x") }
        val addon = File(temp, "addon").also { it.mkdirs() }
        File(addon, "menus/live.yaml").also { it.parentFile.mkdirs(); it.writeText("x") }
        val roots = ProjectRoots(core)
        roots.register("addon_project", addon)

        val inventory = ResourceInventory.of(loaded(roots), roots)

        assertEquals(1, inventory.size)
        assertEquals("module", inventory.single().origin)
    }

    @Test fun `the inventory comes from the snapshot, not the disk`() {
        val core = File(temp, "projects").also { it.mkdirs() }
        File(core, "personal/menus/a.yaml").also { it.parentFile.mkdirs(); it.writeText("x") }
        val roots = ProjectRoots(core)
        val snapshot = loaded(roots)
        File(core, "personal/menus/b.yaml").writeText("x")
        assertEquals(listOf("menus/a.yaml"), ResourceInventory.of(snapshot, roots).map { it.path })
    }
}
