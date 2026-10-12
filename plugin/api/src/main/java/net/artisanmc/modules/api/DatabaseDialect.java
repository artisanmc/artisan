package net.artisanmc.modules.api;

import net.artisanmc.modules.api.annotations.Beta;

/**
 * SQL dialect behind {@link DatabaseApi#dataSource}, chosen by the server admin in
 * {@code environment.yml}. A plugin that targets several of them branches on it for
 * the few statements that differ (upserts, auto-increment DDL).
 *
 * <p>En Java pour la même raison que {@link FieldKind} : un enum Kotlin exposerait
 * {@code kotlin.enums.EnumEntries} dans la surface publique.
 */
@Beta
public enum DatabaseDialect {
    H2, MYSQL, MARIADB
}
