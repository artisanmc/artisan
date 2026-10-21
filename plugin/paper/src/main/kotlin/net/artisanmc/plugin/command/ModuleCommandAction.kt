package net.artisanmc.plugin.command

import net.artisanmc.modules.api.action.ActionContext
import net.artisanmc.modules.api.action.ActionDeclaration
import net.artisanmc.modules.api.action.ActionRuntime
import net.artisanmc.modules.api.model.ModelField
import net.artisanmc.modules.api.model.ModelFieldType
import net.artisanmc.plugin.lang.LangManager
import org.bukkit.World
import org.bukkit.entity.Player
import java.util.logging.Level
import java.util.logging.Logger
import net.artisanmc.plugin.platform.Chat

/**
 * `module_command`: runs the module's own code of a command it declares, as the clicking
 * player, past the admin's override (no requirement, cooldown or [ResolvedPlayerCommand.steps]:
 * the override that replaced a command can call what it replaced without looping). The
 * command's permission still applies. `args` maps the declared arguments to values, each
 * interpolated then parsed like a typed argument; `{name}` alone passes the value as is (a
 * player stays a player). A command that opens a menu opens it, the arguments as its context.
 */
class ModuleCommandAction(
    private val commands: () -> List<ResolvedPlayerCommand>,
    private val lang: LangManager,
    private val logger: Logger,
) {
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
        val node = commands().firstNotNullOfOrNull { it.find(id) }
        if (node == null) {
            runtime.warn("$NAME: no module declares the command '$id'")
            return ctx
        }
        val run = node.declaration.executor
        val menu = node.declaration.opensMenu
        if (run == null && menu == null) {
            runtime.warn("$NAME: '$id' has sub-commands only, nothing to run")
            return ctx
        }
        val permission = node.permission
        if (permission != null && !player.hasPermission(permission)) {
            Chat.send(player, lang.get("cmd.no_permission", player))
            return ctx
        }
        val raw = args["args"] as? Map<*, *> ?: emptyMap<String, Any>()
        val values = linkedMapOf<String, Any>()
        for (def in node.argDefs) {
            val value = raw[def.name]?.let { resolve(it, ctx, runtime) } ?: continue
            values[def.name] = typed(def, value) ?: run {
                val parsed = ArgParser.parse(listOf(def), arrayOf(value.toString()), player, lang) ?: return ctx
                parsed[def.name] ?: return ctx
            }
        }
        node.argDefs.firstOrNull { it.required && it.name !in values }?.let {
            Chat.send(player, lang.get("arg.missing", player, "arg" to it.name))
            return ctx
        }
        if (menu != null) return runtime.run(ctx.withArgs(ctx.args + values), ResolvedPlayerCommand.openMenu(menu))
        try {
            run!!.execute(ModuleCommandContext(node.id, player, ctx.lang, values))
        } catch (e: Exception) {
            logger.log(Level.WARNING, "Command '${node.id}' failed for ${player.name} ($NAME)", e)
            Chat.send(player, lang.get("cmd.failed", player))
        }
        return ctx
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
        else -> null
    }

    companion object {
        const val NAME = "module_command"
        private val PLACEHOLDER = Regex("^\\{([A-Za-z0-9_.-]+)}$")
    }
}
