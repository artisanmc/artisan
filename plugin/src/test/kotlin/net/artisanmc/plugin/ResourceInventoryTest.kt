package net.artisanmc.plugin

import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.project.ResourceInventory
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File

class ResourceInventoryTest {
    @TempDir lateinit var temp: File

    @Test fun `counts editable roots on disk even when YAML is invalid`() {
        val core = File(temp, "projects").also { it.mkdirs() }
        val personal = File(core, "personal").also { it.mkdirs() }
        File(personal, "menus/nested/broken.yaml").also { it.parentFile.mkdirs(); it.writeText("{{ invalid") }
        File(personal, "commands/root.yml").also { it.parentFile.mkdirs(); it.writeText("invalid") }
        File(personal, "lang/en.yaml").also { it.parentFile.mkdirs(); it.writeText("x") }
        val addon = File(temp, "addon").also { it.mkdirs() }
        File(addon, "dialogs/sample.yaml").also { it.parentFile.mkdirs(); it.writeText("invalid") }
        val roots = ProjectRoots(core)
        roots.register("addon_project", addon)

        val inventory = ResourceInventory.scan(roots)

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

        val inventory = ResourceInventory.scan(roots)

        assertEquals(1, inventory.size)
        assertEquals("module", inventory.single().origin)
    }
}
