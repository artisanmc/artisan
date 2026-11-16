package net.artisanmc.modules.api.options;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import java.util.function.Supplier;
import java.util.regex.Pattern;
import net.artisanmc.modules.api.OwnedRegistry;
import net.artisanmc.modules.api.annotations.Beta;
import net.artisanmc.modules.api.annotations.Internal;
import org.jetbrains.annotations.Nullable;

/**
 * The closed lists of choices a module's editor view offers and only the server knows
 * ({@code api.getOptionLists()}): who may play a quest group, once other plugins added their own
 * actor types. A module declares a list under a namespaced id ({@code quests:actor_types}) with
 * a supplier; Artisan reads it at each Presence report ({@code declared_option_lists}), so the
 * editor shows it without asking the server, and a view reads it with the SDK's
 * {@code useOptionList}.
 *
 * <p>Same ownership as the other registries: declared from a module's {@code onEnable}, removed
 * with it. A list whose content moves afterwards (another plugin registered a choice) calls
 * {@link #changed()}.
 */
@Beta
public final class OptionListRegistry implements OwnedRegistry {
    private static final Pattern ID = Pattern.compile("[a-z][a-z0-9_-]*:[a-z][a-z0-9_]*");

    private record Declared(@Nullable String moduleId, Supplier<List<OptionEntry>> options) {}

    private final ConcurrentHashMap<String, Declared> lists = new ConcurrentHashMap<>();
    private volatile Consumer<String> warn = message -> {};
    private volatile Runnable changes = () -> {};
    private volatile @Nullable String currentOwner;

    @Internal
    @Override
    public void bindOwner(@Nullable String moduleId) {
        currentOwner = moduleId;
    }

    /** Where a supplier's failure is reported; Artisan's logger. */
    @Internal
    public void bindWarnings(Consumer<String> warn) {
        this.warn = Objects.requireNonNull(warn, "warn");
    }

    /** Where {@link #changed} goes: Artisan reports Presence again. */
    @Internal
    public void bindChanges(Runnable changes) {
        this.changes = Objects.requireNonNull(changes, "changes");
    }

    /**
     * Declares the list {@code id} ({@code <namespace>:<name>}, lower case). {@code options} is
     * read at each Presence report, on the server's main thread or the global region: it returns
     * the choices in the order the editor shows them.
     *
     * @throws IllegalArgumentException if {@code id} is not namespaced, or already declared.
     */
    @Beta
    public void declare(String id, Supplier<List<OptionEntry>> options) {
        Objects.requireNonNull(options, "options");
        if (id == null || !ID.matcher(id).matches()) {
            throw new IllegalArgumentException("an option list is named <namespace>:<name>, got '" + id + "'");
        }
        if (lists.putIfAbsent(id, new Declared(currentOwner, options)) != null) {
            throw new IllegalArgumentException("option list '" + id + "' is already declared");
        }
    }

    /** Removes the list {@code id}; false if none was declared. */
    @Beta
    public boolean undeclare(String id) {
        return lists.remove(id) != null;
    }

    /** Whether the list {@code id} is declared. */
    @Beta
    public boolean has(String id) {
        return lists.containsKey(id);
    }

    /**
     * Tells Artisan that a declared list has other choices than at the last report: Presence is
     * reported again, once for the changes of a tick. Safe from any thread.
     */
    @Beta
    public void changed() {
        changes.run();
    }

    /**
     * The {@code declared_option_lists} entries, by id: {@code {id, options: [{value, labels?}],
     * module_id?}}. A supplier that throws reports an empty list, logged.
     */
    @Internal
    public List<Map<String, Object>> toWire() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map.Entry<String, Declared> entry : new TreeMap<>(lists).entrySet()) {
            List<Map<String, Object>> options = new ArrayList<>();
            try {
                List<OptionEntry> read = entry.getValue().options().get();
                if (read != null) for (OptionEntry option : read) if (option != null) options.add(option.toWire());
            } catch (RuntimeException e) {
                options.clear();
                warn.accept("option list '" + entry.getKey() + "' could not be read, reported empty: " + e);
            }
            Map<String, Object> wire = new LinkedHashMap<>();
            wire.put("id", entry.getKey());
            wire.put("options", options);
            if (entry.getValue().moduleId() != null) wire.put("module_id", entry.getValue().moduleId());
            out.add(wire);
        }
        return out;
    }

    @Internal
    @Override
    public void unregisterOwnedBy(String moduleId) {
        lists.values().removeIf(d -> moduleId.equals(d.moduleId()));
    }

    @Internal
    @Override
    public void unregisterLoadedBy(ClassLoader loader) {
        lists.values().removeIf(d -> d.options().getClass().getClassLoader() == loader);
    }
}
