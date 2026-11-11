package net.artisanmc.modules.api.gameevent;

import net.artisanmc.modules.api.annotations.Beta;

/**
 * Observes fired Game events (Artisan's {@code triggers} module is one). Called synchronously, on
 * the thread that fired the event; may cancel it or write its effects through the frame.
 */
@Beta
@FunctionalInterface
public interface GameEventListener {
    void onGameEvent(GameEventFrame frame);

    /**
     * Whether this listener wants {@code name} at all. {@link GameEventRegistry#isObserved} asks it
     * so that the code firing a frequent event can skip building its context when nobody listens.
     */
    default boolean observes(String name) {
        return true;
    }
}
