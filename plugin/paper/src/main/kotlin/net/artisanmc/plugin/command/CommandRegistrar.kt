package net.artisanmc.plugin.command

import net.artisanmc.modules.api.playercommand.PlayerCommandDeclaration
import net.artisanmc.plugin.engine.ActionExecutor
import net.artisanmc.plugin.engine.ConditionEvaluator
import net.artisanmc.plugin.lang.LangManager
import net.artisanmc.plugin.engine.RuntimeProject
import net.artisanmc.plugin.model.CommandOverrideYaml
import net.artisanmc.plugin.platform.ServerPlatform
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
 * Registers in the command map the `command/v1` documents of every project, then the
 * commands modules declare ([playerCommands]) dressed by the admin's [overrides].
 *
 * A label belongs to one command on the server. Project commands claim first, in
 * project order (they are already in production; a module's new name never takes one
 * away), then module commands in registration order. A project command losing its
 * name to another project is not registered; a module command losing its name stays
 * reachable as `/<module>:<name>`; a lost alias is dropped. Each conflict is logged
 * naming both sides. Against another plugin's command, the project command stays
 * reachable as `/artisan:<name>`. Every conflict of the last reload is in [conflicts].
 */
class CommandRegistrar(
    private val plugin: JavaPlugin,
    private val lang: LangManager,
    private val scheduler: Scheduler,
    private val playerCommands: () -> List<PlayerCommandDeclaration> = { emptyList() },
    private val overrides: () -> Map<String, CommandOverrideYaml> = { emptyMap() },
) {
    private val logger: Logger get() = plugin.logger
    private val namespace get() = plugin.name.lowercase()
    private val registered = mutableListOf<Command>()
    /** The command map keys pointing at [registered] after the last reload. */
    private var registeredLabels: Set<String> = emptySet()

    @Volatile
    var conflicts: List<CommandConflict> = emptyList()
        private set

    /** The module commands registered by the last reload, as dressed then. */
    @Volatile
    var moduleCommands: List<ResolvedPlayerCommand> = emptyList()
        private set

    private var last: Triple<List<RuntimeProject>, ActionExecutor, ConditionEvaluator>? = null

    /** Re-registers from the last projects: a module declared or removed a command, an override changed. Global thread. */
    fun refresh() {
        val (runtimes, executor, evaluator) = last ?: return
        reload(runtimes, executor, evaluator)
    }

    fun reload(runtimes: List<RuntimeProject>, executor: ActionExecutor, evaluator: ConditionEvaluator) {
        last = Triple(runtimes, executor, evaluator)
        val previousLabels = registeredLabels
        unregisterAll()
        val commandMap = ServerPlatform.commandMap(Bukkit.getServer())
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

        registerModuleCommands(executor, claimed, found)

        conflicts = found
        registeredLabels = ownLabels()
        if (registeredLabels != previousLabels) refreshPlayers()
    }

    private fun registerModuleCommands(
        executor: ActionExecutor,
        claimed: MutableMap<String, String>,
        found: MutableList<CommandConflict>,
    ) {
        val commandMap = ServerPlatform.commandMap(Bukkit.getServer())
        val known = ServerPlatform.knownCommands(commandMap)
        val dressing = overrides()
        val resolved = mutableListOf<ResolvedPlayerCommand>()
        for (declaration in playerCommands()) {
            val command = ResolvedPlayerCommand.resolve(declaration, dressing, logger)
            resolved += command
            if (!command.enabled) continue
            val prefix = declaration.namespace()
            val source = "module command ${declaration.id}"
            val name = command.name
            val prefixed = known["$prefix:$name"]
            if (prefixed is ModuleCommand) {
                found += CommandConflict(name, "module command ${prefixed.resolved.id}", source, isAlias = false)
                logger.severe("Command '/$prefix:$name' ($source) is not registered: module command ${prefixed.resolved.id} has the same name. Rename one of them.")
                continue
            }
            val nameOwner = claimed[name] ?: foreignOwner(commandMap.getCommand(name))
            if (nameOwner != null) {
                found += CommandConflict(name, nameOwner, source, isAlias = false)
                logger.warning("Command '/$name' ($source) is already taken by $nameOwner: reachable as '/$prefix:$name' only.")
            }
            val aliases = command.aliases.distinct().filter { it != name }.filter { alias ->
                val owner = claimed[alias] ?: foreignOwner(commandMap.getCommand(alias))
                if (owner != null) {
                    found += CommandConflict(alias, owner, source, isAlias = true)
                    logger.warning("Alias '/$alias' of '/$name' ($source) is already taken by $owner: alias ignored.")
                }
                owner == null
            }
            val moduleCommand = ModuleCommand(command.withAliases(aliases), executor, lang, logger)
            if (nameOwner == null) {
                commandMap.register(prefix, moduleCommand)
                claimed[name] = source
                aliases.forEach { claimed[it] = source }
            } else {
                // The short name stays its owner's: the prefixed form, which no one else holds, and the free aliases.
                known["$prefix:$name"] = moduleCommand
                aliases.forEach { alias ->
                    known[alias] = moduleCommand
                    known["$prefix:$alias"] = moduleCommand
                    claimed[alias] = source
                }
                moduleCommand.register(commandMap)
            }
            registered += moduleCommand
        }
        moduleCommands = resolved
    }

    fun unregisterAll() {
        if (registered.isEmpty()) return
        val commandMap = ServerPlatform.commandMap(Bukkit.getServer())
        val ours = registered.toSet()
        // By identity: a label another plugin holds is never removed.
        ServerPlatform.knownCommands(commandMap).values.removeIf { it in ours }
        registered.forEach { it.unregister(commandMap) }
        registered.clear()
        registeredLabels = emptySet()
    }

    private fun ownLabels(): Set<String> {
        val ours = registered.toSet()
        return ServerPlatform.knownCommands(ServerPlatform.commandMap(Bukkit.getServer())).filterValues { it in ours }.keys.toSet()
    }

    /** Players keep the command tree sent at login: resend it so completion matches the new commands. */
    private fun refreshPlayers() {
        Bukkit.getOnlinePlayers().forEach { player ->
            scheduler.onPlayer(player.uniqueId) { if (player.isOnline) player.updateCommands() }
        }
    }

    /** Who holds [existing], when it is not one of this registrar's commands. */
    private fun foreignOwner(existing: Command?): String? = when {
        existing == null || existing is PackCommand || existing is ModuleCommand -> null
        existing is PluginIdentifiableCommand -> "plugin ${existing.plugin.name}"
        else -> "'/${existing.name}' (${existing.javaClass.simpleName})"
    }
}
