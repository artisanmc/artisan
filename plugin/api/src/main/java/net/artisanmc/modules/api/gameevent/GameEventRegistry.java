package net.artisanmc.modules.api.gameevent;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;
import net.artisanmc.modules.api.OwnedRegistry;
import net.artisanmc.modules.api.annotations.Beta;
import net.artisanmc.modules.api.annotations.Internal;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.Nullable;

/**
 * The Game events a Trigger may listen to ({@code api.gameEvents}, ADR {@code triggers-and-variables}
 * §2): Artisan's catalog and the modules' own, one table, reported at Presence as
 * {@code declared_game_events}. Same ownership as the action registry: a declaration or a listener
 * added from a module's {@code onEnable} is owned by it and leaves with it.
 *
 * <p>A module declares its event, then fires it where it happens ({@code quests:completed} when a
 * quest completes): {@link #fire} runs the listeners on the calling thread and hands back the frame,
 * whose cancellation and effects the module applies. Fire from the thread that owns the player
 * (main thread on Paper, the player's region on Folia): a listener runs the player's actions inline.
 */
@Beta
public final class GameEventRegistry implements OwnedRegistry {
    private final ConcurrentHashMap<String, RegisteredGameEvent> events = new ConcurrentHashMap<>();
    private final CopyOnWriteArrayList<OwnedListener> listeners = new CopyOnWriteArrayList<>();
    private volatile Consumer<String> warn = message -> {};

    private record OwnedListener(GameEventListener listener, @Nullable String moduleId) {}

    /** Owner captured for registrations happening right now; see {@link OwnedRegistry#bindOwner}. */
    private volatile @Nullable String currentOwner;

    @Internal
    @Override
    public void bindOwner(@Nullable String moduleId) {
        currentOwner = moduleId;
    }

    /** Where a listener's failure is reported; Artisan's logger. */
    @Internal
    public void bindWarnings(Consumer<String> warn) {
        this.warn = Objects.requireNonNull(warn, "warn");
    }

    /** Registers {@code decl}; throws {@link DuplicateGameEventException} if its name is taken. */
    @Beta
    public void register(GameEventDeclaration decl) {
        if (events.putIfAbsent(decl.getName(), new RegisteredGameEvent(decl, currentOwner)) != null) {
            throw new DuplicateGameEventException(decl.getName());
        }
    }

    /** Removes the event {@code name}; false if none was registered. */
    @Beta
    public boolean unregister(String name) {
        return events.remove(name) != null;
    }

    /** Adds a listener, owned by the module whose {@code onEnable} is running. */
    @Beta
    public void addListener(GameEventListener listener) {
        listeners.add(new OwnedListener(Objects.requireNonNull(listener, "listener"), currentOwner));
    }

    @Beta
    public boolean removeListener(GameEventListener listener) {
        return listeners.removeIf(l -> l.listener() == listener);
    }

    @Internal
    @Override
    public void unregisterOwnedBy(String moduleId) {
        events.values().removeIf(r -> moduleId.equals(r.getModuleId()));
        listeners.removeIf(l -> moduleId.equals(l.moduleId()));
    }

    @Internal
    @Override
    public void unregisterLoadedBy(ClassLoader loader) {
        listeners.removeIf(l -> l.listener().getClass().getClassLoader() == loader);
    }

    /** The declaration of {@code name}, or null. */
    @Beta
    public @Nullable GameEventDeclaration find(String name) {
        RegisteredGameEvent entry = events.get(name);
        return entry == null ? null : entry.getDeclaration();
    }

    @Beta
    public boolean has(String name) {
        return events.containsKey(name);
    }

    /** True if {@code name} is declared and a listener wants it: false means {@link #fire} would do nothing. */
    @Beta
    public boolean isObserved(String name) {
        if (!events.containsKey(name)) return false;
        for (OwnedListener l : listeners) {
            if (l.listener().observes(name)) return true;
        }
        return false;
    }

    /**
     * Fires {@code name} for {@code player}: every listener that observes it runs, in the order they
     * were added, on this thread. Returns the frame they wrote to; a listener that throws is reported
     * and the next one runs. Throws {@link IllegalArgumentException} if {@code name} is not declared.
     */
    @Beta
    public GameEventFrame fire(String name, Player player, Map<String, ?> context) {
        GameEventDeclaration decl = find(name);
        if (decl == null) throw new IllegalArgumentException("game event '" + name + "' is not declared");
        GameEventFrame frame = new GameEventFrame(decl, player, context);
        for (OwnedListener l : listeners) {
            if (!l.listener().observes(name)) continue;
            try {
                l.listener().onGameEvent(frame);
            } catch (RuntimeException e) {
                warn.accept("game event '" + name + "': a listener failed: " + e);
            }
        }
        return frame;
    }

    /** The declarations, sorted by name. */
    @Beta
    public List<GameEventDeclaration> declarations() {
        return events.values().stream()
            .map(RegisteredGameEvent::getDeclaration)
            .sorted(Comparator.comparing(GameEventDeclaration::getName))
            .toList();
    }

    /** Declarations with their owning module id, sorted by name. */
    @Beta
    public List<RegisteredGameEvent> registered() {
        return events.values().stream()
            .sorted(Comparator.comparing(r -> r.getDeclaration().getName()))
            .toList();
    }
}
