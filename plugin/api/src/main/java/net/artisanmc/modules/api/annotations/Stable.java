package net.artisanmc.modules.api.annotations;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks API surface that is covered by SemVer.
 * <ul>
 *   <li>No removal or breaking changes within a major version.</li>
 *   <li>May be deprecated, but kept functional until its {@link Sunset} version.</li>
 * </ul>
 */
@Documented
@Retention(RetentionPolicy.SOURCE)
@Target({ElementType.TYPE, ElementType.METHOD, ElementType.FIELD, ElementType.CONSTRUCTOR})
public @interface Stable {}
