package net.artisanmc.modules.api.command;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import net.artisanmc.modules.api.OwnedRegistry;
import net.artisanmc.modules.api.annotations.Internal;
import net.artisanmc.modules.api.annotations.Stable;
import net.artisanmc.modules.api.datasource.DataSourceRegistry;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.Nullable;

/** Commands registered by modules ({@code api.commands}), dispatched by name. */
@Stable
public final class CommandRegistry implements OwnedRegistry {
    private static final class Entry {
        final CommandDeclaration declaration;
        final @Nullable String moduleId;

        Entry(CommandDeclaration declaration, @Nullable String moduleId) {
            this.declaration = declaration;
            this.moduleId = moduleId;
        }
    }

    private final ConcurrentHashMap<String, Entry> commands = new ConcurrentHashMap<>();

    /** Owner captured for registrations happening right now (cf. {@link DataSourceRegistry}). */
    private volatile @Nullable String currentOwner;

    @Internal
    @Override
    public void bindOwner(@Nullable String moduleId) {
        currentOwner = moduleId;
    }

    /** Registers {@code decl}; throws {@link DuplicateCommandException} if its name is taken. */
    @Stable
    public void register(CommandDeclaration decl) {
        if (commands.putIfAbsent(decl.getName(), new Entry(decl, currentOwner)) != null) {
            throw new DuplicateCommandException(decl.getName());
        }
    }

    /** Removes the command {@code name}; false if none was registered. */
    @Stable
    public boolean unregister(String name) {
        return commands.remove(name) != null;
    }

    @Internal
    @Override
    public void unregisterOwnedBy(String moduleId) {
        commands.values().removeIf(e -> moduleId.equals(e.moduleId));
    }

    @Internal
    @Override
    public void unregisterLoadedBy(ClassLoader loader) {
        commands.values().removeIf(e -> e.declaration.getHandler().getClass().getClassLoader() == loader);
    }

    /** Runs the command {@code name} for {@code player}; throws {@link UnknownCommandException}. */
    @Stable
    public void dispatch(String name, Player player, Map<String, Object> args) {
        Entry entry = commands.get(name);
        if (entry == null) throw new UnknownCommandException(name);
        entry.declaration.getHandler().handle(player, args);
    }

    @Stable
    public boolean has(String name) {
        return commands.containsKey(name);
    }

    /** A snapshot of the registered names. */
    @Stable
    public Set<String> names() {
        return Set.copyOf(commands.keySet());
    }
}
