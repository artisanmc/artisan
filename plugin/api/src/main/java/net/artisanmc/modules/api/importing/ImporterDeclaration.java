package net.artisanmc.modules.api.importing;

import java.util.List;
import java.util.Objects;
import java.util.regex.Pattern;
import net.artisanmc.modules.api.annotations.Beta;

/**
 * One source a module imports from, registered with {@link ImportRegistry}: {@code auctions:zauctionhouse},
 * {@code auctions:json}. The id's namespace is the module that registers it.
 *
 * @param id          {@code <module>:<source>}, lowercase, {@code [a-z0-9_-]}
 * @param label       shown in {@code /artisan import list} ({@code "zAuctionHouse v4"})
 * @param conflicts   plugin names (case-insensitive prefixes) that must not be running for
 *                    {@link Importer#apply}: the source plugin, which could hand the same items out twice
 * @param readsFile   true when the source reads a file the admin names (the canonical JSON)
 * @param importer    the module's implementation
 */
@Beta
public record ImporterDeclaration(String id, String label, List<String> conflicts, boolean readsFile, Importer importer) {
    private static final Pattern ID = Pattern.compile("^[a-z][a-z0-9_]*:[a-z0-9][a-z0-9_-]*$");

    public ImporterDeclaration {
        Objects.requireNonNull(id, "id");
        if (!ID.matcher(id).matches()) throw new IllegalArgumentException("import source id '" + id + "' is not <module>:<source>");
        Objects.requireNonNull(label, "label");
        conflicts = List.copyOf(conflicts);
        Objects.requireNonNull(importer, "importer");
    }

    /** The module part of {@link #id()}. */
    public String module() {
        return id.substring(0, id.indexOf(':'));
    }
}
