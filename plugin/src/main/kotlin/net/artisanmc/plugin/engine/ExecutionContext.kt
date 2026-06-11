package net.artisanmc.plugin.engine

import org.bukkit.entity.Player

/** Page courante + nombre de pages d'un élément itérant, calculés au rendu. */
data class PageInfo(val page: Int, val pageCount: Int)

data class ExecutionContext(
    val player: Player,
    val args: Map<String, Any> = emptyMap(),
    val lang: String = "en",
    val langMap: Map<String, String> = emptyMap(),
    /** Pages demandées par élément itérant (elementId → page). Écrit par pagination_next/prev. */
    val pagination: Map<String, Int> = emptyMap(),
    /** Snapshot du dernier rendu (clamps + pageCount). Lu par les conditions pagination_at_*. */
    val pageInfo: Map<String, PageInfo> = emptyMap(),
)
