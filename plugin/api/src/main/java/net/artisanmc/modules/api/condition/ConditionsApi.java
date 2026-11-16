package net.artisanmc.modules.api.condition;

import java.util.List;
import java.util.Map;
import net.artisanmc.modules.api.annotations.Beta;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.Nullable;

/**
 * Evaluates a list of conditions outside an action chain ({@code api.getConditions()}), with
 * the evaluator chains use in {@code if:}: a module's own requirements (can this quest start?)
 * read the same vocabulary as a menu's.
 *
 * <p>Each entry is one condition in the keyed wire ({@code {has_permission: vip.use}},
 * {@code {placeholder_equals: {placeholder: "%x%", value: "1"}}}, {@code not:}, {@code and:},
 * {@code or:}) or the type-tagged form ({@code {type: has_permission, perm: vip.use}}). The list
 * is an AND; an empty list holds.
 *
 * <p>Fails closed: an unknown condition, a missing or malformed argument, or one bad operand of
 * {@code and:}/{@code or:} makes {@link #test} false with a warning, where a menu's tolerant read
 * would drop it. {@link #validate} reports the same problems at load time.
 *
 * <p>{@code args} are bound for {@code expression} conditions ({@code {expression: "level >= 10"}}).
 * {@code pagination_at_first}/{@code pagination_at_last} have no menu to read here and hold.
 *
 * <p><b>Without a player</b> (since 1.3.0): a console command, a scheduled task, a guild or land
 * event has no player to test. {@link #testWithoutPlayer} evaluates the conditions that do not read
 * one: {@code expression} on {@code args} and the server-scoped {@code var}, {@code has_var} on a
 * server-scoped variable, {@code random_chance}, the pagination ones, and {@code not:}/{@code and:}/
 * {@code or:} of those. Every other condition reads the player, their world or their client
 * ({@code has_permission}, {@code has_money}, {@code placeholder_equals}, {@code time_is}…), as does
 * an {@code expression} with a {@code %placeholder%} or the name {@code player}: such a list is
 * false as a whole, with a warning, and {@link #validateWithoutPlayer} names the condition.
 */
@Beta
public interface ConditionsApi {
    /** Inert default (tests / partial wiring): only an empty list holds. */
    ConditionsApi NOOP = new ConditionsApi() {
        @Override
        public boolean test(Player player, List<?> conditions, Map<String, ?> args) {
            return conditions.isEmpty();
        }

        @Override
        public boolean testWithoutPlayer(List<?> conditions, Map<String, ?> args, @Nullable String projectId) {
            return conditions.isEmpty();
        }

        @Override
        public List<String> validate(List<?> conditions) {
            return List.of();
        }

        @Override
        public List<String> validateWithoutPlayer(List<?> conditions) {
            return List.of();
        }
    };

    /**
     * True when every condition holds for {@code player}. Reads the player's state, so it must
     * be called on the thread that owns the player (the main thread on Paper, the player's
     * region on Folia): {@link IllegalStateException} otherwise. False until Artisan's engine
     * has started.
     */
    boolean test(Player player, List<?> conditions, Map<String, ?> args);

    default boolean test(Player player, List<?> conditions) {
        return test(player, conditions, Map.of());
    }

    /** One message per entry {@link #test} would reject, by index; empty when the list is valid. */
    List<String> validate(List<?> conditions);

    /**
     * True when every condition holds without a player (see the class comment for which can).
     * {@code args} are bound for {@code expression}, as in {@link #test}; {@code projectId} puts that
     * Project's variables in scope for {@code var.<id>} and {@code has_var} (null: only
     * {@code var["<project>/<id>"]} and the modules' server-scoped {@code var.<module>.<name>}). A
     * player-scoped variable reads as absent.
     *
     * <p>Fails closed like {@link #test}: a malformed entry, or one that needs a player, makes the
     * whole list false with a warning (logged once), even under {@code not:} or {@code or:}. False
     * until Artisan's engine has started; an empty list holds.
     *
     * <p>Reads no game state, so any thread may call it, as long as {@code args} hold values that
     * are themselves safe to read there (no live {@code Player} or {@code World}).
     *
     * @since 1.3.0
     */
    default boolean testWithoutPlayer(List<?> conditions, Map<String, ?> args, @Nullable String projectId) {
        return conditions.isEmpty();
    }

    /** {@link #testWithoutPlayer(List, Map, String)} without a Project. @since 1.3.0 */
    default boolean testWithoutPlayer(List<?> conditions, Map<String, ?> args) {
        return testWithoutPlayer(conditions, args, null);
    }

    /**
     * One message per entry {@link #testWithoutPlayer} would reject, by index: what
     * {@link #validate} reports, then "condition #i needs a player (has_permission) …" for an entry
     * that reads one. Empty when the list can be tested without a player. For a module that loads
     * a requirement it will test without a player: report these at load time, not at each test.
     *
     * @since 1.3.0
     */
    default List<String> validateWithoutPlayer(List<?> conditions) {
        return validate(conditions);
    }
}
