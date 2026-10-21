package net.artisanmc.modules.api.template;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;
import net.artisanmc.modules.api.annotations.Beta;
import org.jetbrains.annotations.Nullable;

/**
 * Example content a module ships in its jar: project files (menus, Documents of its kinds,
 * {@code lang/}) the editor copies into <b>any</b> project on request, and that Artisan may copy
 * once into a project of its own on first start ({@link #getSeedProject()}).
 *
 * <p>Once copied, the files belong to the server's owner: edited, renamed or deleted like any
 * other. Artisan remembers where each copied file came from (its template, version and hash, in
 * the project's {@code .artisan/origins.yaml}), so the editor can tell an untouched copy from a
 * modified one when the module ships a new version, and restore the shipped version on request.
 *
 * <p>A <b>system</b> template ({@link Builder#system()}, 2.12.0) holds the module's system
 * elements instead: the menus and dialogs its code opens by id. Artisan keeps them in the
 * module's folder whatever the owner does: a missing file is written again, an untouched copy
 * follows each new version, and an edited one stays the owner's version until reset in the
 * editor. Never deleted, never renamed.
 *
 * <p>Immutable. Paths are relative to the project, with {@code /}; at most {@link #MAX_SIZE}
 * bytes in all, since the files travel in one message from a server to the hub.
 */
@Beta
public final class TemplateDeclaration {
    /** 4 MiB, like an editor bundle. */
    public static final int MAX_SIZE = 4 * 1024 * 1024;

    private static final String MANIFEST = "manifest.yaml";
    private static final Pattern ID = Pattern.compile("^[a-z][a-z0-9_]*$");
    private static final Pattern PROJECT = Pattern.compile("^[a-z0-9][a-z0-9_-]*$");
    private static final Pattern SEGMENT = Pattern.compile("^[A-Za-z0-9_][A-Za-z0-9_.-]*$");

    private final String id;
    private final String title;
    private final int version;
    private final @Nullable String seedProject;
    private final boolean system;
    private final Map<String, byte[]> files;
    private final Map<String, String> hashes;

    private TemplateDeclaration(Builder b) {
        this.id = b.id;
        this.title = b.title != null ? b.title : b.id;
        this.version = b.version;
        this.seedProject = b.seedProject;
        this.system = b.system;
        if (system && seedProject != null) {
            throw new IllegalArgumentException("template '" + id + "': a system template lives in its module's folder, it seeds no project");
        }
        if (b.files.isEmpty()) throw new IllegalArgumentException("template '" + id + "' has no file");
        long total = 0;
        Map<String, byte[]> files = new LinkedHashMap<>();
        Map<String, String> hashes = new LinkedHashMap<>();
        for (Map.Entry<String, byte[]> e : b.files.entrySet()) {
            total += e.getValue().length;
            files.put(e.getKey(), e.getValue().clone());
            hashes.put(e.getKey(), sha256(e.getValue()));
        }
        if (total > MAX_SIZE) {
            throw new IllegalArgumentException("template '" + id + "' is " + total + " bytes, " + MAX_SIZE + " at most");
        }
        this.files = files;
        this.hashes = hashes;
    }

    /**
     * @param id the template id, unique within its module: lowercase, {@code ^[a-z][a-z0-9_]*$}.
     * @param version raised by the module each time it changes the files (1, 2, …); the editor
     *     offers the new files to the copies made from an older version.
     */
    public static Builder builder(String id, int version) {
        return new Builder(id, version);
    }

    /**
     * Reads {@code paths} from {@code loader}'s resources under {@code root}, typically the module
     * jar's ({@code getClass().getClassLoader()}, {@code "artisan-templates/daily"}): the file
     * {@code root + "/" + path} becomes the project file {@code path}.
     *
     * @throws IllegalArgumentException if a resource is missing, or the template invalid.
     */
    public static Builder fromResources(ClassLoader loader, String root, String id, int version, List<String> paths) {
        Objects.requireNonNull(loader, "loader");
        Objects.requireNonNull(root, "root");
        Builder builder = builder(id, version);
        String prefix = root.endsWith("/") ? root : root + "/";
        for (String path : paths) {
            try (InputStream in = loader.getResourceAsStream(prefix + path)) {
                if (in == null) throw new IllegalArgumentException("template resource '" + prefix + path + "' not found");
                builder.file(path, in.readNBytes(MAX_SIZE + 1));
            } catch (IOException e) {
                throw new UncheckedIOException("cannot read template resource '" + prefix + path + "'", e);
            }
        }
        return builder;
    }

    public String getId() {
        return id;
    }

    /** What the editor shows ("Daily quests"); the id when none was given. */
    public String getTitle() {
        return title;
    }

    public int getVersion() {
        return version;
    }

