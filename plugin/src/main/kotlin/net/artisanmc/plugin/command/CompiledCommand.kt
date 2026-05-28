package net.artisanmc.plugin.command

import net.artisanmc.plugin.engine.ClickHandler

data class CompiledCommand(
    val name: String,
    val aliases: List<String>,
    val permission: String?,
    val description: String,
    val argDefs: List<ArgDef>,
    val handler: ClickHandler,
)
