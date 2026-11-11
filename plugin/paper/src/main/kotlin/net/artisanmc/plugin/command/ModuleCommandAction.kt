package net.artisanmc.plugin.command

import net.artisanmc.modules.api.action.ActionContext
import net.artisanmc.modules.api.action.ActionDeclaration
import net.artisanmc.modules.api.action.ActionRuntime
import net.artisanmc.modules.api.model.ModelField
import net.artisanmc.modules.api.model.ModelFieldType
import net.artisanmc.modules.api.playercommand.PlayerCommandContext
import net.artisanmc.modules.api.playercommand.PlayerCommandDeclaration
import net.artisanmc.plugin.lang.LangManager
import org.bukkit.World
import org.bukkit.command.CommandSender
import org.bukkit.entity.Player
import java.util.logging.Level
import java.util.logging.Logger
import net.artisanmc.plugin.platform.Chat

/** Runs a module command's code for a sender the action engine does not serve: the console. */
fun interface ModuleCommandRunner {
    fun run(sender: CommandSender, id: String, args: Map<String, Any>)
}

/**
 * `module_command`: runs the code of a command a module declares, as the player. Its file's
 * actions are this action: the requirements, cooldown and fallback around it are the file's,
 * and so are the permissions, which a call from anywhere else (a menu button) checks too
 * ([permissionsOf]; the declared permission while no command runs it). `args` maps the
 * declared arguments to values, each interpolated then parsed like a typed argument; `{name}`
 * alone passes the value as is (a player stays a player). Without an entry in `args`, an
 * argument takes the bound value of its name: the command's own, parsed from what was typed.
 * A command that opens a menu opens it, the arguments as its context.
 */
class ModuleCommandAction(
    private val find: (String) -> PlayerCommandDeclaration?,
    private val permissionsOf: (String) -> List<String>?,
    private val lang: LangManager,
    private val logger: Logger,
) : ModuleCommandRunner {
    fun declaration(): ActionDeclaration = ActionDeclaration(
        NAME,
        listOf(
            ModelField("command", ModelFieldType.string(), true),
            ModelField("args", ModelFieldType.map(ModelFieldType.string())),
        ),
        "command",
    ) { ctx, args, runtime -> execute(ctx, args, runtime) }

    private fun execute(ctx: ActionContext, args: Map<String, Any>, runtime: ActionRuntime): ActionContext {
        val player = ctx.player
        val id = runtime.text(ctx, args["command"]).trim()
        val node = find(id)
        if (node == null) {
            runtime.warn("$NAME: no module declares the command '$id'")
            return ctx
        }
        val run = node.executor
        val menu = node.opensMenu
        if (run == null && menu == null) {
            runtime.warn("$NAME: '$id' has sub-commands only, nothing to run")
            return ctx
        }
        val permissions = permissionsOf(id) ?: listOfNotNull(node.permission)
        if (permissions.any { !player.hasPermission(it) }) {
            Chat.send(player, lang.get("cmd.no_permission", player))
            return ctx
        }
        val raw = args["args"] as? Map<*, *> ?: emptyMap<String, Any>()
        val values = linkedMapOf<String, Any>()
        for (def in ModuleCommandFiles.argDefs(node)) {
            val value = (if (raw.containsKey(def.name)) raw[def.name]?.let { resolve(it, ctx, runtime) } else ctx.args[def.name])
                ?: continue
            values[def.name] = typed(def, value) ?: run {
                val parsed = ArgParser.parse(listOf(def), arrayOf(value.toString()), player, lang) ?: return ctx
                parsed[def.name] ?: return ctx
            }
        }
        ModuleCommandFiles.argDefs(node).firstOrNull { it.required && it.name !in values }?.let {
            Chat.send(player, lang.get("arg.missing", player, "arg" to it.name))
            return ctx
        }
        if (menu != null) return runtime.run(ctx.withArgs(ctx.args + values), listOf(mapOf("open_menu" to menu)))
        execute(node, player, ctx.lang, values)
        return ctx
    }

    /** The console's way in: the file let it (`console: true`), and the module did (`consoleAllowed`). */
    override fun run(sender: CommandSender, id: String, args: Map<String, Any>) {
        val node = find(id)
        if (node?.executor == null || !node.isConsoleAllowed) {
            Chat.send(sender, lang.get("cmd.in_game_only", sender))
            return
        }
        execute(node, sender, lang.playerLang(sender), args)
    }

    /** A module's exception stays the module's: logged, and the sender told, never thrown into the server. */
    private fun execute(node: PlayerCommandDeclaration, sender: CommandSender, language: String, values: Map<String, Any>) {
        try {
            node.executor!!.execute(ModuleCommandContext(node.id, sender, language, values))
        } catch (e: Exception) {
            logger.log(Level.WARNING, "Command '${node.id}' failed for ${sender.name} ($NAME)", e)
            Chat.send(sender, lang.get("cmd.failed", sender))
        }
    }

    /** `{name}` alone: the bound value itself; otherwise the interpolated text. */
    private fun resolve(value: Any, ctx: ActionContext, runtime: ActionRuntime): Any? {
        if (value !is String) return value
        PLACEHOLDER.matchEntire(value.trim())?.let { m -> ctx.args[m.groupValues[1]]?.let { return it } }
        return runtime.text(ctx, value).takeIf { it.isNotEmpty() }
    }

    /** A value already of the argument's type, kept; null: parse its text. */
    private fun typed(def: ArgDef, value: Any): Any? = when {
        def is ArgDef.PlayerArg && value is Player -> value
        def is ArgDef.WorldArg && value is World -> value
        def is ArgDef.IntArg && value is Number -> value.toInt()
        def is ArgDef.StringArg && value is String -> value
        def is ArgDef.EnumArg && value is String && def.values.any { it.equals(value, ignoreCase = true) } -> value
        else -> null
    }

    companion object {
        const val NAME = ModuleCommandFiles.ACTION
        private val PLACEHOLDER = Regex("^\\{([A-Za-z0-9_.-]+)}$")
    }
}

internal class ModuleCommandContext(
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
