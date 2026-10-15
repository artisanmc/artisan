package net.artisanmc.modules.api;

import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import net.artisanmc.modules.api.annotations.Beta;
import org.jetbrains.annotations.Nullable;

/**
 * The action vocabulary ({@code api.actionRegistry}): every name a chain may use, core and module
 * alike, with its declaration. The engine dispatches a step to {@link #find} by name; an unknown
 * name is skipped with a warning (a module's action after the module left). Same mechanism as
 * {@link DataSourceRegistry} and {@link CommandRegistry}: a registration from a module's
 * {@code onEnable} is owned by it and leaves with it.
 */
@Beta
public final class ActionRegistry {
    private final ConcurrentHashMap<String, RegisteredAction> actions = new ConcurrentHashMap<>();

    /** Owner captured for registrations happening right now; see {@link DataSourceRegistry#currentOwner}. */
    volatile @Nullable String currentOwner;

    /** Registers {@code decl}; throws {@link DuplicateActionException} if its name is taken. */
    @Beta
    public void register(ActionDeclaration decl) {
        if (actions.putIfAbsent(decl.getName(), new RegisteredAction(decl, currentOwner)) != null) {
            throw new DuplicateActionException(decl.getName());
        }
    }

    /** Removes the action {@code name}; false if none was registered. */
    @Beta
    public boolean unregister(String name) {
        return actions.remove(name) != null;
    }

    void unregisterOwnedBy(String moduleId) {
        actions.values().removeIf(r -> moduleId.equals(r.getModuleId()));
    }

    void unregisterLoadedBy(ClassLoader loader) {
        actions.values().removeIf(r -> r.getDeclaration().getHandler().getClass().getClassLoader() == loader);
    }

    /** The declaration of {@code name}, or null. */
    @Beta
    public @Nullable ActionDeclaration find(String name) {
        RegisteredAction entry = actions.get(name);
        return entry == null ? null : entry.getDeclaration();
    }

    @Beta
    public boolean has(String name) {
        return actions.containsKey(name);
    }

    /** A snapshot of the registered names. */
    @Beta
    public Set<String> names() {
        return Set.copyOf(actions.keySet());
    }

    /** The declarations, sorted by name. */
    @Beta
    public List<ActionDeclaration> declarations() {
        return actions.values().stream()
            .map(RegisteredAction::getDeclaration)
            .sorted(Comparator.comparing(ActionDeclaration::getName))
            .toList();
    }

    /** Declarations with their owning module id, sorted by name. */
    @Beta
    public List<RegisteredAction> registered() {
        return actions.values().stream()
            .sorted(Comparator.comparing(r -> r.getDeclaration().getName()))
            .toList();
    }
}
