package net.artisanmc.plugin.project

import net.artisanmc.plugin.sync.BundleHasher
import net.artisanmc.plugin.sync.ProjectFilesReader

/**
 * L'état des Projects tel que lu au dernier chargement, remplacé d'un bloc.
 *
 * [files] : les octets bruts de chaque fichier texte, ce que sert `project_read`
 * et donc ce que l'éditeur affiche — l'état que le serveur exécute, pas le disque
 * courant. Des octets bruts, pas un modèle : le compare-and-swap compare des
 * octets. Un fichier illisible y figure aussi, donc reste réparable.
 *
 * [binaries] : l'empreinte et la taille des binaires, sans leur contenu, lu à la
 * demande (`asset_read`, ADR `assets-on-server-disk`).
 *
 * [skipped] : les Documents qui n'ont pas compilé, et pourquoi.
 */
data class ProjectSnapshot(
    val files: Map<String, Map<String, String>>,
    val binaries: Map<String, Map<String, ProjectFilesReader.BinaryInfo>>,
    val skipped: Map<String, Map<String, String>>,
) {
    val projectIds: List<String> get() = files.keys.sorted()

    /** L'empreinte de `project_read`, comparée par le backend à celle du `hello`. */
    fun hash(projectId: String): String = BundleHasher.snapshotHash(
        files[projectId] ?: emptyMap(),
        (binaries[projectId] ?: emptyMap()).mapValues { it.value.hash },
        skipped[projectId] ?: emptyMap(),
    )

    fun hashes(): List<Map<String, String>> = projectIds.map { mapOf("id" to it, "hash" to hash(it)) }

    fun without(projectId: String) = ProjectSnapshot(files - projectId, binaries - projectId, skipped - projectId)

    companion object {
        val EMPTY = ProjectSnapshot(emptyMap(), emptyMap(), emptyMap())
    }
}
