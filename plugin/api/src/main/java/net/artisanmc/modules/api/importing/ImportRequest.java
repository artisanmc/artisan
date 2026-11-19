package net.artisanmc.modules.api.importing;

import java.nio.file.Path;
import java.util.Map;
import java.util.Objects;
import net.artisanmc.modules.api.annotations.Beta;
import org.jetbrains.annotations.Nullable;

/**
 * One run of an {@link Importer}: the batch id Artisan gave it, the file the admin named (for a
 * source that reads one, such as the canonical JSON), free options, and the language the
 * report's texts should be in.
 */
@Beta
public final class ImportRequest {
    private final String batch;
    private final @Nullable Path file;
    private final Map<String, String> options;
    private final String lang;

    public ImportRequest(String batch, @Nullable Path file, Map<String, String> options, String lang) {
        this.batch = Objects.requireNonNull(batch, "batch");
        this.file = file;
        this.options = Map.copyOf(options);
        this.lang = Objects.requireNonNull(lang, "lang");
    }

    /** Unique per run; the module stores it with each record it writes, for {@link Importer#rollback}. */
    public String getBatch() {
        return batch;
    }

    /** The file to read, already resolved inside {@code plugins/Artisan/imports/}; null when the admin named none. */
    public @Nullable Path getFile() {
        return file;
    }

    public Map<String, String> getOptions() {
        return options;
    }

    /** Language of the admin who asked ({@code en}, {@code fr}…), for the labels and messages of the report. */
    public String getLang() {
        return lang;
    }
}
