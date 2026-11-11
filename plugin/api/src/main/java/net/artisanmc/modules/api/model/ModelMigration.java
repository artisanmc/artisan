package net.artisanmc.modules.api.model;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import net.artisanmc.modules.api.annotations.Beta;

/**
 * The steps that bring an instance of a declared model from version {@code from} to version
 * {@code to} (ADR {@code composable-data-models} §5). Applied editor-side, in chain order.
 */
@Beta
public final class ModelMigration {
    private final int from;
    private final int to;
    private final List<MigrationStep> steps;

    public ModelMigration(int from, int to, List<MigrationStep> steps) {
        if (to <= from) throw new IllegalArgumentException("a migration goes up: from " + from + " to " + to);
        this.from = from;
        this.to = to;
        this.steps = List.copyOf(Objects.requireNonNull(steps, "steps"));
    }

    public int getFrom() {
        return from;
    }

    public int getTo() {
        return to;
    }

    public List<MigrationStep> getSteps() {
        return steps;
    }

    /** The {@code model/v1} shape: {@code {from, to, steps: [...]}}. */
    public Map<String, Object> toWire() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("from", from);
        out.put("to", to);
        out.put("steps", steps.stream().map(MigrationStep::toWire).toList());
        return out;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof ModelMigration other && from == other.from && to == other.to && steps.equals(other.steps);
    }

    @Override
    public int hashCode() {
        return Objects.hash(from, to, steps);
    }

    @Override
    public String toString() {
        return "ModelMigration(" + from + " -> " + to + ", " + steps.size() + " steps)";
    }
}
