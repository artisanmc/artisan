package net.artisanmc.modules.api.variable;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;
import net.artisanmc.modules.api.annotations.Beta;
import net.artisanmc.modules.api.model.ModelField;
import org.jetbrains.annotations.Nullable;

/**
 * A read-only value a module declares (ADR {@code triggers-and-variables} §10): computed on
 * demand from the module's own state, never stored by Artisan. Conditions and texts read it as
 * {@code var.<module>.<name>} ({@code {var.guilds.has_guild}}); a keyed one as
 * {@code var.<module>.<name>["<key>"]}. The module id, the namespace, comes from the module whose
 * {@code onEnable} declares it.
 *
 * <pre>{@code
 * api.getVariables().declare(new ModuleVariableDeclaration(
 *     "has_guild", VariableType.BOOLEAN, VariableScope.PLAYER,
 *     (player, key) -> registry.member(player.getUniqueId()) != null));
 * }</pre>
 */
@Beta
public final class ModuleVariableDeclaration {
    private static final Pattern NAME = Pattern.compile("^[a-z][a-z0-9_]*$");

    private final String name;
    private final VariableType type;
    private final VariableScope scope;
    private final List<String> values;
    private final @Nullable ModelField key;
    private final Map<String, String> description;
    private final ModuleVariableResolver resolver;

    /** A variable without a key nor closed values. */
    public ModuleVariableDeclaration(String name, VariableType type, VariableScope scope, ModuleVariableResolver resolver) {
        this(name, type, scope, List.of(), null, Map.of(), resolver);
    }

    /**
     * @param name {@code [a-z][a-z0-9_]*}; the module id is the namespace.
     * @param type the type of the values the resolver returns.
     * @param scope one value per player, or one for the server.
     * @param values the closed values the editor offers (a {@link VariableType#STRING} only); empty: any.
     * @param key the key's field, for a variable read per key ({@code quests.status["daily/miner"]}); null: none.
     * @param description what the value is, by language code ({@code en}, {@code fr}), shown by the editor.
     * @param resolver computes the value at each read.
     */
    public ModuleVariableDeclaration(
        String name,
        VariableType type,
        VariableScope scope,
        List<String> values,
        @Nullable ModelField key,
        Map<String, String> description,
        ModuleVariableResolver resolver
    ) {
        this.name = Objects.requireNonNull(name, "name");
        if (!NAME.matcher(name).matches()) {
            throw new IllegalArgumentException("variable name '" + name + "' must match " + NAME.pattern());
        }
        this.type = Objects.requireNonNull(type, "type");
        this.scope = Objects.requireNonNull(scope, "scope");
        this.values = List.copyOf(Objects.requireNonNull(values, "values"));
        if (!this.values.isEmpty() && type != VariableType.STRING) {
            throw new IllegalArgumentException("variable '" + name + "': closed values need the type string");
        }
        this.key = key;
        this.description = Map.copyOf(Objects.requireNonNull(description, "description"));
        this.resolver = Objects.requireNonNull(resolver, "resolver");
    }

    public String getName() {
        return name;
    }

    public VariableType getType() {
        return type;
    }

    public VariableScope getScope() {
        return scope;
    }

    public List<String> getValues() {
        return values;
    }

    public @Nullable ModelField getKey() {
        return key;
    }

    public Map<String, String> getDescription() {
        return description;
    }

    public ModuleVariableResolver getResolver() {
        return resolver;
    }

    /** The {@code declared_variables} entry of the presence report, without its qualified name and owner. */
    public Map<String, Object> toWire() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("type", type.wire());
        out.put("scope", scope.wire());
        if (!values.isEmpty()) out.put("values", values);
        if (key != null) out.put("key", key.toWire());
        if (!description.isEmpty()) out.put("description", new java.util.TreeMap<>(description));
        return out;
    }

    @Override
    public String toString() {
        return "ModuleVariableDeclaration(" + name + ", " + type.wire() + ", " + scope.wire() + ")";
    }
}
