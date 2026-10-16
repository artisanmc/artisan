package net.artisanmc.modules.api.datasource;

import net.artisanmc.modules.api.annotations.Stable;

/**
 * Whether a data source's <b>key-set</b> (which rows exist) is authorable at design time.
 *
 * <ul>
 *   <li>{@link #STATIC}: a stable, enumerable, finite set. {@code fetcher(null)}
 *       returns the complete, authoritative rows, each identified by the declared
 *       {@link DataSourceDeclaration#getKeyField()}. Field values may still resolve
 *       per player at runtime. A menu slot can <b>place</b> one specific row
 *       (placement mode) or paginate.</li>
 *   <li>{@link #DYNAMIC}: runtime- or player-dependent, unbounded (sales, homes).
 *       No authoritative set at edit time: pagination only.</li>
 * </ul>
 *
 * <p>Java for the same reason as {@link FieldKind}.
 */
@Stable
public enum Stability {
    STATIC, DYNAMIC
}
