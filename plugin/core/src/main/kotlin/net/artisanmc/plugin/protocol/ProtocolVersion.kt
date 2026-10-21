package net.artisanmc.plugin.protocol

/**
 * Protocol version between a leaf and the hub, sent in `hello`.
 * The major changes when an existing message changes meaning: the hub then refuses to
 * talk to the server. The minor only adds fields, which the other side ignores.
 */
object ProtocolVersion {
    const val CURRENT = "1.2"

    /** Minor that adds `project_create`, `project_delete` and `project_rename`. */
    const val PROJECT_FOLDERS = 1

    /** Minor that adds `bedrock_pack_updated` and `bedrock_pack` in `hello_ack`. */
    const val BEDROCK_PACK = 2

    fun major(version: String): Int? = version.substringBefore('.').toIntOrNull()

    fun minor(version: String): Int = version.substringAfter('.', "0").substringBefore('.').toIntOrNull() ?: 0

    fun compatible(version: String): Boolean = major(version) == major(CURRENT)
}
