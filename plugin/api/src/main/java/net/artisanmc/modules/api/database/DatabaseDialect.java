package net.artisanmc.modules.api.database;

import net.artisanmc.modules.api.annotations.Stable;
import net.artisanmc.modules.api.datasource.FieldKind;

/**
 * SQL dialect behind {@link DatabaseApi#dataSource}, chosen by the server admin in
 * {@code environment.yml}. A plugin that targets several of them branches on it for
 * the few statements that differ (upserts, auto-increment DDL).
 *
 * <p>Java for the same reason as {@link FieldKind}: a Kotlin enum would expose
 * {@code kotlin.enums.EnumEntries} in the public surface.
 */
@Stable
public enum DatabaseDialect {
    H2, MYSQL, MARIADB
}
