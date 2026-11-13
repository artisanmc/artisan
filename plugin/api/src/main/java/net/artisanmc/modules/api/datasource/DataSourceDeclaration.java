package net.artisanmc.modules.api.datasource;

import java.util.List;
import java.util.Objects;
import net.artisanmc.modules.api.annotations.Beta;
import net.artisanmc.modules.api.annotations.Stable;
import org.jetbrains.annotations.Nullable;

/**
 * Declares a data source a module exposes to the rest of the system.
 *
 * <ul>
 *   <li>{@code ref}: globally unique reference, {@code "namespace:id"} ({@code "shop:items"}).</li>
 *   <li>{@code fetcher}: returns rows for a player and params; see {@link DataFetcher}.</li>
 *   <li>{@code schema}: declared row fields, powering the editor's schema table and filter
 *       autocomplete. Empty = undeclared (the editor falls back to free input).</li>
 *   <li>{@code stability}: whether the row key-set is authorable at design time
 *       ({@link Stability}). {@link Stability#DYNAMIC} unless the source opts into
 *       {@link Stability#STATIC} and declares a {@code keyField}.</li>
 *   <li>{@code keyField}: name of the schema field identifying each row (the Row key).
 *       Required when {@code stability} is {@link Stability#STATIC} or {@code origin} is
 *       {@link Origin#MIXED}; null otherwise.</li>
 *   <li>{@code origin}: whether the rows are server state, Project content or both
 *       ({@link Origin}). {@link Origin#RUNTIME} unless the source says otherwise.</li>
 *   <li>{@code aliases}: former refs the source still answers to ({@link #withAliases}).</li>
 * </ul>
 */
@Stable
public final class DataSourceDeclaration {
    private final String ref;
    private final DataFetcher fetcher;
    private final List<DataSourceField> schema;
    private final Stability stability;
    private final @Nullable String keyField;
    private final Origin origin;
    private final List<String> aliases;

    public DataSourceDeclaration(String ref, DataFetcher fetcher) {
        this(ref, fetcher, List.of(), Stability.DYNAMIC, null);
    }

    public DataSourceDeclaration(String ref, DataFetcher fetcher, List<DataSourceField> schema) {
        this(ref, fetcher, schema, Stability.DYNAMIC, null);
    }

    /** Throws {@link IllegalArgumentException} for a {@link Stability#STATIC} source without a key field. */
    public DataSourceDeclaration(
        String ref,
        DataFetcher fetcher,
        List<DataSourceField> schema,
        Stability stability,
        @Nullable String keyField
    ) {
        this(ref, fetcher, schema, stability, keyField, Origin.RUNTIME);
    }

    /**
     * Throws {@link IllegalArgumentException} for a {@link Stability#STATIC} or {@link Origin#MIXED}
     * source without a key field: a mixed source's rows are joined to the draft by that key.
     */
    public DataSourceDeclaration(
        String ref,
        DataFetcher fetcher,
        List<DataSourceField> schema,
        Stability stability,
        @Nullable String keyField,
        Origin origin
    ) {
        this(ref, fetcher, schema, stability, keyField, origin, List.of());
    }

    private DataSourceDeclaration(
        String ref,
        DataFetcher fetcher,
        List<DataSourceField> schema,
        Stability stability,
        @Nullable String keyField,
        Origin origin,
        List<String> aliases
    ) {
        this.aliases = List.copyOf(aliases);
        this.ref = Objects.requireNonNull(ref, "ref");
        this.fetcher = Objects.requireNonNull(fetcher, "fetcher");
        this.schema = List.copyOf(Objects.requireNonNull(schema, "schema"));
        this.stability = Objects.requireNonNull(stability, "stability");
        this.keyField = keyField;
        this.origin = Objects.requireNonNull(origin, "origin");
        if (stability == Stability.STATIC && (keyField == null || keyField.isBlank())) {
            throw new IllegalArgumentException(
                "Static data source '" + ref + "' must declare a keyField (the Row key identifying each row)");
        }
        if (origin == Origin.MIXED && (keyField == null || keyField.isBlank())) {
            throw new IllegalArgumentException(
                "Mixed data source '" + ref + "' must declare a keyField (joins the server's rows to the draft)");
        }
    }

    public String getRef() {
        return ref;
    }

    public DataFetcher getFetcher() {
        return fetcher;
    }

    public List<DataSourceField> getSchema() {
        return schema;
    }

    public Stability getStability() {
        return stability;
    }

    public @Nullable String getKeyField() {
        return keyField;
    }

    public Origin getOrigin() {
        return origin;
    }

    /**
     * The same source under former refs as well: a menu written against {@code msquests:groups}
     * keeps reading it once the source is {@code quests:groups}. An alias answers
     * {@link DataSourceRegistry#fetch} and {@link DataSourceRegistry#has} like the ref, and is
     * listed nowhere ({@link DataSourceRegistry#refs}, the editor's picker): new content uses the ref.
     *
     * @throws IllegalArgumentException for a blank alias, or one equal to the ref
     * @since 1.2.0
     */
    @Beta
    public DataSourceDeclaration withAliases(String... aliases) {
        for (String alias : aliases) {
            if (alias == null || alias.isBlank() || alias.equals(ref)) {
                throw new IllegalArgumentException("Data source '" + ref + "': an alias is another, non-blank ref");
            }
        }
        return new DataSourceDeclaration(ref, fetcher, schema, stability, keyField, origin, List.of(aliases));
    }

    /** The former refs this source still answers to; empty for most. @since 1.2.0 */
    @Beta
    public List<String> getAliases() {
        return aliases;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof DataSourceDeclaration other
            && ref.equals(other.ref) && fetcher.equals(other.fetcher) && schema.equals(other.schema)
            && stability == other.stability && Objects.equals(keyField, other.keyField)
            && origin == other.origin && aliases.equals(other.aliases);
    }

    @Override
    public int hashCode() {
        return Objects.hash(ref, fetcher, schema, stability, keyField, origin, aliases);
    }

    @Override
    public String toString() {
        return "DataSourceDeclaration(ref=" + ref + ", schema=" + schema + ", stability=" + stability
            + ", keyField=" + keyField + ", origin=" + origin + ")";
    }
}
