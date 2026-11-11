package net.artisanmc.plugin.command

import net.artisanmc.modules.api.playercommand.SuggestionContext
import net.artisanmc.modules.api.playercommand.SuggestionProvider
import org.bukkit.command.CommandSender
import java.util.logging.Level
import java.util.logging.Logger

/** A module's [SuggestionProvider] at completion: kept by prefix, without duplicates, [MAX] at most; a failure offers nothing. */
object ArgumentSuggestions {
    const val MAX = 100

    fun complete(
        provider: SuggestionProvider,
        sender: CommandSender,
        previous: List<String>,
        input: String,
        commandId: String,
        logger: Logger,
    ): List<String> {
        val offered = try {
            provider.suggest(Context(sender, previous.toList(), input)).orEmpty()
        } catch (e: Exception) {
            logger.log(Level.WARNING, "Suggestions of '$commandId' failed for ${sender.name}", e)
            return emptyList()
        }
        return offered.asSequence()
            .filterNotNull()
            .filter { it.startsWith(input, ignoreCase = true) }
            .distinct()
            .take(MAX)
            .toList()
    }

    private class Context(
        private val sender: CommandSender,
        private val previous: List<String>,
        private val input: String,
    ) : SuggestionContext {
        override fun getSender() = sender
        override fun getPreviousArguments() = previous
        override fun getInput() = input
    }
}
