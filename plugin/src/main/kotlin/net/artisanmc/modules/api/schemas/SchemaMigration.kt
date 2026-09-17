package net.artisanmc.modules.api.schemas

import net.artisanmc.modules.api.annotations.Stable

/**
 * One-way data migration from one schema version to the next.
 *
 * Implementations MUST be:
 * - **Pure** : no I/O, no DB calls, no network — input → output only.
 * - **Idempotent** : running twice on the same input yields the same output.
 * - **Write-once** : never modified after release (write a follow-up migration instead).
 *
 * @param T the JSON-like document type the migration operates on. For YAML-backed
 *          schemas use a typed Map<String, Any?>; tests in this codebase use
 *          MutableMap<String, Any?>.
 */
@Stable
interface SchemaMigration<T> {
    /** Source schema discriminator, e.g. "shop/v1". */
    val from: String

    /** Target schema discriminator, e.g. "shop/v2". */
    val to: String

    /** Pure transform: returns the migrated document with `schema` set to [to]. */
    fun migrate(data: T): T
}
