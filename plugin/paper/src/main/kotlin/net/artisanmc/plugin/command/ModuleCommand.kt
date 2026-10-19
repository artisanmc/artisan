package net.artisanmc.plugin.command

import net.artisanmc.modules.api.playercommand.CommandArgument
import net.artisanmc.modules.api.playercommand.PlayerCommandContext
import net.artisanmc.modules.api.playercommand.PlayerCommandDeclaration
import net.artisanmc.plugin.engine.ActionChainCompiler
import net.artisanmc.plugin.engine.ActionExecutor
import net.artisanmc.plugin.engine.ClickHandler
import net.artisanmc.plugin.engine.ConditionParser
import net.artisanmc.plugin.engine.Cooldown
import net.artisanmc.plugin.engine.ExecutionContext
import net.artisanmc.plugin.lang.LangManager
import net.artisanmc.plugin.model.CommandOverrideYaml
import net.artisanmc.plugin.model.LocalizedText
import org.bukkit.command.Command
import org.bukkit.command.CommandSender
import org.bukkit.entity.Player
import java.util.logging.Level
import java.util.logging.Logger

/**
 * A module's declaration dressed by the admin's override: what is registered and run. A child
 * keeps its declared name (only the root is renamed in `command_override/v1`).
 */
class ResolvedPlayerCommand(
    val declaration: PlayerCommandDeclaration,
    val name: String,
    val aliases: List<String>,
    val permission: String?,
    val description: LocalizedText?,
    val enabled: Boolean,
    /** Override's requirements, fallback and cooldown; null when it sets none. */
    val handler: ClickHandler?,
    val cooldownMessage: LocalizedText?,
    val argDefs: List<ArgDef>,
    val children: List<ResolvedPlayerCommand>,
) {
    val id: String get() = declaration.id

    fun withAliases(aliases: List<String>) = ResolvedPlayerCommand(
        declaration, name, aliases, permission, description, enabled, handler, cooldownMessage, argDefs, children,
    )

    companion object {
        fun resolve(
            declaration: PlayerCommandDeclaration,
            overrides: Map<String, CommandOverrideYaml>,
            logger: Logger?,
            isRoot: Boolean = true,
        ): ResolvedPlayerCommand {
            val override = overrides[declaration.id]
            if (!isRoot && override?.name != null) {
                logger?.warning("Override of '${declaration.id}': a sub-command keeps its name, 'name' ignored.")
            }
            val handler = override?.let { o ->
                runCatching {
                    val cooldown = o.cooldown?.takeIf { it.duration > 0 }?.let {
                        Cooldown(it.id.ifEmpty { declaration.id }, it.duration, it.scope)
                    }
                    ClickHandler(
                        requirements = o.requirements.map { ConditionParser.parse(it) },
                        fallback = ActionChainCompiler.compile(o.fallback),
                        cooldown = cooldown,
                        steps = emptyList(),
                    ).takeIf { cooldown != null || it.requirements.isNotEmpty() }
                }.getOrElse { e ->
                    logger?.warning("Override of '${declaration.id}': invalid requirements, fallback or cooldown (${e.message}), ignored.")
                    null
                }
            }
            return ResolvedPlayerCommand(
                declaration = declaration,
                name = (if (isRoot) override?.name?.trim()?.lowercase()?.takeIf { it.isNotEmpty() } else null) ?: declaration.name,
                aliases = if (isRoot) (override?.aliases ?: declaration.aliases).map { it.lowercase() } else emptyList(),
                permission = when (val p = override?.permission) {
                    null -> declaration.permission
                    "" -> null
                    else -> p
                },
                description = override?.description ?: declaration.description.takeIf { it.isNotEmpty() }?.let { LocalizedText.ofMap(it) },
                enabled = override?.enabled ?: true,
                handler = handler,
                cooldownMessage = override?.cooldown?.message,
                argDefs = declaration.arguments.map(::argDef),
                children = declaration.children.map { resolve(it, overrides, logger, isRoot = false) },
            )
        }

        private fun argDef(arg: CommandArgument): ArgDef = when (arg.type) {
            CommandArgument.Type.STRING, CommandArgument.Type.TEXT -> ArgDef.StringArg(arg.name, arg.isRequired)
            CommandArgument.Type.INT -> ArgDef.IntArg(arg.name, arg.isRequired)
            CommandArgument.Type.PLAYER -> ArgDef.PlayerArg(arg.name, arg.isRequired)
            CommandArgument.Type.WORLD -> ArgDef.WorldArg(arg.name, arg.isRequired)
            CommandArgument.Type.ENUM -> ArgDef.EnumArg(arg.name, arg.isRequired, arg.values)
        }
    }
}

