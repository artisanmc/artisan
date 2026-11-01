package net.artisanmc.modules.api.variable;

import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import net.artisanmc.modules.api.OwnedRegistry;
import net.artisanmc.modules.api.annotations.Beta;
import net.artisanmc.modules.api.annotations.Internal;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.Nullable;

/**
 * The read-only values modules declare ({@code api.getVariables()}, ADR {@code triggers-and-variables}
 * §10), reported at Presence as {@code declared_variables}. Conditions and texts read them as
 * {@code var.<module>.<name>}: {@code expression: "var.guilds.has_guild"}, {@code {var.guilds.rank}}.
 * One source of truth: the module computes the value at each read, Artisan stores nothing.
 *
 * <p>Same ownership as the action registry: declared from a module's {@code onEnable}, named after
 * it, removed with it. A name nobody declares (the module is not installed) reads as absent.
 */
@Beta
public final class VariableRegistry implements OwnedRegistry {
    private final ConcurrentHashMap<String, RegisteredVariable> variables = new ConcurrentHashMap<>();
    private final Set<String> warned = ConcurrentHashMap.newKeySet();
    private volatile Consumer<String> warn = message -> {};
    private volatile @Nullable String currentOwner;

    @Internal
    @Override
    public void bindOwner(@Nullable String moduleId) {
        currentOwner = moduleId;
    }

    /** Where a resolver's failure or a value of the wrong type is reported, once per variable; Artisan's logger. */
    @Internal
    public void bindWarnings(Consumer<String> warn) {
        this.warn = Objects.requireNonNull(warn, "warn");
    }

    /**
     * Declares {@code decl} as {@code <module>.<name>}, the module being the one whose
     * {@code onEnable} runs.
     *
     * @throws IllegalStateException outside a module's {@code onEnable}: a variable is named after its module.
     * @throws DuplicateVariableException if that module already declared the name.
     */
    @Beta
    public RegisteredVariable declare(ModuleVariableDeclaration decl) {
        String owner = currentOwner;
        if (owner == null) {
            throw new IllegalStateException("variable '" + decl.getName() + "' must be declared from a module's onEnable");
        }
        RegisteredVariable registered = new RegisteredVariable(owner, decl);
        if (variables.putIfAbsent(registered.getQualifiedName(), registered) != null) {
            throw new DuplicateVariableException(registered.getQualifiedName());
        }
        return registered;
    }

    /** Removes {@code <module>.<name>}; false if none was declared. */
    @Beta
    public boolean undeclare(String qualifiedName) {
        return variables.remove(qualifiedName) != null;
    }

    /** The variable {@code <module>.<name>}, or null. */
    @Beta
    public @Nullable RegisteredVariable find(String qualifiedName) {
        return variables.get(qualifiedName);
    }

    /** Every declared variable, by qualified name. */
    @Beta
    public List<RegisteredVariable> registered() {
        return variables.values().stream().sorted(Comparator.comparing(RegisteredVariable::getQualifiedName)).toList();
    }

    /**
     * The value of {@code <module>.<name>} for {@code player} (and {@code key} for a keyed one), or
     * null: undeclared, absent, of another type than declared, or a resolver that threw (the last
     * two reported once). Call it on the thread that owns {@code player}.
     */
    @Beta
    public @Nullable Object read(Player player, String qualifiedName, @Nullable String key) {
        RegisteredVariable variable = variables.get(qualifiedName);
        if (variable == null) return null;
        ModuleVariableDeclaration decl = variable.getDeclaration();
        Object value;
        try {
            value = decl.getResolver().resolve(player, key);
        } catch (RuntimeException e) {
            warnOnce(qualifiedName + "|threw", "variable '" + qualifiedName + "' could not be read, read as absent: " + e);
            return null;
        }
        if (value == null) return null;
        if (!decl.getType().accepts(value)) {
            warnOnce(qualifiedName + "|type", "variable '" + qualifiedName + "' is declared " + decl.getType().wire()
                + " but its module returned " + value.getClass().getSimpleName() + ": read as absent");
            return null;
        }
        return value instanceof Number n && !(value instanceof Double) ? n.doubleValue() : value;
    }

    private void warnOnce(String id, String message) {
        if (warned.add(id)) warn.accept(message);
    }

    @Internal
    @Override
    public void unregisterOwnedBy(String moduleId) {
        variables.values().removeIf(v -> moduleId.equals(v.getModuleId()));
    }

    @Internal
    @Override
    public void unregisterLoadedBy(ClassLoader loader) {
        variables.values().removeIf(v -> v.getDeclaration().getResolver().getClass().getClassLoader() == loader);
    }
}
