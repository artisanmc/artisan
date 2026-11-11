package net.artisanmc.modules.api.annotations;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks API surface that is deprecated within Artisan's own deprecation flow:
 * the schedule-aware variant of {@link Deprecated}, carrying the removal version
 * and a recommended replacement.
 * <ul>
 *   <li>Functional until {@link #removeInVersion()}.</li>
 *   <li>Modules should migrate to {@link #replacement()}.</li>
 * </ul>
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.TYPE, ElementType.METHOD, ElementType.FIELD, ElementType.CONSTRUCTOR})
public @interface Sunset {
    String reason();

    String removeInVersion();

    String replacement() default "";
}
