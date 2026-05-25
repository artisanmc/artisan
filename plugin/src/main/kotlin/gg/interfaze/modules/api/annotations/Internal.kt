package gg.interfaze.modules.api.annotations

/**
 * Marks API surface that is internal to Interfaze.
 * - May change anytime, without notice.
 * - Modules MUST NOT use this.
 */
@Target(AnnotationTarget.CLASS, AnnotationTarget.FUNCTION, AnnotationTarget.PROPERTY)
@Retention(AnnotationRetention.SOURCE)
annotation class Internal
