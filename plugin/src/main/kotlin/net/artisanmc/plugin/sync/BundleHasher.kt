package net.artisanmc.plugin.sync

import java.io.File
import java.security.MessageDigest

/**
 * Hachage de contenu — deux usages, tous deux **locaux au plugin**.
 *
 * - [hash] / [hashFiles] : empreinte d'un arbre de fichiers, utilisée par le
 *   `SyncScanner` pour repérer qu'un dossier a changé entre deux ticks.
 * - [hashContent] : empreinte d'un **contenu de fichier**, jeton de
 *   compare-and-swap de `project_write`. L'éditeur la reproduit en TypeScript
 *   (`lib/contentHash.ts`) — SHA-256 de l'UTF-8, hex minuscule.
 *
 * Le hash d'arbre fut un invariant inter-langage : il devait rester
 * byte-identique au `computeBundleHash` du backend, sous peine d'inventer des
 * divergences, et un vecteur partagé le verrouillait. Cette contrainte est
 * tombée avec le stockage backend (ADR `server-disk-only-storage`) : plus
 * personne d'autre ne calcule ce hash, donc il n'y a plus rien à accorder.
 */
object BundleHasher {

    /**
     * Hash d'une map relPath → contenu : clés triées en ordre d'octets (`String`
     * compare de Kotlin, JAMAIS locale-aware), chaque entrée émise en
     * `<relPath>` + LF + contenu + LF, concaténée, SHA-256 hex minuscule. Map
     * vide => "" (sentinelle « pas de contenu »).
     */
    fun hashFiles(relFiles: Map<String, String>): String {
        if (relFiles.isEmpty()) return ""
        val sb = StringBuilder()
        for (key in relFiles.keys.sorted()) {
            sb.append(key).append('\n').append(relFiles.getValue(key)).append('\n')
        }
        return sha256(sb.toString())
    }

    /** Hash d'un dossier de project (relPath-keyed, `.artisan*` exclus). */
    fun hash(projectDir: File): String = hashFiles(ProjectFilesReader.readRelative(projectDir))

    /**
     * Hash d'un **contenu de fichier** seul — le jeton de compare-and-swap de
     * `project_write`. Pas de clé, pas de tri, juste le contenu.
     */
    fun hashContent(content: String): String = sha256(content)

    /**
     * Même jeton, pour un contenu **binaire** (ADR `assets-on-server-disk`).
     * SHA-256 des octets bruts : passer par une String les corromprait.
     */
    fun hashBytes(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    /**
     * Un premier segment commençant par `.artisan` est une métadonnée (état
     * éditeur, corbeille) : hors hash, et invisible au scan de contenu.
     */
    fun isArtisanMeta(relPath: String): Boolean =
        relPath.substringBefore('/').startsWith(".artisan")

    private fun sha256(input: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
