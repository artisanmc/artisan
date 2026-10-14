package net.artisanmc.plugin.hub

/**
 * What each server loaded, read from the suite database (ADR `server-identity-and-versions`,
 * decision 15): the editor opens Projects without asking their server, offline ones included.
 * Null: not recorded, the hub asks the server.
 */
interface LoadedProjects {
    /** The server's `project_list` reply: `{project_ids, project_roots, resource_inventory}`. */
    fun list(server: String): Map<String, Any?>?
    /** A Project's `project_read` reply: `{hash, files, failed, binaries}`. */
    fun read(server: String, folder: String): Map<String, Any?>?
    fun binary(server: String, folder: String, path: String): ByteArray?
}
