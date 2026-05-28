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

    fun parseAll(rawList: List<Map<String, Any>>): List<ArgDef> = rawList.map { parse(it) }

    private fun parse(raw: Map<String, Any>): ArgDef {
        val name     = raw["name"]?.toString()     ?: throw IllegalArgumentException("ArgDef missing 'name': $raw")
        val required = raw["required"] as? Boolean ?: true
        return when (raw["type"]?.toString() ?: throw IllegalArgumentException("ArgDef missing 'type': $raw")) {
            "string"        -> ArgDef.StringArg(name, required, raw["default"] as? String)
            "int"           -> ArgDef.IntArg(name, required, (raw["default"] as? Number)?.toInt())
            "player"        -> ArgDef.PlayerArg(name, required)
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
