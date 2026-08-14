package net.artisanmc.plugin

import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.yaml.ProjectReader
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.nio.file.Path

/**
 * Le **nom de fichier est l'identité** d'un Document.
 *
 * Le produit y était déjà à moitié : les templates prennent `nameWithoutExtension`
 * quand leur `id` est vide, les data sources et les models n'ont pas de champ
 * `id` du tout. Menus, commandes et dialogs gardaient un `id:` interne — donc
 * deux sources pour une même vérité, qui finissent par se contredire (constaté
 * le 2026-08-14 : `project_id: pack_ac4c8b884658` dans un dossier `projet_test`).
 *
 * Règle unique : le fichier gagne. Un `id:` interne divergent est ignoré, avec un
 * WARN pour que le projet legacy le dise au lieu de le subir.
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
    fun `l'id d'un menu vient du nom de fichier`(@TempDir tmp: Path) {
        val p = project(tmp)
        write(p, "manifest.yaml", "schema: manifest/v1\nfiles:\n  menus:\n    - accueil\n")
        write(p, "menus/accueil.yaml", "schema: menu/v1\nsize: 27\n")

        val bundle = read(p).single()
        assertEquals(listOf("accueil"), bundle.menus.map { it.id })
    }

    @Test
    fun `un id interne divergent est ignore au profit du fichier`(@TempDir tmp: Path) {
        val p = project(tmp)
        write(p, "manifest.yaml", "schema: manifest/v1\nfiles:\n  menus:\n    - accueil\n")
        // Projet legacy : le fichier prétend s'appeler autrement.
        write(p, "menus/accueil.yaml", "schema: menu/v1\nid: vieux_nom\nsize: 27\n")

        val bundle = read(p).single()
        assertEquals(listOf("accueil"), bundle.menus.map { it.id })
    }

    @Test
    fun `commandes et dialogs suivent la meme regle`(@TempDir tmp: Path) {
        val p = project(tmp)
        write(p, "manifest.yaml",
            "schema: manifest/v1\nfiles:\n  commands:\n    - boutique\n  dialogs:\n    - confirmer\n")
        write(p, "commands/boutique.yaml", "schema: command/v1\nid: autre\nopens: x\n")
        write(p, "dialogs/confirmer.yaml", "schema: dialog/v1\nid: autre\ntitle: T\n")

        val bundle = read(p).single()
        assertEquals(listOf("boutique"), bundle.commands.map { it.id })
        assertEquals(listOf("confirmer"), bundle.dialogs.map { it.id })
    }
}
