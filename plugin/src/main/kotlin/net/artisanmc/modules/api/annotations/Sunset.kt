package net.artisanmc.modules.api.annotations

/**
 * Marks API surface that is deprecated within Artisan's own deprecation flow.
 * Distinct from kotlin.Deprecated — this is the schedule-aware variant that
 * carries the removal version and a recommended replacement.
 *
 * - Functional until [removeInVersion].
 * - Modules should migrate to [replacement].
 */
@Target(AnnotationTarget.FUNCTION, AnnotationTarget.PROPERTY, AnnotationTarget.CLASS)
@Retention(AnnotationRetention.RUNTIME)
annotation class Sunset(
    val reason: String,
    val removeInVersion: String,
    val replacement: String = "",
)
