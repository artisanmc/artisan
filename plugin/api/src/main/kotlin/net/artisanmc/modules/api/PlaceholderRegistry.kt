package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Beta
import org.bukkit.entity.Player

/**
 * Placeholders for menus (`api.placeholders`): a namespace `homes` answers every
 * `%homes_<key>%` in menu titles, names, lore, action text and conditions, without
 * PlaceholderAPI. Artisan resolves its own namespaces first, then hands the text to
 * PlaceholderAPI when it is installed.
 */
@Beta
interface PlaceholderRegistry {
    /**
     * [namespace] is a lowercase identifier (`homes`, `shop2`: `[a-z][a-z0-9]*`, no `_`).
     * With [exposeToPapi], and PlaceholderAPI installed, the namespace is also registered
     * as a PlaceholderAPI expansion, so other plugins (scoreboards, chat) can show it.
     * Throws `IllegalArgumentException` for a malformed namespace, `IllegalStateException`
     * for one already registered.
     */
    fun register(namespace: String, resolver: PlaceholderResolver, exposeToPapi: Boolean)

    /** Same, Artisan only. */
    fun register(namespace: String, resolver: PlaceholderResolver)

    /** Removes the namespace (and its PlaceholderAPI expansion). Unknown namespaces are ignored. */
    fun unregister(namespace: String)

    fun namespaces(): Set<String>

    /** [text] with Artisan's placeholders resolved for [player], then PlaceholderAPI's if installed. */
    fun resolve(player: Player, text: String): String

    companion object {
        /** Inert default (tests / partial wiring). */
        @JvmField
        val NOOP: PlaceholderRegistry = object : PlaceholderRegistry {
            override fun register(namespace: String, resolver: PlaceholderResolver, exposeToPapi: Boolean) {}
            override fun register(namespace: String, resolver: PlaceholderResolver) {}
            override fun unregister(namespace: String) {}
            override fun namespaces(): Set<String> = emptySet()
            override fun resolve(player: Player, text: String) = text
        }
    }
}

/**
 * Answers `%namespace_<key>%`, called on the viewing player's thread at every render:
 * read from memory, never block. [player] is null only when PlaceholderAPI asks for an
 * offline player. Return null for an unknown key: the token then stays as written.
 */
@Beta
fun interface PlaceholderResolver {
    fun resolve(player: Player?, key: String): String?
}
