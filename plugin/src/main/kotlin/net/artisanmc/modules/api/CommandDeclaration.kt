package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Stable
import org.bukkit.entity.Player

@Stable
data class CommandDeclaration(
    val name: String,
    val handler: (player: Player, args: Map<String, Any?>) -> Unit,
)
