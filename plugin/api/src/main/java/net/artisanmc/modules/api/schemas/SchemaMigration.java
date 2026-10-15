package net.artisanmc.modules.api.schemas;

import net.artisanmc.modules.api.annotations.Stable;

/**
 * One-way data migration from one schema version to the next.
 *
 * <p>Implementations MUST be:
 * <ul>
 *   <li><b>Pure</b>: no I/O, no DB calls, no network, input to output only.</li>
 *   <li><b>Idempotent</b>: running twice on the same input yields the same output.</li>
 *   <li><b>Write-once</b>: never modified after release (write a follow-up migration instead).</li>
 * </ul>
 *
 * @param <T> the JSON-like document type the migration operates on; {@code Map<String, Object>} for YAML
 */
@Stable
public interface SchemaMigration<T> {
    /** Source schema discriminator, e.g. {@code "shop/v1"}. */
    String getFrom();

    /** Target schema discriminator, e.g. {@code "shop/v2"}. */
    String getTo();

    /** Pure transform: returns the migrated document with {@code schema} set to {@link #getTo()}. */
    T migrate(T data);
}
