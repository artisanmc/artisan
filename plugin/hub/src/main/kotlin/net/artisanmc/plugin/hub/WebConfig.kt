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
    /** [HUB] sert l'éditeur ; [LEAF] se relie par [hubUrl] au hub d'un autre serveur. */
    val role: String = HUB,
    /** Nom du serveur dans le réseau ; vide : le nom de son dossier. */
    val name: String = "",
    val hubUrl: String = "",
    /** Secret partagé du réseau ; vide : celui de Velocity, sinon un secret généré par le hub. */
    val secret: String = "",
) {
    val leaf: Boolean get() = role == LEAF

    companion object {
        const val HUB = "hub"
        const val LEAF = "leaf"
    }
}
