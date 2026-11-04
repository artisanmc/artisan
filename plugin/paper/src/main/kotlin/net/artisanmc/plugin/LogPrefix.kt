package net.artisanmc.plugin

import java.util.logging.Filter
import java.util.logging.Logger

/**
 * Paper already prints the plugin's logger as `[Artisan]`, and most messages write `[Artisan] ` too
 * (the same strings also reach `Bukkit.getLogger()`, which has no prefix): on the plugin's logger,
 * the written one is dropped so a line shows `[Artisan]` once.
 */
object LogPrefix {
    const val PREFIX = "[Artisan] "

    fun install(logger: Logger) {
        val previous = logger.filter
        logger.filter = Filter { record ->
            record.message?.takeIf { it.startsWith(PREFIX) }?.let { record.message = it.removePrefix(PREFIX) }
            previous?.isLoggable(record) ?: true
        }
    }
}
