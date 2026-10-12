package net.artisanmc.modules.api.annotations

/**
 * Marks API surface that is experimental.
 * - May change in minor versions.
 * - Modules should not rely on this in production.
 */
@Target(AnnotationTarget.CLASS, AnnotationTarget.FUNCTION, AnnotationTarget.PROPERTY)
@Retention(AnnotationRetention.SOURCE)
annotation class Beta
