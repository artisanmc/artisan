package net.artisanmc.plugin.sync

import java.io.File

object ProjectFilesReader {

    /** Ce qu'on sait d'un binaire sans le porter : son empreinte et sa taille. */
    data class BinaryInfo(val hash: String, val size: Long)

    /**
     * Extensions transportées comme **octets**, jamais comme texte.
     *
     * Les lire en UTF-8 les mutilerait (un PNG commence par 0x89, qui n'est pas
     * de l'UTF-8 valide), et les faire voyager dans l'arbre de `project_read`
     * enflerait chaque ouverture de Project — ADR `assets-on-server-disk`.
     */
    private val BINARY_EXTENSIONS = setOf("png", "zip", "jpg", "jpeg", "ogg", "ttf", "otf")

    fun isBinary(relPath: String): Boolean =
        relPath.substringAfterLast('.', "").lowercase() in BINARY_EXTENSIONS

    /** relPath → empreinte + taille des binaires, `.artisan*` exclus. */
    fun binaries(projectDir: File): Map<String, BinaryInfo> {
        val out = mutableMapOf<String, BinaryInfo>()
        projectDir.walkTopDown()
            .filter { it.isFile }
            .forEach { file ->
                val rel = file.relativeTo(projectDir).path.replace('\\', '/')
                if (isBinary(rel) && !BundleHasher.isArtisanMeta(rel)) {
                    out[rel] = BinaryInfo(BundleHasher.hashBytes(file.readBytes()), file.length())
                }
            }
        return out
    }

    /** Tous les chemins réellement présents — texte ET binaires. */
    fun allPaths(projectDir: File): List<String> =
        (readAll(projectDir).keys + binaries(projectDir).keys).sorted()

    /**
     * The single project-dir walk. relPath-keyed map (forward slashes), holding
     * every **text** file on disk — `.artisan*` metadata included. Every other
     * text reader derives from this one; no second traversal.
     */
    fun readAll(projectDir: File): Map<String, String> {
        val out = mutableMapOf<String, String>()
        projectDir.walkTopDown()
            .filter { it.isFile }
            .forEach { file ->
                val rel = file.relativeTo(projectDir).path.replace('\\', '/')
                // Exclus par construction : un PNG lu en UTF-8 revient mutilé.
                if (!isBinary(rel)) out[rel] = file.readText(Charsets.UTF_8)
            }
        return out
    }

    /**
     * relPath-keyed map excluding `.artisan*` sync metadata. Both the hash
     * (`BundleHasher`) and the wire forms (`read`, below) derive from this —
     * a `.artisan*` first segment is out of the hash and never uploaded (the
     * backend preserves its copies).
     */
    fun readRelative(projectDir: File): Map<String, String> =
        readAll(projectDir).filterKeys { !BundleHasher.isArtisanMeta(it) }

    /**
     * Canonical files map keyed by "plugins/Artisan/projects/<projectId>/<relPath>"
     * (the form the backend stores). Thin re-key over [readRelative].
     */
    fun read(projectDir: File, projectId: String): Map<String, String> {
        val prefix = "plugins/Artisan/projects/$projectId/"
        return readRelative(projectDir).mapKeys { (rel, _) -> "$prefix$rel" }
    }
}
