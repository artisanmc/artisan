package net.artisanmc.plugin

import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.yaml.ProjectReader
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.nio.file.Path

/**
 * **La structure de fichiers déclare, le contenu ne se redécrit pas.**
 *
 * Deux redondances tombent ensemble :
 * - l'`id:` interne d'un Document, alors que le fichier porte déjà ce nom ;
 * - le bloc `files:` du manifest, qui recopiait à la main le contenu des dossiers.
 *
 * Le produit y était déjà à moitié : un template prend son `nameWithoutExtension`
 * quand son `id` est vide, et data sources comme models sont découverts par scan,
 * sans index ni champ `id`.
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
        write(p, "manifest.yaml", "schema: manifest/v1\n")
        write(p, "menus/accueil.yaml", "schema: menu/v1\nsize: 27\n")

        val bundle = read(p).single()
        assertEquals(listOf("accueil"), bundle.menus.map { it.id })
    }

    @Test
    fun `un id interne divergent est ignore au profit du fichier`(@TempDir tmp: Path) {
        val p = project(tmp)
        write(p, "manifest.yaml", "schema: manifest/v1\n")
        // Projet legacy : le fichier prétend s'appeler autrement.
        write(p, "menus/accueil.yaml", "schema: menu/v1\nid: vieux_nom\nsize: 27\n")

        val bundle = read(p).single()
        assertEquals(listOf("accueil"), bundle.menus.map { it.id })
    }

    @Test
    fun `les documents sont decouverts par scan, sans bloc files`(@TempDir tmp: Path) {
        val p = project(tmp)
        // Manifest minimal : plus d'index à tenir à jour à la main.
        write(p, "manifest.yaml", "schema: manifest/v1\ndefault_lang: fr\n")
        write(p, "menus/accueil.yaml", "schema: menu/v1\nsize: 27\n")
        write(p, "menus/boutique.yaml", "schema: menu/v1\nsize: 54\n")
        write(p, "commands/menu.yaml", "schema: command/v1\nopens: accueil\n")
        write(p, "dialogs/confirmer.yaml", "schema: dialog/v1\ntitle: T\n")

        val bundle = read(p).single()
        assertEquals(listOf("accueil", "boutique"), bundle.menus.map { it.id })
        assertEquals(listOf("menu"), bundle.commands.map { it.id })
        assertEquals(listOf("confirmer"), bundle.dialogs.map { it.id })
    }

    @Test
    fun `un bloc files legacy n'ampute pas ce qui est sur le disque`(@TempDir tmp: Path) {
        val p = project(tmp)
        // Le bloc a pris du retard : un fichier ajouté à la main n'y figure pas.
        // C'est le disque qui fait foi, sinon le fichier serait invisible sans
        // que rien ne l'explique — le piège que ce bloc tendait.
        write(p, "manifest.yaml", "schema: manifest/v1\nfiles:\n  menus:\n    - accueil\n")
        write(p, "menus/accueil.yaml", "schema: menu/v1\nsize: 27\n")
        write(p, "menus/oublie.yaml", "schema: menu/v1\nsize: 9\n")

        val bundle = read(p).single()
        assertEquals(listOf("accueil", "oublie"), bundle.menus.map { it.id })
    }

    @Test
    fun `commandes et dialogs suivent la meme regle`(@TempDir tmp: Path) {
        val p = project(tmp)
        write(p, "manifest.yaml", "schema: manifest/v1\n")
        write(p, "commands/boutique.yaml", "schema: command/v1\nid: autre\nopens: x\n")
        write(p, "dialogs/confirmer.yaml", "schema: dialog/v1\nid: autre\ntitle: T\n")

        val bundle = read(p).single()
        assertEquals(listOf("boutique"), bundle.commands.map { it.id })
        assertEquals(listOf("confirmer"), bundle.dialogs.map { it.id })
    }
}
