package net.artisanmc.plugin.render

import java.util.UUID

/**
 * Référence de tête custom portée par AppearanceYaml.head.
 *  - hdb:<id>              → HeadDatabase
 *  - basehead:<base64>     → profil avec property "textures"
 *  - playerhead:<pseudo>   → tête du joueur nommé (placeholders résolus en amont)
 *  - "eyJ…" sans préfixe   → tolérance YAML édité main, traité comme basehead
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

        /** UUID stable dérivé du base64 — deux items de même texture restent comparables. */
        fun uuidFor(base64: String): UUID = UUID.nameUUIDFromBytes(base64.toByteArray(Charsets.UTF_8))
    }
}
