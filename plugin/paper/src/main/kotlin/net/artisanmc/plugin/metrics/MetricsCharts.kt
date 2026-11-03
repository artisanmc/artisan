package net.artisanmc.plugin.metrics

import net.artisanmc.plugin.hub.WebConfig
import java.util.Locale

/**
 * The values of Artisan's custom bStats charts. Only known names leave the server: a module
 * outside the suite counts as `other`, an unknown database type or language likewise, so no
 * name a server owner chose ends up on a public chart.
 */
internal object MetricsCharts {
    /** Artisan's built-in modules and the suite's add-ons, by module id. */
    val KNOWN_MODULES = setOf(
        "menus", "commands", "triggers", "variables",
        "artisanquests", "conversations", "guilds", "auctions", "daily", "attribution", "boutique",
    )
    const val OTHER = "other"

    /** Module id → 1, add-ons outside the suite grouped under [OTHER] with their count. */
    fun modules(ids: List<String>): Map<String, Int> {
        val counts = linkedMapOf<String, Int>()
        for (id in ids) {
            val key = id.lowercase(Locale.ROOT).takeIf { it in KNOWN_MODULES } ?: OTHER
            counts.merge(key, 1, Int::plus)
        }
        return counts
    }

    fun webRole(web: WebConfig): String = when {
        !web.enabled -> "disabled"
        web.leaf -> "leaf"
        else -> "hub"
    }

    fun database(type: String): String = type.lowercase(Locale.ROOT).trim().takeIf { it in DATABASES } ?: OTHER

    /** The `language` setting: a two-letter code (`fr`, `fr_FR` → `fr`), anything else [OTHER]. */
    fun language(language: String): String =
        language.trim().lowercase(Locale.ROOT).substringBefore('_').substringBefore('-')
            .takeIf { it.length == 2 && it.all { c -> c in 'a'..'z' } } ?: OTHER

    private val DATABASES = setOf("h2", "mysql", "mariadb")
}
