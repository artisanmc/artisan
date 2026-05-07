package gg.interfaze.plugin.command

import gg.interfaze.plugin.engine.ClickHandler

data class CompiledCommand(
    val name: String,
    val aliases: List<String>,
    val permission: String?,
    val description: String,
    val argDefs: List<ArgDef>,
    val handler: ClickHandler,
)
