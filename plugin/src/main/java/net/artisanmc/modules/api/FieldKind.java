package net.artisanmc.modules.api;

import net.artisanmc.modules.api.annotations.Stable;

/**
 * Row-field kinds a data source can declare in its {@link DataSourceDeclaration#getSchema()}.
 *
 * <p>Déclaré en Java, pas en Kotlin : un enum Kotlin expose un
 * {@code getEntries()} qui renvoie {@code kotlin.enums.EnumEntries}. Ce type
 * serait relocalisé par le shadowJar alors que le JAR d'API publié, lui, ne
 * l'est pas — un add-on Kotlin écrivant {@code FieldKind.entries} compilerait
 * puis casserait au runtime. Cf. ApiSurfaceIsJavaFriendlyTest.
 */
@Stable
public enum FieldKind {
    STRING, NUMBER, INTEGER, BOOLEAN, LIST, OBJECT, ITEM
}