    /**
     * The project Artisan creates with these files on the first start that knows this template,
     * or null: the template is only offered in the editor. Done once per template and server,
     * never again, even when that project is later deleted.
     */
    public @Nullable String getSeedProject() {
        return seedProject;
    }

    /**
     * True for the module's system elements: kept in the module's folder (its first by name)
     * at every start, an untouched copy updated to each new version, never deleted.
     */
    @Beta
    public boolean isSystem() {
        return system;
    }

    /** The project-relative paths, in declaration order. */
    public List<String> getPaths() {
        return List.copyOf(files.keySet());
    }

    /** A copy of the file at {@code path}, or null. */
    public byte @Nullable [] getFile(String path) {
        byte[] bytes = files.get(path);
        return bytes != null ? bytes.clone() : null;
    }

    /** Lowercase hex SHA-256 of the file at {@code path}, or null. */
    public @Nullable String getHash(String path) {
        return hashes.get(path);
    }

    /**
     * The {@code templates} entry of the module's {@code installed_modules} entry:
     * {@code {id, title, version, seed_project?, system?, files: [{path, hash, size}]}}.
     */
    public Map<String, Object> toWire() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", id);
        out.put("title", title);
        out.put("version", version);
        if (seedProject != null) out.put("seed_project", seedProject);
        if (system) out.put("system", true);
        List<Map<String, Object>> list = new ArrayList<>();
        for (Map.Entry<String, byte[]> e : files.entrySet()) {
            Map<String, Object> file = new LinkedHashMap<>();
            file.put("path", e.getKey());
            file.put("hash", hashes.get(e.getKey()));
            file.put("size", e.getValue().length);
            list.add(file);
        }
        out.put("files", list);
        return out;
    }

    /** Lowercase hex SHA-256, the hash Artisan compares a project file against. */
    public static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof TemplateDeclaration other)) return false;
        return id.equals(other.id) && version == other.version && title.equals(other.title)
            && Objects.equals(seedProject, other.seedProject) && system == other.system && hashes.equals(other.hashes);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id, version, hashes);
    }

    @Override
    public String toString() {
        return "TemplateDeclaration(" + id + " v" + version + ", " + files.size() + " files)";
    }

    /** Assembles a {@link TemplateDeclaration}. */
    @Beta
    public static final class Builder {
        private final String id;
        private final int version;
        private @Nullable String title;
        private @Nullable String seedProject;
        private boolean system;
        private final Map<String, byte[]> files = new LinkedHashMap<>();

        private Builder(String id, int version) {
            this.id = Objects.requireNonNull(id, "id");
            if (!ID.matcher(id).matches()) {
                throw new IllegalArgumentException("invalid template id '" + id + "': expected ^[a-z][a-z0-9_]*$");
            }
            if (version < 1) throw new IllegalArgumentException("template '" + id + "': version must be 1 or more");
            this.version = version;
        }

        public Builder title(String title) {
            this.title = Objects.requireNonNull(title, "title");
            return this;
        }

        /** Copy the files once into a new project {@code projectId} (see {@link #getSeedProject()}). */
        public Builder seed(String projectId) {
            Objects.requireNonNull(projectId, "projectId");
            if (!PROJECT.matcher(projectId).matches()) {
                throw new IllegalArgumentException("invalid seed project '" + projectId + "': expected ^[a-z0-9][a-z0-9_-]*$");
            }
            this.seedProject = projectId;
            return this;
        }

        /**
         * Makes these files the module's system elements (see {@link #isSystem()}): its menus
         * and dialogs, which its code opens by id. Not with {@link #seed(String)}.
         */
        @Beta
        public Builder system() {
            this.system = true;
            return this;
        }

        /**
         * Adds the project file {@code path} ({@code menus/daily.yaml}). A path is relative, with
         * {@code /}, made of plain segments: no {@code ..}, no leading dot, and never the
         * {@code .artisan*} metadata. Never {@code manifest.yaml} either: a project's manifest is
         * its own, so a copy into an existing project would always conflict on it. A seeded
         * project gets one in the server's language.
         */
        public Builder file(String path, byte[] content) {
            Objects.requireNonNull(path, "path");
            Objects.requireNonNull(content, "content");
            if (!validPath(path)) throw new IllegalArgumentException("invalid template path '" + path + "'");
            if (path.equals(MANIFEST)) {
                throw new IllegalArgumentException("a template never ships " + MANIFEST + ": the project's own one stays");
            }
            if (files.containsKey(path)) throw new IllegalArgumentException("template path '" + path + "' given twice");
            files.put(path, content.clone());
            return this;
        }

        public TemplateDeclaration build() {
            return new TemplateDeclaration(this);
        }

        private static boolean validPath(String path) {
            if (path.isEmpty() || path.startsWith("/") || path.endsWith("/")) return false;
            return Arrays.stream(path.split("/")).allMatch(s -> SEGMENT.matcher(s).matches());
        }
    }
}
