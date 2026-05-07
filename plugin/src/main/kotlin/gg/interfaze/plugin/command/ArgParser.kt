package gg.interfaze.plugin.command

import org.bukkit.Bukkit
import org.bukkit.Material
import org.bukkit.command.CommandSender
import org.bukkit.entity.Player

object ArgParser {

    fun parse(defs: List<ArgDef>, args: Array<String>, sender: CommandSender): Map<String, Any>? {
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
                    sender.sendMessage("Missing required argument: <${def.name}>")
                    return null
                }
                val default = when (def) {
                    is ArgDef.StringArg -> def.default
                    is ArgDef.IntArg    -> def.default
                    else                -> null
                }
                if (default != null) result[def.name] = default
                continue
            }

            val parsed: Any = when (def) {
                is ArgDef.StringArg      -> rawValue
                is ArgDef.IntArg         -> rawValue.toIntOrNull() ?: run {
                    sender.sendMessage("Argument <${def.name}> must be a whole number, got: $rawValue")
                    return null
                }
                is ArgDef.PlayerArg      -> Bukkit.getPlayerExact(rawValue) ?: run {
                    sender.sendMessage("Player '$rawValue' is not online.")
                    return null
                }
                is ArgDef.WorldArg       -> Bukkit.getWorld(rawValue) ?: run {
                    sender.sendMessage("World '$rawValue' is not loaded.")
                    return null
                }
                is ArgDef.ItemMaterialArg -> Material.matchMaterial(rawValue) ?: run {
                    sender.sendMessage("Unknown material: $rawValue")
                    return null
                }
                is ArgDef.EnumArg        -> {
                    val match = def.values.firstOrNull { it.equals(rawValue, ignoreCase = true) } ?: run {
                        sender.sendMessage("Invalid value for <${def.name}>: $rawValue. Expected one of: ${def.values.joinToString(", ")}")
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
