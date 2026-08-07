package net.artisanmc.plugin.command

import net.artisanmc.plugin.lang.LangManager
import org.bukkit.Bukkit
import org.bukkit.Material
import org.bukkit.command.CommandSender
import org.bukkit.entity.Player

object ArgParser {

    fun parse(defs: List<ArgDef>, args: Array<String>, sender: CommandSender, lang: LangManager): Map<String, Any>? {
        val result = mutableMapOf<String, Any>()
        for ((index, def) in defs.withIndex()) {
            val rawValue: String? = when {
                index < args.size && index == defs.lastIndex ->
                    args.drop(index).joinToString(" ")
                index < args.size -> args[index]
                else -> null
            }

            if (rawValue == null) {
                if (def.required) {
                    sender.sendMessage(lang.get("arg.missing", sender, "arg" to def.name))
                    return null
                }
                val default: Any? = when (def) {
                    is ArgDef.StringArg -> def.default
                    is ArgDef.IntArg    -> def.default
                    // The sender IS the default value — bound as the Player itself, so
                    // `{target.name}` and `{target.uuid}` read like an explicit one.
                    is ArgDef.PlayerArg -> if (def.defaultSender) sender as? Player else null
                    else                -> null
                }
                if (default != null) result[def.name] = default
                continue
            }

            val parsed: Any = when (def) {
                is ArgDef.StringArg      -> rawValue
                is ArgDef.IntArg         -> rawValue.toIntOrNull() ?: run {
                    sender.sendMessage(lang.get("arg.not_integer", sender, "arg" to def.name, "value" to rawValue))
                    return null
                }
                is ArgDef.PlayerArg      -> Bukkit.getPlayerExact(rawValue) ?: run {
                    sender.sendMessage(lang.get("arg.player_offline", sender, "value" to rawValue))
                    return null
                }
                is ArgDef.WorldArg       -> Bukkit.getWorld(rawValue) ?: run {
                    sender.sendMessage(lang.get("arg.world_not_loaded", sender, "value" to rawValue))
                    return null
                }
                is ArgDef.ItemMaterialArg -> Material.matchMaterial(rawValue) ?: run {
                    sender.sendMessage(lang.get("arg.unknown_material", sender, "value" to rawValue))
                    return null
                }
                is ArgDef.EnumArg        -> {
                    val match = def.values.firstOrNull { it.equals(rawValue, ignoreCase = true) } ?: run {
                        sender.sendMessage(lang.get("arg.invalid_enum", sender,
                            "arg" to def.name, "value" to rawValue,
                            "values" to def.values.joinToString(", ")))
                        return null
                    }
                    match
                }
            }
            result[def.name] = parsed
        }
        return result
    }

    fun tabComplete(defs: List<ArgDef>, args: Array<String>): List<String> {
        val index = (args.size - 1).coerceAtLeast(0)
        val def = defs.getOrNull(index) ?: return emptyList()
        val prefix = args.lastOrNull() ?: ""
        return when (def) {
            is ArgDef.EnumArg   -> def.values.filter { it.startsWith(prefix, ignoreCase = true) }
            is ArgDef.PlayerArg -> Bukkit.getOnlinePlayers()
                .map { it.name }
                .filter { it.startsWith(prefix, ignoreCase = true) }
            is ArgDef.WorldArg  -> Bukkit.getWorlds()
                .map { it.name }
                .filter { it.startsWith(prefix, ignoreCase = true) }
            is ArgDef.ItemMaterialArg -> Material.entries
                .map { it.name.lowercase() }
                .filter { it.startsWith(prefix, ignoreCase = true) }
            else -> emptyList()
        }
    }
}
