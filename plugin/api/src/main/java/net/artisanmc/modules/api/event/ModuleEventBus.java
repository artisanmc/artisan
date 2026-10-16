package net.artisanmc.modules.api.event;

import java.util.concurrent.CopyOnWriteArrayList;
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
}
