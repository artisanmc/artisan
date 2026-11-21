package net.artisanmc.modules.api.document;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import net.artisanmc.modules.api.annotations.Beta;
import org.jetbrains.annotations.Nullable;

/**
 * What changing a Document of a kind does once deployed, said by the module that owns the kind:
 * the files its own reader would refuse, and what the change does to the players already in the
 * game (progress lost, quests started over…). Declared with
 * {@link DocumentKindDeclaration#withChangeCheck}.
 *
 * <p>Artisan calls it when a deployment is reviewed and before it is written
 * ({@code documents_check}, {@code project_write}), once per file of the kind the deployment
 * writes or deletes. A {@link Level#PROBLEM} refuses the deployment, like a file Artisan cannot
 * read (stage {@code module}). A {@link Level#LOSS} or a {@link Level#NOTICE} is shown above the
 * file's diff in the editor's review; with a loss, the author confirms before deploying. Nothing
 * here changes what the server does once the file is written: the module applies the change as it
 * always did.
 *
 * <p>Called off the main thread, with no game access; it may read the module's database (how many
 * players a change touches). A call that throws refuses nothing: the review says the file could not
 * be assessed.
 *
 * @since 1.9.0
 */
@Beta
@FunctionalInterface
public interface DocumentChangeCheck {
    /** The findings of one changed file, most important first; empty or null: nothing to say. */
    @Nullable List<Finding> check(Change change);

    /** How much a finding weighs. */
    enum Level {
        /** The module would not load the file: the deployment is refused. */
        PROBLEM,
        /** Players lose something they had (progress, a quest in progress): confirmed before deploying. */
        LOSS,
        /** Players are affected without losing anything, or a fact worth reading before deploying. */
        NOTICE
    }

    /**
     * @param level how much it weighs.
     * @param message one sentence for the author, in {@link Change#lang()} when the module has it,
     *     naming what changes in the game and for how many players when that is known.
     */
    record Finding(Level level, String message) {
        public Finding {
            Objects.requireNonNull(level, "level");
            Objects.requireNonNull(message, "message");
        }

        public static Finding problem(String message) {
            return new Finding(Level.PROBLEM, message);
        }

        public static Finding loss(String message) {
            return new Finding(Level.LOSS, message);
        }

        public static Finding notice(String message) {
            return new Finding(Level.NOTICE, message);
        }
    }

    /**
     * One file of the kind a deployment writes or deletes.
     *
     * @param project the Project's folder.
     * @param id the Document's id: its file name without extension.
     * @param before the file's YAML mapping as this server loaded it, with {@code id} set; null: a new file.
     * @param after the same once deployed; null: the file is deleted.
     * @param others the other Documents of the kind in the Project once deployed, by id, each with {@code id} set.
     * @param lang the author's language ({@code en}, {@code fr}).
     */
    record Change(
            String project,
            String id,
            @Nullable Map<String, Object> before,
            @Nullable Map<String, Object> after,
            Map<String, Map<String, Object>> others,
            String lang) {}
}
