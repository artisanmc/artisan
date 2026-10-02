package net.artisanmc.plugin.engine

import org.bukkit.entity.Player

/** Page courante + nombre de pages d'un élément itérant, calculés au rendu. */
data class PageInfo(val page: Int, val pageCount: Int)

data class ExecutionContext(
    val player: Player,
    val args: Map<String, Any> = emptyMap(),
    val lang: String = "en",
    /** Project default language — fallback for field-local maps ([LocalizedText]). */
    val defaultLang: String = "en",
    val langMap: Map<String, String> = emptyMap(),
    /** Pages demandées par élément itérant (elementId → page). Écrit par pagination_next/prev. */
    val pagination: Map<String, Int> = emptyMap(),
    /** Snapshot du dernier rendu (clamps + pageCount). Lu par les conditions pagination_at_*. */
    val pageInfo: Map<String, PageInfo> = emptyMap(),
    /** Profondeur d'appels `run_actions` imbriqués — garde anti-cycle (max 16). */
    val runActionsDepth: Int = 0,
    /** Values fetched by the renderer, retained locally but not inherited by another menu. */
    val sourceArgs: Map<String, Any> = emptyMap(),
    /**
     * Le project du Document dont viennent les actions (menu cliqué, commande,
     * dialog). Un `open_menu` / `open_dialog` à id nu s'y résout d'abord.
     * `null` = pas de project (API, `/artisan menu`) : résolution sur le serveur.
     */
    val projectId: String? = null,
) {
    val navigationArgs: Map<String, Any>
        get() = args.filter { (name, value) -> name !in sourceArgs || value !== sourceArgs[name] }

    /**
     * Args + built-ins implicites : `player` = joueur courant (jamais écrasé
     * si l'appelant a bindé un arg du même nom). Toute résolution de texte
     * passe par ici, pas par `args` directement.
     */
    val resolvedArgs: Map<String, Any>
        get() = if ("player" in args) args else args + ("player" to player)
}
