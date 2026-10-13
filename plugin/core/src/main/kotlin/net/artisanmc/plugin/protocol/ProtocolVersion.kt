package net.artisanmc.plugin.protocol

/**
 * Version du protocole entre une feuille et le hub, envoyée au `hello`.
 * La majeure change quand un message existant change de sens : le hub refuse alors de
 * parler au serveur. La mineure ne fait qu'ajouter des champs, que l'autre côté ignore.
 */
object ProtocolVersion {
    const val CURRENT = "1.1"

    /** Mineure qui ajoute `project_create`, `project_delete` et `project_rename`. */
    const val PROJECT_FOLDERS = 1

    fun major(version: String): Int? = version.substringBefore('.').toIntOrNull()

    fun minor(version: String): Int = version.substringAfter('.', "0").substringBefore('.').toIntOrNull() ?: 0

    fun compatible(version: String): Boolean = major(version) == major(CURRENT)
}
