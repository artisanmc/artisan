package net.artisanmc.plugin.engine

import net.artisanmc.modules.api.ActionDeclaration
import net.artisanmc.modules.api.ActionHandler
import net.artisanmc.modules.api.ModelField
import net.artisanmc.modules.api.ModelFieldType

/**
 * The typed shape of an action without its handler: what the editor's form shows, what the
 * wire binds to ([ActionDeclaration.bind]). The core actions are declared here, in the
 * Bukkit-free module, so the codecs (DSL, conformance vector) and the runtime agree on one
 * schema; the handlers live in `paper` and [declare] joins the two.
 */
data class ActionSchema(
    val name: String,
    val args: List<ModelField> = emptyList(),
    /** The argument a scalar wire value binds; the only argument by default, none when several. */
    val primary: String? = if (args.size == 1) args[0].name else null,
) {
    fun declare(handler: ActionHandler): ActionDeclaration = ActionDeclaration(name, args, primary, handler)

    /** The bound argument map of a wire value, defaults included (see [ActionDeclaration.bind]). */
    fun bind(wire: Any?): Map<String, Any> = declare(NOOP).bind(wire)

    private companion object {
        val NOOP = ActionHandler { ctx, _, _ -> ctx }
    }
}

/**
 * Artisan's own action vocabulary: one schema per entry of `$defs.Action` in
 * `docs/schema/menu/v1/schema.json` (locked by `CoreActionSchemaConformanceTest`).
 * The handlers are registered by `paper` at startup under the module id `artisan`.
 */
object CoreActions {
    private fun field(name: String, type: ModelFieldType, required: Boolean = false) = ModelField(name, type, required)
    private fun ltext(name: String, required: Boolean = false) = field(name, ModelFieldType.ltext(), required)

    val RUN_COMMAND = ActionSchema("run_command", listOf(
        field("command", ModelFieldType.string(), required = true),
        field("as", ModelFieldType.enumOf(listOf("player", "console"))).withDefault("player"),
    ), primary = "command")

    val OPEN_MENU = ActionSchema("open_menu", listOf(
        field("menu_id", ModelFieldType.documentRef("menu"), required = true),
        field("close_current", ModelFieldType.bool()).withDefault(true),
        field("context", ModelFieldType.map(ModelFieldType.string())),
        field("clear_context", ModelFieldType.bool()).withDefault(false),
    ), primary = "menu_id")

    val CLOSE_MENU = ActionSchema("close_menu")
    val OPEN_PREVIOUS_MENU = ActionSchema("open_previous_menu")

    val GIVE_ITEM = ActionSchema("give_item", listOf(
        field("material", ModelFieldType.string(), required = true),
        field("count", ModelFieldType.integer(), required = true).withDefault(1),
        field("nbt", ModelFieldType.string()),
        ltext("name"),
        field("lore", ModelFieldType.list(ModelFieldType.ltext())),
        field("lore_mode", ModelFieldType.enumOf(listOf("replace"))),
    ), primary = "material")

    val TAKE_ITEM = ActionSchema("take_item", listOf(
        field("material", ModelFieldType.string(), required = true),
        field("count", ModelFieldType.integer(), required = true).withDefault(1),
        field("nbt", ModelFieldType.string()),
    ), primary = "material")

    val GIVE_MONEY = ActionSchema("give_money", money(), primary = "amount")
    val TAKE_MONEY = ActionSchema("take_money", money(), primary = "amount")
    private fun money() = listOf(
        field("amount", ModelFieldType.number(), required = true),
        field("currency", ModelFieldType.string()),
    )

    val GIVE_XP = ActionSchema("give_xp", listOf(field("amount", ModelFieldType.integer(), required = true)))
    val GIVE_LEVEL = ActionSchema("give_level", listOf(field("amount", ModelFieldType.integer(), required = true)))

    val SEND_MESSAGE = ActionSchema("send_message", listOf(ltext("text", required = true)))
    val BROADCAST = ActionSchema("broadcast", listOf(ltext("text", required = true)))

    val PLAY_SOUND = ActionSchema("play_sound", listOf(
        field("sound", ModelFieldType.string(), required = true),
        field("volume", ModelFieldType.number()).withDefault(1.0),
        field("pitch", ModelFieldType.number()).withDefault(1.0),
    ), primary = "sound")

    val TELEPORT = ActionSchema("teleport", listOf(
        field("world", ModelFieldType.string()),
        field("x", ModelFieldType.number()),
        field("y", ModelFieldType.number()),
        field("z", ModelFieldType.number()),
        field("yaw", ModelFieldType.number()),
        field("pitch", ModelFieldType.number()),
    ), primary = null)

    val PAGINATION_NEXT = ActionSchema("pagination_next", listOf(field("element_id", ModelFieldType.string())))
    val PAGINATION_PREV = ActionSchema("pagination_prev", listOf(field("element_id", ModelFieldType.string())))

    val SHOW_TITLE = ActionSchema("show_title", listOf(
        ltext("title", required = true),
        ltext("subtitle"),
        field("fade_in", ModelFieldType.integer()).withDefault(10),
        field("stay", ModelFieldType.integer()).withDefault(70),
        field("fade_out", ModelFieldType.integer()).withDefault(20),
    ), primary = "title")

    val OPEN_DIALOG = ActionSchema("open_dialog", listOf(
        field("dialog_id", ModelFieldType.documentRef("dialog"), required = true),
        field("context", ModelFieldType.map(ModelFieldType.string())),
        field("clear_context", ModelFieldType.bool()).withDefault(false),
    ), primary = "dialog_id")

    val CLOSE_DIALOG = ActionSchema("close_dialog")

    val SET_ARG = ActionSchema("set_arg", listOf(
        field("arg", ModelFieldType.string(), required = true),
        field("value", ModelFieldType.string(), required = true),
    ), primary = null)

    val SET_ARG_CYCLE_NEXT = ActionSchema("set_arg_cycle_next", cycle(), primary = null)
    val SET_ARG_CYCLE_PREV = ActionSchema("set_arg_cycle_prev", cycle(), primary = null)
    private fun cycle() = listOf(
        field("arg", ModelFieldType.string(), required = true),
        field("list", ModelFieldType.string(), required = true),
    )

    /** `actions` is an expression naming a chain carried by a source (`{row.on_buy}`), not a chain. */
    val RUN_ACTIONS = ActionSchema("run_actions", listOf(field("actions", ModelFieldType.string(), required = true)))

    val all: List<ActionSchema> = listOf(
        RUN_COMMAND, OPEN_MENU, CLOSE_MENU, OPEN_PREVIOUS_MENU, GIVE_ITEM, TAKE_ITEM, GIVE_MONEY, TAKE_MONEY,
        GIVE_XP, GIVE_LEVEL, SEND_MESSAGE, BROADCAST, PLAY_SOUND, TELEPORT, PAGINATION_NEXT, PAGINATION_PREV,
        SHOW_TITLE, OPEN_DIALOG, CLOSE_DIALOG, SET_ARG, SET_ARG_CYCLE_NEXT, SET_ARG_CYCLE_PREV, RUN_ACTIONS,
    )

    private val byName = all.associateBy { it.name }

    fun schema(name: String): ActionSchema? = byName[name]
}
