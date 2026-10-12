package net.artisanmc.plugin.hub

/**
 * Section `web` d'environment.yml. [bind] vide : toutes les interfaces. [url] vide : les
 * liens de connexion visent l'adresse par laquelle le joueur a rejoint le serveur.
 */
data class WebConfig(
    val enabled: Boolean = true,
    val port: Int = 8765,
    val bind: String = "",
    val url: String = "",
)
