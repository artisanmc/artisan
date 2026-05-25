package gg.interfaze.modules.api

import org.bukkit.entity.Player

data class CommandDeclaration(
    val name: String,
    val handler: (player: Player, args: Map<String, Any?>) -> Unit,
)
