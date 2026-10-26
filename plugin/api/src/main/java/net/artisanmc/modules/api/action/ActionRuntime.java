package net.artisanmc.modules.api.action;

import net.artisanmc.modules.api.annotations.Stable;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.Nullable;

/**
 * What the action engine lends a handler while it runs: text resolution and the execution of a
 * nested chain. A handler that only touches the game ({@code give_item}, {@code quests:start})
 * needs none of it.
 */
@Stable
public interface ActionRuntime {
    /**
     * Resolves an {@code ltext} argument for the player: picks the language of a {@code {lang:
     * text}} map (the project's default language as fallback), looks up a {@code {i18n:key}}
     * reference, then interpolates the {@code {name}} placeholders and PlaceholderAPI. A plain
     * string is interpolated as is. Null resolves to the empty string.
     */
    String text(ActionContext ctx, @Nullable Object text);

    /**
     * The same text as {@code viewer} reads it (API 2.16.0): in the viewer's language, the
     * templates still those of {@code ctx} ({@code {player}} is the acting player). For a text
     * several players see (a broadcast, a join message); null renders it in the project's
     * default language, for the console. The default ignores the viewer.
     */
    default String textFor(ActionContext ctx, @Nullable Object text, @Nullable Player viewer) {
        return text(ctx, text);
    }

    /**
     * Runs an action chain ({@code actions} argument: the keyed structured wire, a list or a
     * single step) in {@code ctx} and returns the context it ends with. A malformed chain is
     * skipped with a warning.
     */
    ActionContext run(ActionContext ctx, @Nullable Object chain);

    /** Logs a warning with Artisan's prefix: a handler's bad data must not break the chain. */
    void warn(String message);
}
