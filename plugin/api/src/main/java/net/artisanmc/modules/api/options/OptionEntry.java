package net.artisanmc.modules.api.options;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import net.artisanmc.modules.api.annotations.Beta;

/**
 * One choice of an option list: the {@code value} a file holds, and what the editor shows for it
 * by language code ({@code {en: "Each guild", fr: "Chaque guilde"}}; none: the value itself).
 */
@Beta
public record OptionEntry(String value, Map<String, String> labels) {
    public OptionEntry {
        Objects.requireNonNull(value, "value");
        if (value.isBlank()) throw new IllegalArgumentException("an option needs a value");
        labels = Map.copyOf(Objects.requireNonNull(labels, "labels"));
    }

    /** An option shown as its value. */
    public OptionEntry(String value) {
        this(value, Map.of());
    }

    /** The entry of an option list's {@code options}: {@code {value, labels?}}. */
    public Map<String, Object> toWire() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("value", value);
        if (!labels.isEmpty()) out.put("labels", new java.util.TreeMap<>(labels));
        return out;
    }
}
