package net.artisanmc.plugin.command

import net.artisanmc.modules.api.playercommand.PlayerCommandDeclaration
import net.artisanmc.plugin.engine.ActionExecutor
import net.artisanmc.plugin.engine.ConditionEvaluator
import net.artisanmc.plugin.lang.LangManager
import net.artisanmc.plugin.engine.RuntimeProject
import net.artisanmc.plugin.model.CommandYaml
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
 * Registers in the command map the `command/v1` documents of every project. A module's
 * commands ([playerCommands]) are documents of its folder like any other, written there by
 * `ModuleCommandFiles` and edited by the admin; a module without a folder has its commands
 * registered from the generated files, in memory.
 *
 * A label belongs to one command on the server. The admins' folders claim first, in project
 * order (they are already in production; a module's new name never takes one away), then the
 * modules' folders, then the commands of modules without one. A command losing its name stays
 * reachable as `/<prefix>:<name>` (the module's id, `artisan` for an admin's folder) while no
 * other command holds that form, and is not registered otherwise; a lost alias is dropped.
 * Each conflict is logged naming both sides; every conflict of the last reload is in [conflicts].
 *
 * A node calling a module command no module declares (the module is off) is left out, the
 * whole command when it is the root: it would only answer that the command does not exist.
 */
class CommandRegistrar(
    private val plugin: JavaPlugin,
    private val lang: LangManager,
    private val scheduler: Scheduler,
    private val playerCommands: () -> List<PlayerCommandDeclaration> = { emptyList() },
    /** The module that declared the root command of that id; null: none, or outside a module. */
    private val commandOwner: (String) -> String? = { null },
    /** The module owning that project folder; null: an admin's folder. */
    private val folderOwner: (String) -> String? = { null },
    /** Runs a module command's code for the console (`console: true`). */
    private val consoleRunner: ModuleCommandRunner? = null,
    /** The ids of a module's own Documents, which its commands' files are named apart from (`ModuleCommandFiles.id`). */
    private val takenIds: (moduleId: String) -> Set<String> = { emptySet() },
) {
    private val logger: Logger get() = plugin.logger
    private val namespace get() = plugin.name.lowercase()
    private val registered = mutableListOf<Command>()
    /** The command map keys pointing at [registered] after the last reload. */
    private var registeredLabels: Set<String> = emptySet()

    @Volatile
    var conflicts: List<CommandConflict> = emptyList()
        private set

    /**
     * Module command id → the permissions on the way to the node whose actions are that
     * module command alone, as its file sets them (the first such node, by claim order).
     */
    @Volatile
    private var permissions: Map<String, List<String>> = emptyMap()

    private var last: Triple<List<RuntimeProject>, ActionExecutor, ConditionEvaluator>? = null

    /** Re-registers from the last projects: a module declared or removed a command. Global thread. */
    fun refresh() {
        val (runtimes, executor, evaluator) = last ?: return
        reload(runtimes, executor, evaluator)
    }

    /**
     * The permissions a player needs to run module command [id] from anywhere: those of the
     * command that runs it, as its file sets them; null when no registered command does.
     */
    fun permissionsOf(id: String): List<String>? = permissions[id]

    fun reload(runtimes: List<RuntimeProject>, executor: ActionExecutor, evaluator: ConditionEvaluator) {
        last = Triple(runtimes, executor, evaluator)
        val previousLabels = registeredLabels
        unregisterAll()
        val claim = Claim(ServerPlatform.commandMap(Bukkit.getServer()))
        val declarations = playerCommands()
        val declared = declarations.flatMapTo(hashSetOf()) { ids(it) }
        /** (module, document id) of every module command document found, enabled or not. */
        val documents = hashSetOf<Pair<String, String>>()

        val (admins, modules) = runtimes.partition { folderOwner(it.projectId) == null }
        for (runtime in admins + modules) {
            val module = folderOwner(runtime.projectId)
            for (cmdYaml in runtime.commands) {
                if (module != null) documents += module to cmdYaml.id
                // A disabled command claims nothing: its name stays free for the others.
                if (!cmdYaml.enabled) continue
                val source = "project ${runtime.projectId}, command ${cmdYaml.id.ifEmpty { cmdYaml.name }}"
                claim.register(cmdYaml, source, module ?: namespace, runtime.projectId, declared, executor)
            }
        }
        // A module without a folder, or whose file is not on disk yet: its commands as generated.
        for (declaration in declarations) {
            val module = commandOwner(declaration.id)
            val taken = module?.let(takenIds).orEmpty()
            if (module != null && (module to ModuleCommandFiles.id(declaration, taken)) in documents) continue
            val yaml = try {
                ModuleCommandFiles.commandYaml(declaration, taken)
            } catch (e: Exception) {
                logger.warning("Module command '${declaration.id}' could not be built: ${e.message}")
                continue
            }
            claim.register(yaml, "module command ${declaration.id}", declaration.namespace(), null, declared, executor)
        }

        conflicts = claim.found
        permissions = claim.permissions
        registeredLabels = ownLabels()
        if (registeredLabels != previousLabels) refreshPlayers()
    }

    /** One reload's labels: who holds each, the conflicts, the module commands' permissions. */
    private inner class Claim(private val commandMap: org.bukkit.command.CommandMap) {
        private val known = ServerPlatform.knownCommands(commandMap)
        /** label → `project <id>, command <doc>` for every label claimed this reload. */
        private val claimed = mutableMapOf<String, String>()
        val found = mutableListOf<CommandConflict>()
        val permissions = mutableMapOf<String, List<String>>()

        fun register(yaml: CommandYaml, source: String, prefix: String, projectId: String?, declared: Set<String>, executor: ActionExecutor) {
            val name = yaml.name.ifEmpty { yaml.id }.lowercase()
            val compiled = CommandCompiler.compile(yaml, logger)?.let { withoutMissing(it, name, source, declared) } ?: return
            val prefixed = "$prefix:$name"
            val nameOwner = claimed[name] ?: foreignOwner(commandMap.getCommand(name))
            if (nameOwner != null) {
                found += CommandConflict(name, nameOwner, source, isAlias = false)
                if (prefixed in claimed) {
                    logger.severe("Command '/$name' ($source) is not registered: '/$name' is already taken by $nameOwner. Rename one of them.")
                    return
                }
                logger.warning("Command '/$name' ($source) is already taken by $nameOwner: reachable as '/$prefixed' only.")
            }

            val aliases = compiled.aliases.map { it.lowercase() }.distinct().filter { it != name }.filter { alias ->
                val owner = claimed[alias] ?: foreignOwner(commandMap.getCommand(alias))
                if (owner != null) {
                    found += CommandConflict(alias, owner, source, isAlias = true)
                    logger.warning("Alias '/$alias' of '/$name' ($source) is already taken by $owner: alias ignored.")
                }
                owner == null
            }

            val command = PackCommand(compiled.copy(aliases = aliases), executor, lang, projectId, consoleRunner)
            if (nameOwner == null) {
                commandMap.register(prefix, command)
                claimed[name] = source
            } else {
                // The short name stays its owner's: the prefixed form, which no one else holds, and the free aliases.
                known[prefixed] = command
                aliases.forEach { known[it] = command; known["$prefix:$it"] = command }
                command.register(commandMap)
            }
            claimed[prefixed] = source
            aliases.forEach { claimed[it] = source }
            registered += command
            record(compiled, emptyList())
        }

        /** The permissions on the way to each node that runs a module command alone; the first command keeps them. */
        private fun record(node: CompiledCommand, above: List<String>) {
            val path = above + listOfNotNull(node.permission)
            node.moduleCommand?.let { permissions.putIfAbsent(it, path) }
            node.children.forEach { record(it, path) }
        }

        private fun withoutMissing(node: CompiledCommand, path: String, source: String, declared: Set<String>): CompiledCommand? {
            val missing = node.moduleCommandsCalled().filter { it !in declared && '{' !in it }
            if (missing.isNotEmpty()) {
                logger.info("Command '/$path' ($source) is not registered: no module declares ${missing.joinToString { "'$it'" }} (module disabled?).")
                return null
            }
            return node.copy(children = node.children.mapNotNull { withoutMissing(it, "$path ${it.name}", source, declared) })
        }
    }

    private fun ids(declaration: PlayerCommandDeclaration): List<String> =
        listOf(declaration.id) + declaration.children.flatMap(::ids)

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
        existing == null || existing is PackCommand -> null
        existing is PluginIdentifiableCommand -> "plugin ${existing.plugin.name}"
        else -> "'/${existing.name}' (${existing.javaClass.simpleName})"
    }
}
