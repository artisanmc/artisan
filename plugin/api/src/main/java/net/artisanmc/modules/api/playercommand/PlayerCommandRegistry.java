package net.artisanmc.modules.api.playercommand;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import net.artisanmc.modules.api.OwnedRegistry;
import net.artisanmc.modules.api.annotations.Stable;
import net.artisanmc.modules.api.annotations.Internal;
import org.jetbrains.annotations.Nullable;

/**
 * The player commands modules declare ({@code api.playerCommands}). Artisan registers them in
 * the server's command map, dressed by the admin's overrides, and refreshes the players'
 * completion when they change. Distinct from {@code api.commands}, which a menu's
 * {@code run_command} calls and players never type.
 */
@Stable
public final class PlayerCommandRegistry implements OwnedRegistry {
    private record Entry(PlayerCommandDeclaration declaration, @Nullable String moduleId) {}

    private final Map<String, Entry> commands = new LinkedHashMap<>();
    private volatile @Nullable String currentOwner;
    private volatile @Nullable Runnable onChange;

    @Internal
    @Override
    public void bindOwner(@Nullable String moduleId) {
        currentOwner = moduleId;
    }

    /**
     * Registers {@code declaration}, its children included.
     *
     * @throws DuplicatePlayerCommandException if its id or a child's id is taken.
     */
    @Stable
    public void register(PlayerCommandDeclaration declaration) {
        synchronized (this) {
            List<String> taken = new ArrayList<>();
            for (Entry entry : commands.values()) ids(entry.declaration(), taken);
            List<String> ids = ids(declaration, new ArrayList<>());
            for (String id : ids) {
                if (taken.contains(id) || ids.indexOf(id) != ids.lastIndexOf(id)) throw new DuplicatePlayerCommandException(id);
            }
            commands.put(declaration.getId(), new Entry(declaration, currentOwner));
        }
        signalChange();
    }

    /** Removes the root command {@code id}; false if none was registered. */
    @Stable
    public boolean unregister(String id) {
        boolean removed;
        synchronized (this) {
            removed = commands.remove(id) != null;
        }
        if (removed) signalChange();
        return removed;
    }

    /** The registered root commands, in registration order. */
    @Stable
    public synchronized List<PlayerCommandDeclaration> declarations() {
        return commands.values().stream().map(Entry::declaration).toList();
    }

    /** The module that registered the root command {@code id}, or null: registered outside a module, or unknown. */
    @Internal
    public synchronized @Nullable String ownerOf(String id) {
        Entry entry = commands.get(id);
        return entry == null ? null : entry.moduleId();
    }

    /** The command or child {@code id}, or null. */
    @Stable
    public synchronized @Nullable PlayerCommandDeclaration find(String id) {
        for (Entry entry : commands.values()) {
            PlayerCommandDeclaration found = find(entry.declaration(), id);
            if (found != null) return found;
        }
        return null;
    }

    @Internal
    @Override
    public void unregisterOwnedBy(String moduleId) {
        boolean removed;
        synchronized (this) {
            removed = commands.values().removeIf(e -> moduleId.equals(e.moduleId()));
        }
        if (removed) signalChange();
    }

    @Internal
    @Override
    public void unregisterLoadedBy(ClassLoader loader) {
        boolean removed;
        synchronized (this) {
            removed = commands.values().removeIf(e -> loadedBy(e.declaration(), loader));
        }
        if (removed) signalChange();
    }

    /** Called after each change, outside the registry's lock; Artisan re-registers the commands. */
    @Internal
    public void onChange(@Nullable Runnable callback) {
        onChange = callback;
    }

    private void signalChange() {
        Runnable callback = onChange;
        if (callback != null) callback.run();
    }

    private static List<String> ids(PlayerCommandDeclaration declaration, List<String> out) {
        out.add(declaration.getId());
        for (PlayerCommandDeclaration child : declaration.getChildren()) ids(child, out);
        return out;
    }

    private static @Nullable PlayerCommandDeclaration find(PlayerCommandDeclaration declaration, String id) {
        if (declaration.getId().equals(id)) return declaration;
        for (PlayerCommandDeclaration child : declaration.getChildren()) {
            PlayerCommandDeclaration found = find(child, id);
            if (found != null) return found;
        }
        return null;
    }

    private static boolean loadedBy(PlayerCommandDeclaration declaration, ClassLoader loader) {
        PlayerCommandExecutor executor = declaration.getExecutor();
        if (executor != null && executor.getClass().getClassLoader() == loader) return true;
        for (PlayerCommandDeclaration child : declaration.getChildren()) {
            if (loadedBy(child, loader)) return true;
        }
        return false;
    }
}
