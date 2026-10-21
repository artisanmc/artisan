package net.artisanmc.modules.api.event;

import java.util.concurrent.CopyOnWriteArrayList;
import net.artisanmc.modules.api.annotations.Internal;
import net.artisanmc.modules.api.annotations.Stable;

/** Publish/subscribe bus between modules ({@code api.events}). Handlers run on the publisher's thread. */
@Stable
public final class ModuleEventBus {
    private record Sub(Class<? extends ModuleEvent> type, ModuleEventHandler handler) {}

    private final CopyOnWriteArrayList<Sub> subs = new CopyOnWriteArrayList<>();

    /** Subscribes {@code handler} to every published event that is an instance of {@code type}. */
    @Stable
    public void subscribe(Class<? extends ModuleEvent> type, ModuleEventHandler handler) {
        subs.add(new Sub(type, handler));
    }

    @Stable
    public void publish(ModuleEvent event) {
        for (Sub sub : subs) {
            if (sub.type().isInstance(event)) sub.handler().onEvent(event);
        }
    }

    /**
     * Removes the handlers {@code loader} loaded and returns how many: Artisan calls it when
     * their plugin disables, so a reloaded plugin's old handlers are not called again.
     */
    @Internal
    public int unsubscribeLoadedBy(ClassLoader loader) {
        int before = subs.size();
        subs.removeIf(sub -> sub.handler().getClass().getClassLoader() == loader);
        return before - subs.size();
    }
}
