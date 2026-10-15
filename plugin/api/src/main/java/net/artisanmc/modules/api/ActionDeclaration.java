package net.artisanmc.modules.api;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;
import net.artisanmc.modules.api.annotations.Beta;
import org.jetbrains.annotations.Nullable;

/**
 * An action a module (or Artisan itself) adds to the chain vocabulary: its wire name, its typed
 * arguments, which argument the scalar wire form binds, and the handler that runs it.
 *
 * <p>Names: a core action is a bare word ({@code open_menu}); a module action is namespaced
 * ({@code quests:start}). The editor renders the argument form from {@link #getArgs()} and
 * validates there; the runtime is tolerant.
 *
 * <p>Wire forms (ADR {@code structured-action-wire}): {@code - name} (no argument),
 * {@code - name: value} (the {@link #getPrimary() primary} argument alone), {@code - name: {arg:
 * value, ...}}. {@link #normalize} folds the three into the argument map, {@link #bind} adds the defaults a handler receives;
 * {@link #canonical} is the inverse the editor writes.
 */
@Beta
public final class ActionDeclaration {
    private static final Pattern NAME = Pattern.compile("^[a-z][a-z0-9_]*(:[a-z][a-z0-9_]*)?$");

    private final String name;
    private final List<ModelField> args;
    private final @Nullable String primary;
    private final ActionHandler handler;

    /** An action without arguments. */
    public ActionDeclaration(String name, ActionHandler handler) {
        this(name, List.of(), null, handler);
    }

    /** The primary argument is the only argument when there is exactly one, none otherwise. */
    public ActionDeclaration(String name, List<ModelField> args, ActionHandler handler) {
        this(name, args, args.size() == 1 ? args.get(0).getName() : null, handler);
    }

    public ActionDeclaration(String name, List<ModelField> args, @Nullable String primary, ActionHandler handler) {
        this.name = Objects.requireNonNull(name, "name");
        if (!NAME.matcher(name).matches()) {
            throw new IllegalArgumentException("action name '" + name + "' must match " + NAME.pattern());
        }
        this.args = List.copyOf(Objects.requireNonNull(args, "args"));
        Set<String> names = new LinkedHashSet<>();
        for (ModelField arg : this.args) {
            if (!names.add(arg.getName())) {
                throw new IllegalArgumentException("action '" + name + "' declares argument '" + arg.getName() + "' twice");
            }
        }
        if (primary != null && !names.contains(primary)) {
            throw new IllegalArgumentException("action '" + name + "': primary argument '" + primary + "' is not declared");
        }
        this.primary = primary;
        this.handler = Objects.requireNonNull(handler, "handler");
    }

    public String getName() {
        return name;
    }

    public List<ModelField> getArgs() {
        return args;
    }

    /** The argument a scalar wire value ({@code open_menu: shop}) binds; null = no scalar form. */
    public @Nullable String getPrimary() {
        return primary;
    }

    public ActionHandler getHandler() {
        return handler;
    }

    /** The declared argument of {@code name}, or null. */
    public @Nullable ModelField arg(String name) {
        for (ModelField arg : args) {
            if (arg.getName().equals(name)) return arg;
        }
        return null;
    }

    /**
     * The argument map a handler receives, from any wire form: null (a bare name) is no
     * argument; a map whose keys are all declared arguments is the argument map; anything else
     * (a scalar, a language map, a list) is the primary argument's value. Unknown keys of an
     * argument map are kept: the runtime is tolerant, the editor's form is strict.
     */
    public Map<String, Object> normalize(@Nullable Object wire) {
        if (wire == null) return Map.of();
        if (wire instanceof Map<?, ?> map && isArgsMap(map)) {
            Map<String, Object> out = new LinkedHashMap<>();
            map.forEach((k, v) -> {
                if (v != null) out.put(String.valueOf(k), v);
            });
            return Map.copyOf(out);
        }
        return primary == null ? Map.of() : Map.of(primary, wire);
    }

    /**
     * The argument map a handler runs with: {@link #normalize} completed with the declared
     * defaults of the arguments the wire left out. Two wire forms of the same action bind to
     * the same map ({@code run_command: spawn} and {@code run_command: {command: spawn, as:
     * player}}), which is what the conformance vector asserts.
     */
    public Map<String, Object> bind(@Nullable Object wire) {
        Map<String, Object> out = new LinkedHashMap<>(normalize(wire));
        for (ModelField arg : args) {
            if (arg.getDefault() != null && !out.containsKey(arg.getName())) out.put(arg.getName(), arg.getDefault());
        }
        return Map.copyOf(out);
    }

    /**
     * The canonical wire value of {@code args}: null when no argument is set (the editor writes
     * the bare name), the primary argument's value when it is the only one set, the map
     * otherwise. Null-valued arguments count as unset.
     */
    public @Nullable Object canonical(Map<String, Object> args) {
        Map<String, Object> set = new LinkedHashMap<>();
        args.forEach((k, v) -> {
            if (v != null) set.put(k, v);
        });
        if (set.isEmpty()) return null;
        if (primary != null && set.size() == 1 && set.containsKey(primary)) return set.get(primary);
        return set;
    }

    private boolean isArgsMap(Map<?, ?> map) {
        if (args.isEmpty()) return true;
        if (map.isEmpty()) return primary == null;
        for (Object key : map.keySet()) {
            if (!(key instanceof String k) || arg(k) == null) return false;
        }
        return true;
    }

    /** The editor's declaration shape: {@code {name, args: [...], primary?}}. */
    public Map<String, Object> toWire() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("name", name);
        out.put("args", args.stream().map(ModelField::toWire).toList());
        if (primary != null) out.put("primary", primary);
        return out;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof ActionDeclaration other
            && name.equals(other.name) && args.equals(other.args) && Objects.equals(primary, other.primary)
            && handler.equals(other.handler);
    }

    @Override
    public int hashCode() {
        return Objects.hash(name, args, primary, handler);
    }

    @Override
    public String toString() {
        return "ActionDeclaration(" + name + ")";
    }
}
