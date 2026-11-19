package net.artisanmc.modules.api.importing;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import net.artisanmc.modules.api.annotations.Beta;
import org.jetbrains.annotations.Nullable;

/**
 * What a run read, wrote or would write. Counts are per kind of record (listings, claims…),
 * labelled by the module in the request's language. A rejected record keeps its source id and a
 * stable code; a blocker stops the whole write (an unmapped currency, a missing file).
 */
@Beta
public final class ImportReport {
    /** A number of records of one kind. {@code kind} is stable, {@code label} is for the admin. */
    public record Count(String kind, String label, int count) {
        public Count {
            Objects.requireNonNull(kind, "kind");
            Objects.requireNonNull(label, "label");
        }
    }

    /** A record left aside: its id in the source, a stable code ({@code unreadable_item}), a message for the admin. */
    public record Rejection(String sourceId, String code, String message) {
        public Rejection {
            Objects.requireNonNull(sourceId, "sourceId");
            Objects.requireNonNull(code, "code");
            Objects.requireNonNull(message, "message");
        }
    }

    private final boolean dryRun;
    private final @Nullable String batch;
    private final List<Count> counts;
    private final int alreadyImported;
    private final List<Rejection> rejected;
    private final List<String> blockers;
    private final List<String> notes;

    private ImportReport(Builder b) {
        this.dryRun = b.dryRun || !b.blockers.isEmpty();
        this.batch = this.dryRun ? null : b.batch;
        this.counts = List.copyOf(b.counts);
        this.alreadyImported = b.alreadyImported;
        this.rejected = List.copyOf(b.rejected);
        this.blockers = List.copyOf(b.blockers);
        this.notes = List.copyOf(b.notes);
    }

    /** True when nothing was written: a plan, a dry-run rollback, or a run stopped by a blocker. */
    public boolean isDryRun() {
        return dryRun;
    }

    /** The batch the records were written under; null when nothing was written. */
    public @Nullable String getBatch() {
        return batch;
    }

    public List<Count> getCounts() {
        return counts;
    }

    /** Records found in the module's ledger, skipped. */
    public int getAlreadyImported() {
        return alreadyImported;
    }

    public List<Rejection> getRejected() {
        return rejected;
    }

    public List<String> getBlockers() {
        return blockers;
    }

    /** Anything else worth reading (a record the source itself could not give). */
    public List<String> getNotes() {
        return notes;
    }

    /** Sum of {@link #getCounts()}. */
    public int total() {
        int n = 0;
        for (Count c : counts) n += c.count();
        return n;
    }

    /** {@code dryRun}: true for a plan or a dry-run rollback. {@code batch}: the request's, kept only if something is written. */
    public static Builder builder(boolean dryRun, @Nullable String batch) {
        return new Builder(dryRun, batch);
    }

    public static final class Builder {
        private final boolean dryRun;
        private final @Nullable String batch;
        private final List<Count> counts = new ArrayList<>();
        private int alreadyImported;
        private final List<Rejection> rejected = new ArrayList<>();
        private final List<String> blockers = new ArrayList<>();
        private final List<String> notes = new ArrayList<>();

        private Builder(boolean dryRun, @Nullable String batch) {
            this.dryRun = dryRun;
            this.batch = batch;
        }

        public Builder count(String kind, String label, int count) {
            counts.add(new Count(kind, label, count));
            return this;
        }

        public Builder alreadyImported(int count) {
            this.alreadyImported = count;
            return this;
        }

        public Builder reject(String sourceId, String code, String message) {
            rejected.add(new Rejection(sourceId, code, message));
            return this;
        }

        public Builder blocker(String message) {
            blockers.add(Objects.requireNonNull(message));
            return this;
        }

        public Builder note(String message) {
            notes.add(Objects.requireNonNull(message));
            return this;
        }

        public ImportReport build() {
            return new ImportReport(this);
        }
    }
}
