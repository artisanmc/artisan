package net.artisanmc.modules.api.gameevent;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import net.artisanmc.modules.api.annotations.Beta;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.Nullable;

/**
 * One firing of a Game event, as its listeners see it (ADR {@code triggers-and-variables}, §3 and
 * §3 bis): the player, the read-only context, and what the listeners asked for: cancellation and
 * effect values. The code that fired the event reads them back from
 * {@link GameEventRegistry#fire} and applies them; a frame never touches the platform event itself.
 *
 * <p>Cancellation is one way: nothing un-cancels. An effect write replaces the previous one (the last
 * listener wins). A frame lives on the thread that fired it, for the duration of the call.
 */
@Beta
public final class GameEventFrame {
    private final GameEventDeclaration declaration;
    private final Player player;
    private final Map<String, Object> context;
    private final Map<String, Object> effects = new LinkedHashMap<>();
    private boolean cancelled;

    public GameEventFrame(GameEventDeclaration declaration, Player player, Map<String, ?> context) {
        this.declaration = Objects.requireNonNull(declaration, "declaration");
        this.player = Objects.requireNonNull(player, "player");
        Map<String, Object> copy = new LinkedHashMap<>();
        context.forEach((k, v) -> {
            if (v != null) copy.put(k, v);
        });
        if (declaration.isCancellable()) copy.put("cancelled", false);
        this.context = Collections.unmodifiableMap(copy);
    }

    public GameEventDeclaration getDeclaration() {
        return declaration;
    }

    public Player getPlayer() {
        return player;
    }

    /** The values bound under {@code event} in a Trigger's chain; null values are left out. */
    public Map<String, Object> getContext() {
        return context;
    }

    public boolean isCancelled() {
        return cancelled;
    }

    /** Marks the event cancelled; false (and no change) if the event is not cancellable. */
    public boolean cancel() {
        if (!declaration.isCancellable()) return false;
        cancelled = true;
        return true;
    }

    /**
     * Writes the effect {@code name}; false (and no change) if the event does not declare it. The
     * value is stored as given: coercing it to the declared type is the writer's job.
     */
    public boolean setEffect(String name, Object value) {
        if (declaration.effect(name) == null) return false;
        effects.put(name, Objects.requireNonNull(value, "value"));
        return true;
    }

    /** The effects written so far, in write order. */
    public Map<String, Object> getEffects() {
        return Collections.unmodifiableMap(effects);
    }

    /** The value written for {@code name}, or null. */
    public @Nullable Object getEffect(String name) {
        return effects.get(name);
    }
}
