package net.artisanmc.plugin.command

sealed class ArgDef {
    abstract val name: String
    abstract val required: Boolean

    data class StringArg(
        override val name: String,
        override val required: Boolean = true,
        val default: String? = null,
    ) : ArgDef()

    data class IntArg(
        override val name: String,
        override val required: Boolean = true,
        val default: Int? = null,
    ) : ArgDef()

    data class PlayerArg(
        override val name: String,
        override val required: Boolean = true,
        /**
         * `default: "{sender}"` in the file — omitted argument binds whoever typed
         * the command. Lets `/dailyq [player]` mean "mine by default, someone
         * else's if you name them" without the author writing a branch for the
         * common case. A non-player sender (console)
         * has nobody to fall back to, so the argument stays absent.
         */
        val defaultSender: Boolean = false,
    ) : ArgDef()

    data class WorldArg(
        override val name: String,
        override val required: Boolean = true,
    ) : ArgDef()

    data class ItemMaterialArg(
        override val name: String,
        override val required: Boolean = true,
    ) : ArgDef()

    data class EnumArg(
        override val name: String,
        override val required: Boolean = true,
        val values: List<String>,
    ) : ArgDef()
}

object ArgDefParser {

    /** Reserved `default` value binding a player argument to the command's sender. */
    const val SENDER_DEFAULT = "{sender}"


    fun parseAll(rawList: List<Map<String, Any>>): List<ArgDef> = rawList.map { parse(it) }

    private fun parse(raw: Map<String, Any>): ArgDef {
        val name     = raw["name"]?.toString()     ?: throw IllegalArgumentException("ArgDef missing 'name': $raw")
        val required = raw["required"] as? Boolean ?: true
        return when (raw["type"]?.toString() ?: throw IllegalArgumentException("ArgDef missing 'type': $raw")) {
            "string"        -> ArgDef.StringArg(name, required, raw["default"] as? String)
            "int"           -> ArgDef.IntArg(name, required, (raw["default"] as? Number)?.toInt())
            "player"        -> ArgDef.PlayerArg(name, required, raw["default"]?.toString() == SENDER_DEFAULT)
            "world"         -> ArgDef.WorldArg(name, required)
            "item_material" -> ArgDef.ItemMaterialArg(name, required)
            "enum"          -> ArgDef.EnumArg(
                name, required,
                @Suppress("UNCHECKED_CAST")
                (raw["values"] as? List<*>)?.map { it.toString() } ?: emptyList(),
            )
            else            -> throw IllegalArgumentException("Unknown arg type '${raw["type"]}': $raw")
        }
    }
}
