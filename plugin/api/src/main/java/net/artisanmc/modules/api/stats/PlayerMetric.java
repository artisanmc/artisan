package net.artisanmc.modules.api.stats;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;
import net.artisanmc.modules.api.annotations.Beta;

/**
 * A player's current value of something worth showing outside the game (a ranking, a profile):
 * money, play time, a login streak. Declared once from {@code onEnable} with
 * {@link StatsApi#declareMetric}, then set with {@link StatsApi#setMetric} whenever it changes.
 * Unlike a {@link StatEvent}, which counts what happened, a metric keeps one whole value per
 * player, the latest set. Artisan exports the values that changed to the website the admin
 * configured ({@code stats-export} in {@code environment.yml}, ADR {@code stats-export}).
 *
 * <pre>{@code
 * api.getStats().declareMetric(PlayerMetric.builder("daily:streak")
 *     .label("en", "Login streak").label("fr", "Série de connexions")
 *     .unit(MetricUnit.DAYS)
 *     .build());
 * // On each claim:
 * api.getStats().setMetric("daily:streak", player.getUniqueId(), streak);
 * }</pre>
 */
@Beta
public final class PlayerMetric {
    /** A label's language: two lower-case letters ({@code en}, {@code fr}). */
    public static final Pattern LOCALE = Pattern.compile("[a-z]{2}");
    /** A label's length, at most. */
    public static final int MAX_LABEL = 64;

    private final String id;
    private final Map<String, String> labels;
    private final MetricUnit unit;
    private final boolean ranked;
    private final boolean ascending;
    private final boolean cumulative;

    private PlayerMetric(Builder b) {
        this.id = b.id;
        this.labels = Map.copyOf(b.labels);
        this.unit = b.unit;
        this.ranked = b.ranked;
        this.ascending = b.ascending;
        this.cumulative = b.cumulative;
    }

    /**
     * Starts a declaration of {@code id} ({@code <namespace>:<name>}, as {@link StatEvent#NAME}):
     * by default {@link MetricUnit#COUNT}, ranked, the highest value first.
     *
     * @throws IllegalArgumentException if {@code id} does not match {@link StatEvent#NAME}
     */
    public static Builder builder(String id) {
        return new Builder(id);
    }

    public String getId() {
        return id;
    }

    /** The part before {@code :}, the namespace of the module that declared it. */
    public String getNamespace() {
        return id.substring(0, id.indexOf(':'));
    }

    /** The label per language code; never empty. */
    public Map<String, String> getLabels() {
        return labels;
    }

    public MetricUnit getUnit() {
        return unit;
    }

    /** Whether a website offers a ranking of it; false for a value only shown on a profile. */
    public boolean isRanked() {
        return ranked;
    }

    /** Whether the lowest value ranks first (a best time); false: the highest. */
    public boolean isAscending() {
        return ascending;
    }

    /**
     * Whether the value only adds up over time (play time, quests completed), as opposed to a
     * state (a balance, a streak): a website can then also rank what was gained over a week, a
     * month or a quarter.
     */
    public boolean isCumulative() {
        return cumulative;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof PlayerMetric other)) return false;
        return id.equals(other.id) && labels.equals(other.labels) && unit == other.unit
            && ranked == other.ranked && ascending == other.ascending && cumulative == other.cumulative;
    }

    @Override
    public int hashCode() {
        return Objects.hash(id, labels, unit, ranked, ascending, cumulative);
    }

    @Override
    public String toString() {
        return "PlayerMetric(" + id + ", " + unit + (ranked ? ", ranked" : "") + (ascending ? ", ascending" : "") + (cumulative ? ", cumulative" : "") + ", " + labels + ")";
    }

    /** Builds a {@link PlayerMetric}; every setter checks its argument. */
    @Beta
    public static final class Builder {
        private final String id;
        private final Map<String, String> labels = new LinkedHashMap<>();
        private MetricUnit unit = MetricUnit.COUNT;
        private boolean ranked = true;
        private boolean ascending;
        private boolean cumulative;

        private Builder(String id) {
            Objects.requireNonNull(id, "id");
            if (!StatEvent.NAME.matcher(id).matches()) {
                throw new IllegalArgumentException("Metric id '" + id + "': expected <namespace>:<name>, lower case");
            }
            this.id = id;
        }

        /**
         * The label in {@code locale}; give one per language the module speaks, English first.
         *
         * @throws IllegalArgumentException a locale not matching {@link #LOCALE}, a blank label or one longer than {@link #MAX_LABEL}
         */
        public Builder label(String locale, String label) {
            Objects.requireNonNull(locale, "locale");
            Objects.requireNonNull(label, "label");
            if (!LOCALE.matcher(locale).matches()) throw new IllegalArgumentException("Metric " + id + ": locale '" + locale + "', expected two lower-case letters");
            String text = label.strip();
            if (text.isEmpty() || text.length() > MAX_LABEL) throw new IllegalArgumentException("Metric " + id + ": a label of 1 to " + MAX_LABEL + " characters");
            labels.put(locale, text);
            return this;
        }

        public Builder unit(MetricUnit unit) {
            this.unit = Objects.requireNonNull(unit, "unit");
            return this;
        }

        /** Whether a website offers a ranking of it (default true). */
        public Builder ranked(boolean ranked) {
            this.ranked = ranked;
            return this;
        }

        /** The lowest value ranks first (a best time). */
        public Builder ascending() {
            this.ascending = true;
            return this;
        }

        /**
         * The value only adds up (play time, quests completed): a website may also rank what was
         * gained over a week, a month or a quarter. Not for a state such as a balance or a streak.
         */
        public Builder cumulative() {
            this.cumulative = true;
            return this;
        }

        /** @throws IllegalStateException no label given */
        public PlayerMetric build() {
            if (labels.isEmpty()) throw new IllegalStateException("Metric " + id + ": one label at least");
            return new PlayerMetric(this);
        }
    }
}
