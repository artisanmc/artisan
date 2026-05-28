package net.artisanmc.modules.api.annotations

/**
 * Marks API surface that is covered by SemVer.
 * - No removal or breaking changes within a major version.
 * - May be deprecated, but kept functional with a sunset date.
 */
@Target(AnnotationTarget.CLASS, AnnotationTarget.FUNCTION, AnnotationTarget.PROPERTY)
@Retention(AnnotationRetention.SOURCE)
annotation class Stable
