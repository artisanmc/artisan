package gg.interfaze.modules.api

import gg.interfaze.modules.api.annotations.Stable
import org.bukkit.entity.Player

@Stable
data class CommandDeclaration(
    val name: String,
    val handler: (player: Player, args: Map<String, Any?>) -> Unit,
)
