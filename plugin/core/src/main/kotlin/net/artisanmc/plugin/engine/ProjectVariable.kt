package net.artisanmc.plugin.engine

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.modules.api.variable.VariableScope
import net.artisanmc.modules.api.variable.VariableType

/**
 * One `variables/<id>.yml` (`schema: variable/v1`, ADR `triggers-and-variables` §5): a named,
 * typed value that chains write (`set_var`, `add_var`, `clear_var`) and that conditions and texts
 * read as `{var.<id>}`. Declared, so a typo is a dead reference and a rename repoints its uses.
 *
 * @property ref the qualified id `project/id`: the name its values are stored under.
 * @property expiresSeconds lifetime of a value after its last write; 0: none.
 */
data class ProjectVariable(
    val projectId: String,
    val id: String,
    val scope: VariableScope,
    val type: VariableType,
    val default: Any?,
    val expiresSeconds: Long,
) {
    val ref: String get() = "$projectId/$id"

    /** [value] as this variable's type, or null when it is not one (never converted across types). */
    fun accept(value: Any?): Any? = typed(type, value)

    companion object {
        const val KIND = "variable"
        const val DIR = "variables"
        const val SCHEMA = "variable/v1"

        /**
         * The Variable of a raw Document, or the reason it cannot be used. Tolerant on unknown
         * keys; strict on `scope` and `type`, which decide where and how values are kept.
         */
        fun parse(projectId: String, doc: Map<String, Any?>): Result<ProjectVariable> {
            val id = doc["id"]?.toString().orEmpty()
            val ref = "$projectId/$id"
            val scope = when (val s = doc["scope"]?.toString()?.trim() ?: "player") {
                "player" -> VariableScope.PLAYER
                "server" -> VariableScope.SERVER
                else -> return Result.failure(IllegalArgumentException("$ref: `scope` is '$s', expected player or server"))
            }
            val typeWire = doc["type"]?.toString()?.trim()
                ?: return Result.failure(IllegalArgumentException("$ref: no `type` (string, number, boolean or location)"))
            val type = VariableType.fromWire(typeWire)
                ?: return Result.failure(IllegalArgumentException("$ref: `type` is '$typeWire', expected string, number, boolean or location"))
            val default = doc["default"]?.let { raw ->
                typed(type, raw) ?: return Result.failure(IllegalArgumentException("$ref: `default` '$raw' is not a $typeWire"))
            }
            val expires = when (val e = doc["expires_seconds"]) {
                null -> 0L
                is Number -> e.toLong()
                is String -> e.trim().toLongOrNull()
                    ?: return Result.failure(IllegalArgumentException("$ref: `expires_seconds` is not a number"))
                else -> return Result.failure(IllegalArgumentException("$ref: `expires_seconds` is not a number"))
            }
            return Result.success(ProjectVariable(projectId, id, scope, type, default, expires.coerceAtLeast(0)))
        }

        /**
         * [value] as [type]: a number is a Double, a location a [LocationValue]. Texts that read
         * as the type are accepted (`"3"` for a number, `"true"` for a boolean, `"world 1 2 3"`
         * for a location), since a template renders to a text; anything else is null.
         */
        fun typed(type: VariableType, value: Any?): Any? = when (value) {
            null -> null
            else -> when (type) {
                VariableType.STRING -> when (value) {
                    is String -> value
                    is Number, is Boolean -> value.toString()
                    else -> null
                }
                VariableType.NUMBER -> when (value) {
                    is Number -> value.toDouble().takeIf { it.isFinite() }
                    is String -> value.trim().toDoubleOrNull()?.takeIf { it.isFinite() }
                    else -> null
                }
                VariableType.BOOLEAN -> when (value) {
                    is Boolean -> value
                    is String -> when (value.trim().lowercase()) {
                        "true" -> true
                        "false" -> false
                        else -> null
                    }
                    else -> null
                }
                VariableType.LOCATION -> LocationValue.from(value)
            }
        }

        private val json = ObjectMapper()

        /** A typed value as stored (`artisan_vars.value`): JSON. */
        fun encode(value: Any): String = json.writeValueAsString(if (value is LocationValue) value.toWire() else value)

        /** A stored value back as [type], or null when it no longer reads as one (the type changed). */
        fun decode(type: VariableType, stored: String): Any? =
            runCatching { typed(type, json.readValue(stored, Any::class.java)) }.getOrNull()
    }
}
