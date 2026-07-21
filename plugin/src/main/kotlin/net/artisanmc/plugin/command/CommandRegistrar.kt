package net.artisanmc.plugin.command

import net.artisanmc.plugin.engine.ActionExecutor
import net.artisanmc.plugin.engine.ConditionEvaluator
import net.artisanmc.plugin.lang.LangManager
import net.artisanmc.plugin.model.ProjectBundle
import org.bukkit.Bukkit
import org.bukkit.command.SimpleCommandMap
import org.bukkit.plugin.java.JavaPlugin
import java.util.logging.Logger

class CommandRegistrar(private val plugin: JavaPlugin, private val lang: LangManager) {
    private val logger: Logger get() = plugin.logger
    private val registered = mutableListOf<String>()

    fun reload(bundles: List<ProjectBundle>, executor: ActionExecutor, evaluator: ConditionEvaluator) {
        unregisterAll()
        val commandMap = Bukkit.getCommandMap()
        val namespace = plugin.name.lowercase()
        val seen = mutableSetOf<String>()
        val totalCmds = bundles.sumOf { it.commands.size }
        logger.info("[ART-DEBUG] CommandRegistrar.reload: ${bundles.size} bundles, $totalCmds commands total")

        for (bundle in bundles) {
            logger.info("[ART-DEBUG] Bundle ${bundle.projectId}: ${bundle.commands.size} commands: ${bundle.commands.map { it.name }}")
            for (cmdYaml in bundle.commands) {
                val name = cmdYaml.name.lowercase()
                logger.info("[ART-DEBUG] Processing command '$name' actions=${cmdYaml.actions.size} steps.len=${cmdYaml.steps.length}")

                if (name in seen) {
                    logger.warning("Command '$name' defined in multiple packs — only first registration kept.")
                    continue
                }

                val existing = commandMap.getCommand(name)
                if (existing != null && existing !is PackCommand) {
                    logger.warning("Command '$name' conflicts with an existing command — skipped.")
                    continue
                }

                val compiled = CommandCompiler.compile(cmdYaml, logger)
                if (compiled == null) {
                    logger.warning("[ART-DEBUG] CommandCompiler returned null for '$name'")
                    continue
                }
                // Warn about alias conflicts — best-effort, never skip the command itself.
                compiled.aliases.forEach { alias ->
                    val existingAlias = commandMap.getCommand(alias.lowercase())
                    if (existingAlias != null && existingAlias !is PackCommand) {
                        logger.warning("Alias '/$alias' for command '/$name' conflicts with an existing command — alias may not work.")
                    }
                }
                val packCommand = PackCommand(compiled, executor, lang)
                commandMap.register(namespace, packCommand)
                registered += name
                seen += name
                compiled.aliases.forEach { alias ->
                    val normalised = alias.lowercase()
                    registered += normalised
                    seen += normalised
                }
                logger.info("[ART-DEBUG] Registered command: /$name (actions=${compiled.handler.actions.size})")
            }
        }
    }

    fun unregisterAll() {
        if (registered.isEmpty()) return
        val commandMap = Bukkit.getCommandMap()
        registered.forEach { name ->
            commandMap.getCommand(name)?.unregister(commandMap)
            commandMap.getCommand("${plugin.name.lowercase()}:$name")?.unregister(commandMap)
        }
        runCatching {
            val knownCommands = (commandMap as? SimpleCommandMap)
                ?.let { SimpleCommandMap::class.java.getDeclaredField("knownCommands").also { f -> f.isAccessible = true }.get(it) as? MutableMap<*, *> }
            @Suppress("UNCHECKED_CAST")
            (knownCommands as? MutableMap<String, Any>)?.keys?.removeAll { key ->
                registered.any { name -> key == name || key == "${plugin.name.lowercase()}:$name" }
            }
        }
        registered.clear()
    }
}
