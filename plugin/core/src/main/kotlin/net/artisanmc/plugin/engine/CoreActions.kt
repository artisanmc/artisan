package net.artisanmc.plugin.engine

import net.artisanmc.modules.api.action.ActionDeclaration
import net.artisanmc.modules.api.action.ActionHandler
import net.artisanmc.modules.api.model.ModelField
import net.artisanmc.modules.api.model.ModelFieldType

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
    /**
     * Legacy i18n slot of a text argument (argument name → slot), for the positional
     * addressing of the Action DSL ([assignI18nAddresses]): `send_message.text` and
     * `broadcast.text` share the `message` slot, `show_title` has `show_title` and
     * `show_subtitle`. A text argument without a slot is addressed under the action's name.
     */
    val i18nSlots: Map<String, String> = emptyMap(),
) {
    fun declare(handler: ActionHandler): ActionDeclaration = ActionDeclaration(name, args, primary, handler)

    /** The argument map of a wire value, without defaults (see [ActionDeclaration.normalize]). */
    fun normalize(wire: Any?): Map<String, Any> = declare(NOOP).normalize(wire)

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

    private val MESSAGE_SLOT = mapOf("text" to "message")
    val SEND_MESSAGE = ActionSchema("send_message", listOf(ltext("text", required = true)), i18nSlots = MESSAGE_SLOT)
    val BROADCAST = ActionSchema("broadcast", listOf(ltext("text", required = true)), i18nSlots = MESSAGE_SLOT)

    val PLAY_SOUND = ActionSchema("play_sound", listOf(
        field("sound", ModelFieldType.string(), required = true),
        field("volume", ModelFieldType.number()).withDefault(1.0),
        field("pitch", ModelFieldType.number()).withDefault(1.0),
    ), primary = "sound")

    /**
     * `location` (ADR `triggers-and-variables` §4) is what the editor writes, alone as the scalar
     * form (`teleport: "{var.last_death}"`); `world/x/y/z/yaw/pitch` are still read.
     */
    val TELEPORT = ActionSchema("teleport", listOf(
        field("location", ModelFieldType.location()),
        field("world", ModelFieldType.string()),
        field("x", ModelFieldType.number()),
        field("y", ModelFieldType.number()),
        field("z", ModelFieldType.number()),
        field("yaw", ModelFieldType.number()),
        field("pitch", ModelFieldType.number()),
    ), primary = "location")

    val PAGINATION_NEXT = ActionSchema("pagination_next", listOf(field("element_id", ModelFieldType.string())))
    val PAGINATION_PREV = ActionSchema("pagination_prev", listOf(field("element_id", ModelFieldType.string())))

    val SHOW_TITLE = ActionSchema("show_title", listOf(
        ltext("title", required = true),
        ltext("subtitle"),
        field("fade_in", ModelFieldType.integer()).withDefault(10),
        field("stay", ModelFieldType.integer()).withDefault(70),
        field("fade_out", ModelFieldType.integer()).withDefault(20),
    ), primary = "title", i18nSlots = mapOf("title" to "show_title", "subtitle" to "show_subtitle"))

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

    // ── Variables (ADR `triggers-and-variables` §5, §7) ─────────────────────

    /** `value` is read as the Variable's type: a template is resolved, then converted (§6). */
    val SET_VAR = ActionSchema("set_var", listOf(
        field("var", ModelFieldType.documentRef(ProjectVariable.KIND), required = true),
        field("value", ModelFieldType.string(), required = true),
    ), primary = null)

    /** A `number` Variable only; absent, it starts from its default, or 0. */
    val ADD_VAR = ActionSchema("add_var", listOf(
        field("var", ModelFieldType.documentRef(ProjectVariable.KIND), required = true),
        field("amount", ModelFieldType.number()).withDefault(1.0),
    ), primary = "var")

    val CLEAR_VAR = ActionSchema("clear_var", listOf(
        field("var", ModelFieldType.documentRef(ProjectVariable.KIND), required = true),
    ))

    /**
     * A chat line with a button: [text] then [label], clickable [uses] times within
     * [expires_seconds] by the player it was sent to; the click runs `do` with the bindings of
     * the moment it was sent. The token is held in memory: a restart forgets it.
     */
    val CHAT_BUTTON = ActionSchema("chat_button", listOf(
        ltext("text"),
        ltext("label", required = true),
        field("uses", ModelFieldType.integer()).withDefault(1),
        field("expires_seconds", ModelFieldType.integer()).withDefault(300),
        field("do", ModelFieldType.actions(), required = true),
    ), primary = null)

    val all: List<ActionSchema> = listOf(
        RUN_COMMAND, OPEN_MENU, CLOSE_MENU, OPEN_PREVIOUS_MENU, GIVE_ITEM, TAKE_ITEM, GIVE_MONEY, TAKE_MONEY,
        GIVE_XP, GIVE_LEVEL, SEND_MESSAGE, BROADCAST, PLAY_SOUND, TELEPORT, PAGINATION_NEXT, PAGINATION_PREV,
        SHOW_TITLE, OPEN_DIALOG, CLOSE_DIALOG, SET_ARG, SET_ARG_CYCLE_NEXT, SET_ARG_CYCLE_PREV, RUN_ACTIONS,
        SET_VAR, ADD_VAR, CLEAR_VAR, CHAT_BUTTON,
    )

    private val byName = all.associateBy { it.name }

    fun schema(name: String): ActionSchema? = byName[name]
}
