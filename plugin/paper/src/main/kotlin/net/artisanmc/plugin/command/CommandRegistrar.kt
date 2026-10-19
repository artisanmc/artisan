package net.artisanmc.plugin.command

import net.artisanmc.plugin.engine.ActionExecutor
import net.artisanmc.plugin.engine.ConditionEvaluator
import net.artisanmc.plugin.lang.LangManager
import net.artisanmc.plugin.engine.RuntimeProject
import net.artisanmc.plugin.scheduling.Scheduler
import org.bukkit.Bukkit
import org.bukkit.command.Command
import org.bukkit.command.PluginIdentifiableCommand
import org.bukkit.plugin.java.JavaPlugin
import java.util.logging.Logger

/**
 * A label (command name or alias) claimed twice. [owner] keeps it; [loser] is the
 * project command that does not get it. [owner] names another project
 * (`project <id>, command <doc>`) or, for a command Artisan does not own, its plugin.
 */
data class CommandConflict(
    val label: String,
    val owner: String,
    val loser: String,
    val isAlias: Boolean,
)

/**
 * Registers the `command/v1` documents of every project in the command map.
 *
 * A label belongs to one command on the server. Between two projects, the first in
 * project order keeps it and the conflict is logged as an error naming both; the
 * other command loses that label only (an alias) or is not registered (its name).
 * Against a command of another plugin, the project command stays reachable as
 * `/artisan:<name>`. Every conflict of the last reload is in [conflicts].
 */
class CommandRegistrar(
    private val plugin: JavaPlugin,
    private val lang: LangManager,
    private val scheduler: Scheduler,
) {
    private val logger: Logger get() = plugin.logger
    private val namespace get() = plugin.name.lowercase()
    private val registered = mutableListOf<Command>()
    /** The command map keys pointing at [registered] after the last reload. */
    private var registeredLabels: Set<String> = emptySet()

    @Volatile
    var conflicts: List<CommandConflict> = emptyList()
        private set

    fun reload(runtimes: List<RuntimeProject>, executor: ActionExecutor, evaluator: ConditionEvaluator) {
        val previousLabels = registeredLabels
        unregisterAll()
        val commandMap = Bukkit.getCommandMap()
        /** label → `project <id>, command <doc>` for every label claimed this reload. */
        val claimed = mutableMapOf<String, String>()
        val found = mutableListOf<CommandConflict>()

        for (runtime in runtimes) {
            for (cmdYaml in runtime.commands) {
                val name = cmdYaml.name.ifEmpty { cmdYaml.id }.lowercase()
                val source = "project ${runtime.projectId}, command ${cmdYaml.id.ifEmpty { name }}"

                val nameOwner = claimed[name]
                if (nameOwner != null) {
                    found += CommandConflict(name, nameOwner, source, isAlias = false)
                    logger.severe("Command '/$name' ($source) is not registered: '/$name' is already taken by $nameOwner. Rename one of them.")
                    continue
                }

                val compiled = CommandCompiler.compile(cmdYaml, logger) ?: continue

                foreignOwner(commandMap.getCommand(name))?.let { owner ->
                    found += CommandConflict(name, owner, source, isAlias = false)
                    logger.warning("Command '/$name' ($source) conflicts with $owner: reachable as '/$namespace:$name' only.")
                }

                val aliases = compiled.aliases.map { it.lowercase() }.distinct().filter { it != name }.filter { alias ->
                    val owner = claimed[alias] ?: foreignOwner(commandMap.getCommand(alias))
                    if (owner != null) {
                        found += CommandConflict(alias, owner, source, isAlias = true)
                        logger.warning("Alias '/$alias' of '/$name' ($source) is already taken by $owner: alias ignored.")
                    }
                    owner == null
                }

                val projectCommand = PackCommand(compiled.copy(aliases = aliases), executor, lang, runtime.projectId)
                commandMap.register(namespace, projectCommand)
                registered += projectCommand
                claimed[name] = source
                aliases.forEach { claimed[it] = source }
            }
        }

        conflicts = found
        registeredLabels = ownLabels()
        if (registeredLabels != previousLabels) refreshPlayers()
    }

    fun unregisterAll() {
        if (registered.isEmpty()) return
        val commandMap = Bukkit.getCommandMap()
        val ours = registered.toSet()
        // By identity: a label another plugin holds is never removed.
        commandMap.knownCommands.values.removeIf { it in ours }
        registered.forEach { it.unregister(commandMap) }
        registered.clear()
        registeredLabels = emptySet()
    }

    private fun ownLabels(): Set<String> {
        val ours = registered.toSet()
        return Bukkit.getCommandMap().knownCommands.filterValues { it in ours }.keys.toSet()
    }

    /** Players keep the command tree sent at login: resend it so completion matches the new commands. */
    private fun refreshPlayers() {
        Bukkit.getOnlinePlayers().forEach { player ->
            scheduler.onPlayer(player.uniqueId) { if (player.isOnline) player.updateCommands() }
        }
    }

    /** Who holds [existing], when it is not one of this registrar's commands. */
    private fun foreignOwner(existing: Command?): String? = when {
        existing == null || existing is PackCommand -> null
        existing is PluginIdentifiableCommand -> "plugin ${existing.plugin.name}"
        else -> "'/${existing.name}' (${existing.javaClass.simpleName})"
    }
}
