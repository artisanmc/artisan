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
    private class Entry(val declaration: CommandDeclaration, val moduleId: String?)
    private val commands = ConcurrentHashMap<String, Entry>()

    /** Owner captured for registrations happening right now (cf. [DataSourceRegistry]). */
    @Volatile internal var currentOwner: String? = null

    @Stable
    fun register(decl: CommandDeclaration) {
        if (commands.putIfAbsent(decl.name, Entry(decl, currentOwner)) != null) {
            throw DuplicateCommandException(decl.name)
        }
    }

    /** Removes the command [name]; false if none was registered. Since 1.8.0. */
    @Stable
    fun unregister(name: String): Boolean = commands.remove(name) != null

    internal fun unregisterOwnedBy(moduleId: String) {
        commands.values.removeIf { it.moduleId == moduleId }
    }

    internal fun unregisterLoadedBy(loader: ClassLoader) {
        commands.values.removeIf { it.declaration.handler.javaClass.classLoader === loader }
    }

    @Stable
    fun dispatch(name: String, player: Player, args: Map<String, Any?>) {
        val entry = commands[name] ?: throw UnknownCommandException(name)
        entry.declaration.handler.handle(player, args)
    }

    @Stable
    fun has(name: String): Boolean = commands.containsKey(name)

    @Stable
    fun names(): Set<String> = commands.keys.toSet()
}
