package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Stable
import org.bukkit.entity.Player
import java.util.concurrent.ConcurrentHashMap

@Stable
class UnknownCommandException(name: String) :
    RuntimeException("No command registered with name '$name'")

@Stable
class DuplicateCommandException(name: String) :
    IllegalStateException("Command '$name' is already registered")

@Stable
class CommandRegistry {
    private val commands = ConcurrentHashMap<String, CommandDeclaration>()

    @Stable
    fun register(decl: CommandDeclaration) {
        if (commands.putIfAbsent(decl.name, decl) != null) {
            throw DuplicateCommandException(decl.name)
        }
    }

    @Stable
    fun dispatch(name: String, player: Player, args: Map<String, Any?>) {
        val decl = commands[name] ?: throw UnknownCommandException(name)
        decl.handler.handle(player, args)
    }

    @Stable
    fun has(name: String): Boolean = commands.containsKey(name)

    @Stable
    fun names(): Set<String> = commands.keys.toSet()
}
