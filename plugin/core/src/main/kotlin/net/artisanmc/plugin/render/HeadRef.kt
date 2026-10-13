package net.artisanmc.plugin.render

import java.util.UUID

/**
 * Custom head reference carried by AppearanceYaml.head.
 *  - hdb:<id>              → HeadDatabase
 *  - basehead:<base64>     → profile with a "textures" property
 *  - playerhead:<name>     → the named player's head (placeholders resolved upstream)
 *  - "eyJ…" without prefix → tolerated for hand-edited YAML, treated as basehead
 */
sealed interface HeadRef {
    data class Hdb(val id: String) : HeadRef
    data class Base64(val value: String) : HeadRef
    data class PlayerName(val name: String) : HeadRef

    companion object {
        fun parse(raw: String): HeadRef? {
            val v = raw.trim()
            return when {
                v.startsWith("hdb:")        -> v.removePrefix("hdb:").trim().ifEmpty { null }?.let(::Hdb)
                v.startsWith("basehead:")   -> v.removePrefix("basehead:").trim().ifEmpty { null }?.let(::Base64)
                v.startsWith("playerhead:") -> v.removePrefix("playerhead:").trim().ifEmpty { null }?.let(::PlayerName)
                v.startsWith("eyJ")         -> Base64(v)
                else                        -> null
            }
        }

        /** Stable UUID derived from the base64: two items with the same texture stay comparable. */
        fun uuidFor(base64: String): UUID = UUID.nameUUIDFromBytes(base64.toByteArray(Charsets.UTF_8))
    }
}
