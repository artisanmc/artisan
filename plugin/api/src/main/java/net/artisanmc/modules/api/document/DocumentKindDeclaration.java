package net.artisanmc.modules.api.document;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;
import net.artisanmc.modules.api.annotations.Stable;
import net.artisanmc.modules.api.project.ProjectContentApi;
import org.jetbrains.annotations.Nullable;

/**
 * One kind of Document a project folder holds (ADR {@code extensible-document-kinds}, decisions 1
 * and 10): its id, the folder inside a project that holds its files, and the {@code schema:}
 * labels those files may carry. Artisan's own kinds (menu, command, dialog) are declared this
 * way; an add-on declares its own from {@code onEnable} through {@link DocumentKindRegistry}.
 *
 * <p>The folder is what tells a Document's kind on disk, so two kinds may not share one. A file
 * of a declared kind is read by the core as a raw document (its YAML as a map, identified by its
 * file name), listed in the resource inventory, resolvable by reference, and handed to the module
 * through {@link ProjectContentApi#documents}; what it <em>does</em> is the module's business.
 */
@Stable
public final class DocumentKindDeclaration {
    private static final Pattern KIND = Pattern.compile("^[a-z][a-z0-9_]*$");
    private static final Pattern DIR = Pattern.compile("^[a-z][a-z0-9_-]*$");

    private final String kind;
    private final String dir;
    private final List<String> schemaVersions;
    private final @Nullable String idPrefix;

    /** A kind whose files carry one {@code schema:} label. */
    public DocumentKindDeclaration(String kind, String dir, String schemaVersion) {
        this(kind, dir, List.of(schemaVersion), null);
    }

    /**
     * @param kind the kind id ({@code quest}): lowercase, the key of the project's document container.
     * @param dir the folder inside a project, without slash ({@code quests}).
     * @param schemaVersions the {@code schema:} labels a file of this kind may carry; the first one is
     *     canonical, the others are retired labels still read.
     * @param idPrefix what the editor prepends to a new Document's id ({@code quest_}), or null.
     */
    public DocumentKindDeclaration(String kind, String dir, List<String> schemaVersions, @Nullable String idPrefix) {
        this.kind = Objects.requireNonNull(kind, "kind");
        this.dir = Objects.requireNonNull(dir, "dir");
        this.schemaVersions = List.copyOf(Objects.requireNonNull(schemaVersions, "schemaVersions"));
        this.idPrefix = idPrefix;
        if (!KIND.matcher(kind).matches()) {
            throw new IllegalArgumentException("invalid document kind '" + kind + "': expected ^[a-z][a-z0-9_]*$");
        }
        if (!DIR.matcher(dir).matches()) {
            throw new IllegalArgumentException("invalid document kind folder '" + dir + "': expected ^[a-z][a-z0-9_-]*$");
        }
        if (this.schemaVersions.isEmpty()) {
            throw new IllegalArgumentException("document kind '" + kind + "' declares no schema version");
        }
    }

    public String getKind() {
        return kind;
    }

    public String getDir() {
        return dir;
    }

    public List<String> getSchemaVersions() {
        return schemaVersions;
    }

    /** The first declared label: what a file written today carries. */
    public String getCanonicalSchema() {
        return schemaVersions.get(0);
    }

    public @Nullable String getIdPrefix() {
        return idPrefix;
    }

    /** True if a file carrying {@code schema} is of this kind (an empty label is accepted: legacy file). */
    public boolean acceptsSchema(String schema) {
        return schema.isEmpty() || schemaVersions.contains(schema);
    }

    /** The {@code document_kinds} entry of the presence report, without the owner. */
    public Map<String, Object> toWire() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("kind", kind);
        out.put("dir", dir);
        out.put("schema_versions", schemaVersions);
        if (idPrefix != null) out.put("id_prefix", idPrefix);
        return out;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof DocumentKindDeclaration other
            && kind.equals(other.kind) && dir.equals(other.dir)
            && schemaVersions.equals(other.schemaVersions) && Objects.equals(idPrefix, other.idPrefix);
    }

    @Override
    public int hashCode() {
        return Objects.hash(kind, dir, schemaVersions, idPrefix);
    }

    @Override
    public String toString() {
        return "DocumentKindDeclaration(" + kind + ", " + dir + "/, " + schemaVersions + ")";
    }
}
