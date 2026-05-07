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

        for (bundle in bundles) {
            for (cmdYaml in bundle.commands) {
                val name = cmdYaml.name.lowercase()

                if (name in seen) {
                    logger.warning("Command '$name' defined in multiple packs — only first registration kept.")
                    continue
                }

                val existing = commandMap.getCommand(name)
                if (existing != null && existing !is PackCommand) {
                    logger.warning("Command '$name' conflicts with an existing command — skipped.")
                    continue
                }

                val compiled = CommandCompiler.compile(cmdYaml, logger) ?: continue
                val packCommand = PackCommand(compiled, executor)
                commandMap.register(namespace, packCommand)
                registered += name
                seen += name
                logger.fine("Registered command: /$name")
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
