package net.artisanmc.modules.api.datasource;

import net.artisanmc.modules.api.annotations.Stable;

/**
 * Where a data source's rows come from, which tells the editor what a preview of the source
 * should show while an admin edits a draft (API 2.19.0).
 *
 * <ul>
 *   <li>{@link #RUNTIME} (default): state that only exists on the server (sales, guild members,
 *       a balance). The editor shows the server's rows.</li>
 *   <li>{@link #CONTENT}: derived from the Project's files (a shop's catalogue, quest
 *       definitions). The editor computes the rows from the draft when the module's editor view
 *       can ({@code FrontendModule.localPreviewRows}); otherwise it shows the server's rows marked
 *       as the deployed version.</li>
 *   <li>{@link #MIXED}: definitions from the Project's files joined to per-player state from
 *       the server (a player's active quests). The editor hands the server's rows to the module's
 *       editor view, which replaces their definition fields with the draft's, matched by
 *       {@link DataSourceDeclaration#getKeyField()}.</li>
 * </ul>
 *
 * <p>Java for the same reason as {@link FieldKind}.
 */
@Stable
public enum Origin {
    RUNTIME, CONTENT, MIXED
}
