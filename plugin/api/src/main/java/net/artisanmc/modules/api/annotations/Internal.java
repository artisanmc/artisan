package net.artisanmc.modules.api.annotations;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks API surface that is internal to Artisan.
 * <ul>
 *   <li>May change anytime, without notice.</li>
 *   <li>Modules MUST NOT use this.</li>
 * </ul>
 */
@Documented
@Retention(RetentionPolicy.SOURCE)
@Target({ElementType.TYPE, ElementType.METHOD, ElementType.FIELD, ElementType.CONSTRUCTOR})
public @interface Internal {}
