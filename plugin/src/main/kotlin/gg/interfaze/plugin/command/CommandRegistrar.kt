package gg.interfaze.plugin.command

import gg.interfaze.plugin.engine.ActionExecutor
import gg.interfaze.plugin.engine.ConditionEvaluator
import gg.interfaze.plugin.model.PackBundle
import org.bukkit.Bukkit
import org.bukkit.command.SimpleCommandMap
import org.bukkit.plugin.java.JavaPlugin
import java.util.logging.Logger

class CommandRegistrar(private val plugin: JavaPlugin) {
    private val logger: Logger get() = plugin.logger
    private val registered = mutableListOf<String>()

    fun reload(bundles: List<PackBundle>, executor: ActionExecutor, evaluator: ConditionEvaluator) {
        unregisterAll()
        val commandMap = Bukkit.getCommandMap()
        val namespace = plugin.name.lowercase()
        val seen = mutableSetOf<String>()
        val totalCmds = bundles.sumOf { it.commands.size }
        logger.info("[IFZ-DEBUG] CommandRegistrar.reload: ${bundles.size} bundles, $totalCmds commands total")

        for (bundle in bundles) {
            logger.info("[IFZ-DEBUG] Bundle ${bundle.packId}: ${bundle.commands.size} commands: ${bundle.commands.map { it.name }}")
            for (cmdYaml in bundle.commands) {
                val name = cmdYaml.name.lowercase()
                logger.info("[IFZ-DEBUG] Processing command '$name' actions=${cmdYaml.resolvedActions().size} steps=${cmdYaml.steps.size}")

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
                    logger.warning("[IFZ-DEBUG] CommandCompiler returned null for '$name'")
                    continue
                }
                val packCommand = PackCommand(compiled, executor)
                commandMap.register(namespace, packCommand)
                registered += name
                seen += name
                compiled.aliases.forEach { alias ->
                    val normalised = alias.lowercase()
                    registered += normalised
                    seen += normalised
                }
                logger.info("[IFZ-DEBUG] Registered command: /$name (actions=${compiled.handler.actions.size})")
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
