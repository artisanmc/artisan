package gg.interfaze.plugin.engine

import org.bukkit.entity.Player

data class ExecutionContext(
    val player: Player,
    val args: Map<String, Any> = emptyMap(),
    val lang: String = "en",
    val langMap: Map<String, String> = emptyMap(),
)
