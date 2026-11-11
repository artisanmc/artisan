package net.artisanmc.plugin.hub

/**
 * What each server loaded, read from the suite database (ADR `server-identity-and-versions`,
 * decision 15): the editor opens Projects without asking their server, offline ones included.
 * Null: not recorded, the hub asks the server.
 */
interface LoadedProjects {
    /** The server's `project_list` reply: `{project_ids, project_roots, resource_inventory}`. */
    fun list(server: String): Map<String, Any?>?
    /**
     * A Project's `project_read` reply: `{hash, files, failed, binaries}`, plus `pack_images`, the
     * images its Documents ask the pack for (`PackImageRequest` maps), computed by its server at load.
     */
    fun read(server: String, folder: String): Map<String, Any?>?
    /** The Project's Snapshot hash alone: what an `if_hash` poll compares, without the files. */
    fun hash(server: String, folder: String): String? = read(server, folder)?.get("hash") as? String
    fun binary(server: String, folder: String, path: String): ByteArray?
}
