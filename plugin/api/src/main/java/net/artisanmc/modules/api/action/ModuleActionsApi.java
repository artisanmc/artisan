package net.artisanmc.modules.api.action;

import java.util.Map;
import net.artisanmc.modules.api.annotations.Beta;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.Nullable;

/**
 * Executes an <b>Action DSL string</b> (the module-data {@code actions} wire, ADR {@code action-dsl})
 * on behalf of a module ({@code api.actions}), e.g. the shop runs an item's purchase actions after
 * payment succeeds.
 *
 * <p>Runs on the main server thread (dispatched if called from another thread). {@code args}
 * become placeholder bindings available as {@code {name}} inside the actions ({@code player} is
 * always bound). A malformed, empty or unparseable string is skipped with a WARN log: a module's
 * bad data must not break the transaction flow.
 *
 * <p>{@code projectId} puts the project in scope for i18n: an action can then carry {@code @key},
 * resolved from that project's {@code lang/}. Without it, texts stay literal.
 */
@Beta
public interface ModuleActionsApi {
    /** Inert default (tests / partial wiring). */
    ModuleActionsApi NOOP = (player, actions, args, projectId) -> {};

    void execute(Player player, String actions, Map<String, Object> args, @Nullable String projectId);

    default void execute(Player player, String actions, Map<String, Object> args) {
        execute(player, actions, args, null);
    }

    default void execute(Player player, String actions) {
        execute(player, actions, Map.of(), null);
    }
}