/** The Bukkit command of a [ResolvedPlayerCommand]: permission, sub-command, arguments, then the override's conditions around the module's code. */
class ModuleCommand(
    val resolved: ResolvedPlayerCommand,
    private val executor: ActionExecutor,
    private val lang: LangManager,
    private val logger: Logger,
) : Command(
    resolved.name,
    resolved.description?.forLang(lang.defaultLang, lang.defaultLang) ?: "",
    "/${resolved.name}",
    resolved.aliases,
) {
    init {
        resolved.permission?.let { permission = it }
    }

    override fun execute(sender: CommandSender, commandLabel: String, args: Array<String>): Boolean {
        var node = resolved
        var depth = 0
        while (depth < args.size) {
            val child = node.children.firstOrNull { it.enabled && it.name.equals(args[depth], ignoreCase = true) } ?: break
            node = child
            depth++
        }
        val permission = node.permission
        if (permission != null && !sender.hasPermission(permission)) {
            sender.sendMessage(lang.get("cmd.no_permission", sender))
            return true
        }
        val run = node.declaration.executor
        if (run == null) {
            val subs = node.children.filter { c -> c.enabled && c.permission?.let(sender::hasPermission) != false }.map { it.name }
            val path = (listOf(commandLabel) + args.take(depth)).joinToString(" ")
            sender.sendMessage(lang.get("cmd.usage", sender, "command" to path, "subcommands" to subs.joinToString("|")))
            return true
        }
        if (sender !is Player && !node.declaration.isConsoleAllowed) {
            sender.sendMessage(lang.get("cmd.in_game_only", sender))
            return true
        }
        val parsed = ArgParser.parse(node.argDefs, args.copyOfRange(depth, args.size), sender, lang) ?: return true
        val playerLang = lang.playerLang(sender)
        val context = Context(node.id, sender, playerLang, parsed)
        val handler = node.handler
        if (sender !is Player || handler == null) {
            runSafely(node, sender) { run.execute(context) }
            return true
        }
        val cooldown = handler.cooldown?.copy(message = node.cooldownMessage?.forLang(playerLang, playerLang))
        executor.handle(handler.copy(cooldown = cooldown), ExecutionContext(player = sender, args = parsed, lang = playerLang)) {
            runSafely(node, sender) { run.execute(context) }
        }
        return true
    }

    override fun tabComplete(sender: CommandSender, alias: String, args: Array<String>): List<String> {
        var node = resolved
        var depth = 0
        while (depth < args.size - 1) {
            node = node.children.firstOrNull { it.enabled && it.name.equals(args[depth], ignoreCase = true) } ?: break
            depth++
        }
        val prefix = args.lastOrNull() ?: ""
        val subs = if (depth == args.size - 1) {
            node.children.filter { c -> c.enabled && c.permission?.let(sender::hasPermission) != false && c.name.startsWith(prefix, ignoreCase = true) }
                .map { it.name }
        } else emptyList()
        if (node.permission?.let(sender::hasPermission) == false) return subs
        return subs + ArgParser.tabComplete(node.argDefs, args.copyOfRange(depth, args.size))
    }

    /** A module's exception stays the module's: logged, and the sender told, never thrown into the server. */
    private inline fun runSafely(node: ResolvedPlayerCommand, sender: CommandSender, block: () -> Unit) {
        try {
            block()
        } catch (e: Exception) {
            logger.log(Level.WARNING, "Command '${node.id}' failed for ${sender.name}", e)
            sender.sendMessage(lang.get("cmd.failed", sender))
        }
    }

    private class Context(
        private val commandId: String,
        private val sender: CommandSender,
        private val language: String,
        private val arguments: Map<String, Any>,
    ) : PlayerCommandContext {
        override fun getCommandId() = commandId
        override fun getSender() = sender
        override fun getPlayer() = sender as? Player
        override fun getLanguage() = language
        override fun getArguments() = arguments
    }
}
