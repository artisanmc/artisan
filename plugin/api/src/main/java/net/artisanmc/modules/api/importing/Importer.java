package net.artisanmc.modules.api.importing;

import net.artisanmc.modules.api.annotations.Beta;

/**
 * Reads one source of data (a competitor's storage, or the module's canonical JSON file) and
 * writes it into the module (ADR {@code data-imports}). Artisan calls these methods one at a
 * time per module, off the game threads: they may block. They never write to the source.
 *
 * <p>The module owns idempotence: each record written is noted in its own ledger, in the same
 * transaction as the record, so a second {@link #apply} skips it and a crash mid-import resumes.
 */
@Beta
public interface Importer {
    /** Reads, converts and counts; writes nothing. */
    ImportReport plan(ImportRequest request) throws Exception;

    /**
     * Reads, converts and writes each record not imported yet, under {@link ImportRequest#getBatch()}.
     * A record that cannot be converted entirely stays in the source and is reported. When the
     * report has {@linkplain ImportReport#getBlockers() blockers}, nothing is written and the
     * report says so ({@link ImportReport#isDryRun()} true).
     */
    ImportReport apply(ImportRequest request) throws Exception;

    /**
     * Undoes the records {@code batch} created that are still as the import left them; what has
     * lived since (bought, claimed, changed) is kept and reported as rejected. With
     * {@code dryRun}, only counts.
     */
    ImportReport rollback(String batch, boolean dryRun) throws Exception;
}
