package net.artisanmc.plugin

import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.yaml.ProjectReader
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.nio.file.Path

/**
 * **The file structure declares; the content does not describe itself again.**
 *
 * Two redundancies go together:
 * - a Document's inner `id:`, while the file already carries that name;
 * - the manifest `files:` block, which copied the folders' content by hand.
 */
class FilenameIdentityTest {

    private fun project(tmp: Path): File = tmp.resolve("proj").toFile().also { it.mkdirs() }

    private fun write(dir: File, rel: String, content: String) {
        val f = File(dir, rel)
        f.parentFile.mkdirs()
        f.writeText(content)
    }

    private fun read(dir: File) = ProjectReader(ProjectRoots(dir.parentFile), null).readAll()

    @Test
    fun `a menu id comes from its filename`(@TempDir tmp: Path) {
        val p = project(tmp)
        write(p, "manifest.yaml", "schema: manifest/v1\n")
        write(p, "menus/accueil.yaml", "schema: menu/v1\nsize: 27\n")

        val runtime = read(p).single()
        assertEquals(listOf("accueil"), runtime.menus.map { it.id })
    }

    @Test
    fun `un id interne divergent est ignore au profit du fichier`(@TempDir tmp: Path) {
        val p = project(tmp)
        write(p, "manifest.yaml", "schema: manifest/v1\n")
        // Legacy project: the file claims another name.
        write(p, "menus/accueil.yaml", "schema: menu/v1\nid: vieux_nom\nsize: 27\n")

        val runtime = read(p).single()
        assertEquals(listOf("accueil"), runtime.menus.map { it.id })
    }

    @Test
    fun `documents are discovered by scanning, without a files block`(@TempDir tmp: Path) {
        val p = project(tmp)
        // Minimal manifest: no index to maintain by hand.
        write(p, "manifest.yaml", "schema: manifest/v1\ndefault_lang: fr\n")
        write(p, "menus/accueil.yaml", "schema: menu/v1\nsize: 27\n")
        write(p, "menus/boutique.yaml", "schema: menu/v1\nsize: 54\n")
        write(p, "commands/menu.yaml", "schema: command/v1\nopens: accueil\n")
        write(p, "dialogs/confirmer.yaml", "schema: dialog/v1\ntitle: T\n")

        val runtime = read(p).single()
        assertEquals(listOf("accueil", "boutique"), runtime.menus.map { it.id })
        assertEquals(listOf("menu"), runtime.commands.map { it.id })
        assertEquals(listOf("confirmer"), runtime.dialogs.map { it.id })
    }

    @Test
    fun `a legacy files block does not hide what is on disk`(@TempDir tmp: Path) {
        val p = project(tmp)
        // The block is behind: a file added by hand is not listed. The disk is
        // authoritative, otherwise the file would be invisible with nothing to
        // explain why.
        write(p, "manifest.yaml", "schema: manifest/v1\nfiles:\n  menus:\n    - accueil\n")
        write(p, "menus/accueil.yaml", "schema: menu/v1\nsize: 27\n")
        write(p, "menus/oublie.yaml", "schema: menu/v1\nsize: 9\n")

        val runtime = read(p).single()
        assertEquals(listOf("accueil", "oublie"), runtime.menus.map { it.id })
    }

    @Test
    fun `commandes et dialogs suivent la meme regle`(@TempDir tmp: Path) {
        val p = project(tmp)
        write(p, "manifest.yaml", "schema: manifest/v1\n")
        write(p, "commands/boutique.yaml", "schema: command/v1\nid: autre\nopens: x\n")
        write(p, "dialogs/confirmer.yaml", "schema: dialog/v1\nid: autre\ntitle: T\n")

        val runtime = read(p).single()
        assertEquals(listOf("boutique"), runtime.commands.map { it.id })
        assertEquals(listOf("confirmer"), runtime.dialogs.map { it.id })
    }
}
