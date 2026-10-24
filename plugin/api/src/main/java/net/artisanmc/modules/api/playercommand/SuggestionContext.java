package net.artisanmc.modules.api.playercommand;

import java.util.List;
import net.artisanmc.modules.api.annotations.Beta;
import org.bukkit.command.CommandSender;

/**
 * What a {@link SuggestionProvider} knows about the completion under way.
 *
 * @since 2.14.0
 */
@Beta
public interface SuggestionContext {
    /** Who is completing. */
    CommandSender getSender();

    /** The arguments of this command typed before the one being completed, as written, unparsed. */
    List<String> getPreviousArguments();

    /** What is typed so far for the argument being completed; empty at its start. */
    String getInput();
}
