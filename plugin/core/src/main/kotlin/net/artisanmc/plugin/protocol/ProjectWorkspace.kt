package net.artisanmc.plugin.protocol

import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.project.ProjectSnapshot
import java.util.concurrent.Executor

/** Les Projects chargés, vus par les gestionnaires du protocole. */
interface ProjectWorkspace {
    val roots: ProjectRoots
    val snapshot: ProjectSnapshot

    /**
     * Toute lecture ou écriture disque d'un Project passe ici : hors du callback
     * WebSocket, et une à la fois, pour qu'aucune écriture ne croise un rechargement.
     */
    val io: Executor

    /**
     * Relit le disque, puis prévient le runtime (commandes, modules). Écrire, c'est
     * savoir qu'on a écrit : sans reprise, l'éditeur ne verrait pas sa propre écriture.
     * [clearDrafts] oublie les aperçus non publiés de l'éditeur.
     */
    fun reload(clearDrafts: Boolean)

    /** Retire le Project du runtime avant de le mettre à la corbeille. */
    fun delete(projectId: String)
}
