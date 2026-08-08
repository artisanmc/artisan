package net.artisanmc.modules.api;

import net.artisanmc.modules.api.annotations.Stable;

/**
 * Whether a data source's <b>key-set</b> (which rows exist) is authorable at design time.
 *
 * <ul>
 *   <li>{@link #STATIC} : ensemble stable, énumérable, fini — {@code fetcher(null)}
 *       renvoie les lignes complètes et faisant autorité, chacune identifiée par le
 *       {@link DataSourceDeclaration#getKeyField()} déclaré. Les valeurs de champ
 *       peuvent malgré tout se résoudre par joueur au runtime. Un slot de menu peut
 *       <b>placer</b> une ligne précise (mode placement) ou paginer.</li>
 *   <li>{@link #DYNAMIC} : dépendant du runtime ou du joueur, non borné (ventes,
 *       homes). Aucun ensemble faisant autorité à l'édition — pagination seulement.</li>
 * </ul>
 *
 * <p>En Java pour la même raison que {@link FieldKind}.
 */
@Stable
public enum Stability {
    STATIC, DYNAMIC
}
