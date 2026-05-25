package gg.interfaze.modules.api

import org.bukkit.entity.Player
import java.util.concurrent.ConcurrentHashMap

class UnknownCommandException(name: String) :
    RuntimeException("No command registered with name '$name'")

class DuplicateCommandException(name: String) :
    IllegalStateException("Command '$name' is already registered")

class CommandRegistry {
    private val commands = ConcurrentHashMap<String, CommandDeclaration>()

    fun register(decl: CommandDeclaration) {
        if (commands.putIfAbsent(decl.name, decl) != null) {
            throw DuplicateCommandException(decl.name)
        }
    }

    fun dispatch(name: String, player: Player, args: Map<String, Any?>) {
        val decl = commands[name] ?: throw UnknownCommandException(name)
        decl.handler(player, args)
    }

    fun has(name: String): Boolean = commands.containsKey(name)

    fun names(): Set<String> = commands.keys.toSet()
}
