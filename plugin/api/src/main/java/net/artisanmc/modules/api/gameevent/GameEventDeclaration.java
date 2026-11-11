package net.artisanmc.modules.api.gameevent;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;
import net.artisanmc.modules.api.annotations.Beta;
import net.artisanmc.modules.api.model.ModelField;
import org.jetbrains.annotations.Nullable;

/**
 * A Game event a Trigger may listen to (ADR {@code triggers-and-variables}, §2 and §3 bis): its
 * name, the domain the editor groups it under, how often it fires, the typed context a chain reads
 * under {@code {event.…}}, whether a chain may cancel it, and the typed effects a chain may write
 * with {@code set_event}.
 *
 * <p>Names follow the action rule: a core event is a bare word ({@code player_death}), a module's is
 * namespaced ({@code quests:completed}). The context and the effects are declared, never read by
 * reflection: what the declaration does not name does not exist for a Trigger.
 */
@Beta
public final class GameEventDeclaration {
    private static final Pattern NAME = Pattern.compile("^[a-z][a-z0-9_]*(:[a-z][a-z0-9_]*)?$");
    private static final Pattern GROUP = Pattern.compile("^[a-z][a-z0-9_]*$");

    private final String name;
    private final String group;
    private final GameEventFrequency frequency;
    private final List<ModelField> context;
    private final boolean cancellable;
    private final List<ModelField> effects;

    /** An event that cannot be cancelled and declares no effect. */
    public GameEventDeclaration(String name, String group, GameEventFrequency frequency, List<ModelField> context) {
        this(name, group, frequency, context, false, List.of());
    }

    /**
     * @param name the wire name, the {@code on:} of a Trigger.
     * @param group the editor's grouping ({@code life}, {@code blocks}; a module uses its id).
     * @param frequency how often it fires; see {@link GameEventFrequency}.
     * @param context the values bound under {@code event}; {@code cancelled} is added for a
     *     cancellable event and may not be declared.
     * @param cancellable whether {@code cancel_event} applies.
     * @param effects the values {@code set_event} may write.
     */
    public GameEventDeclaration(
        String name,
        String group,
        GameEventFrequency frequency,
        List<ModelField> context,
        boolean cancellable,
        List<ModelField> effects
    ) {
        this.name = Objects.requireNonNull(name, "name");
        if (!NAME.matcher(name).matches()) {
            throw new IllegalArgumentException("game event name '" + name + "' must match " + NAME.pattern());
        }
        this.group = Objects.requireNonNull(group, "group");
        if (!GROUP.matcher(group).matches()) {
            throw new IllegalArgumentException("game event '" + name + "': group '" + group + "' must match " + GROUP.pattern());
        }
        this.frequency = Objects.requireNonNull(frequency, "frequency");
        this.context = List.copyOf(Objects.requireNonNull(context, "context"));
        this.cancellable = cancellable;
        this.effects = List.copyOf(Objects.requireNonNull(effects, "effects"));
        unique("context", this.context);
        unique("effect", this.effects);
        if (cancellable && field(this.context, "cancelled") != null) {
            throw new IllegalArgumentException("game event '" + name + "': 'cancelled' is bound by Artisan, do not declare it");
        }
    }

    private void unique(String what, List<ModelField> fields) {
        Set<String> names = new LinkedHashSet<>();
        for (ModelField f : fields) {
            if (!names.add(f.getName())) {
                throw new IllegalArgumentException("game event '" + name + "' declares " + what + " '" + f.getName() + "' twice");
            }
        }
    }

    private static @Nullable ModelField field(List<ModelField> fields, String name) {
        for (ModelField f : fields) {
            if (f.getName().equals(name)) return f;
        }
        return null;
    }

    public String getName() {
        return name;
    }

    public String getGroup() {
        return group;
    }

    public GameEventFrequency getFrequency() {
        return frequency;
    }

    public List<ModelField> getContext() {
        return context;
    }

    public boolean isCancellable() {
        return cancellable;
    }

    public List<ModelField> getEffects() {
        return effects;
    }

    /** The declared effect {@code name}, or null. */
    public @Nullable ModelField effect(String name) {
        return field(effects, name);
    }

    /** The {@code declared_game_events} entry of the presence report, without the owner. */
    public Map<String, Object> toWire() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("name", name);
        out.put("group", group);
        out.put("frequency", frequency.wire());
        out.put("context", context.stream().map(ModelField::toWire).toList());
        out.put("cancellable", cancellable);
        out.put("effects", effects.stream().map(ModelField::toWire).toList());
        return out;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof GameEventDeclaration other
            && name.equals(other.name) && group.equals(other.group) && frequency == other.frequency
            && context.equals(other.context) && cancellable == other.cancellable && effects.equals(other.effects);
    }

    @Override
    public int hashCode() {
        return Objects.hash(name, group, frequency, context, cancellable, effects);
    }

    @Override
    public String toString() {
        return "GameEventDeclaration(" + name + ")";
    }
}
