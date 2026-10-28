package net.artisanmc.plugin.hub

/**
 * Versions of server Projects, read from the suite database (ADR `server-identity-and-versions`),
 * in the shapes the editor reads. [server] is a server id of [Servers]; null: no such Project.
 */
interface ProjectHistory {
    /** `{id, hash, createdAt, author, changed}`, newest first. */
    fun versions(server: String, folder: String): List<Map<String, Any?>>?
    /** `{id, createdAt, previousId, files: [{path, content}], binaries: [{path, hash, size}]}`. */
    fun version(server: String, folder: String, id: String): Map<String, Any?>?
    /** The bytes of a binary file of a Version. */
    fun versionBinary(server: String, folder: String, id: String, path: String): ByteArray?
    /** `{at, content, author}` for each Version where the file changed, newest first. */
    fun fileHistory(server: String, folder: String, path: String): List<Map<String, Any?>>?
}
