package net.artisanmc.modules.api.condition;

import java.util.List;
import java.util.Map;
import net.artisanmc.modules.api.annotations.Beta;
import org.bukkit.entity.Player;

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
        public List<String> validate(List<?> conditions) {
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
}
