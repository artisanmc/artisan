package net.artisanmc.plugin.protocol

/**
 * Protocol version between a leaf and the hub, sent in `hello`.
 * The major changes when an existing message changes meaning: the hub then refuses to
 * talk to the server. The minor only adds fields, which the other side ignores.
 */
object ProtocolVersion {
    const val CURRENT = "1.3"

    /** Minor that adds `project_create`, `project_delete` and `project_rename`. */
    const val PROJECT_FOLDERS = 1

    /** Minor that adds `editor_bundle_fetch` and the `editor_bundle` of an `installed_modules` entry. */
    const val EDITOR_BUNDLES = 2

    /** Minor that adds `template_fetch`, `template_copy`, `project_origins_fetch` and the `templates` of an `installed_modules` entry. */
    const val TEMPLATES = 3

    fun major(version: String): Int? = version.substringBefore('.').toIntOrNull()

    fun minor(version: String): Int = version.substringAfter('.', "0").substringBefore('.').toIntOrNull() ?: 0

    fun compatible(version: String): Boolean = major(version) == major(CURRENT)
}
