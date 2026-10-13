package net.artisanmc.modules.api;

import net.artisanmc.modules.api.annotations.Stable;

/**
 * Row-field kinds a data source can declare in its {@link DataSourceDeclaration#getSchema()}.
 *
 * <p>Declared in Java, not Kotlin: a Kotlin enum exposes {@code getEntries()},
 * which returns {@code kotlin.enums.EnumEntries}. The shadowJar relocates that type
 * but the published API JAR does not, so a Kotlin add-on writing
 * {@code FieldKind.entries} would compile and then break at runtime.
 * See ApiSurfaceIsJavaFriendlyTest.
 */
@Stable
public enum FieldKind {
    STRING, NUMBER, INTEGER, BOOLEAN, LIST, OBJECT, ITEM
}
