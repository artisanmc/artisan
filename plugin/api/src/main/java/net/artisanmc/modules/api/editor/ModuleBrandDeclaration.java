package net.artisanmc.modules.api.editor;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import net.artisanmc.modules.api.annotations.Beta;
import org.jetbrains.annotations.Nullable;

/**
 * A module's look in the editor, shipped in its jar: its icon and its logo, pixel art drawn as
 * SVG. The server announces it at Presence ({@code installed_modules[].brand}), the hub serves
 * each file at {@code GET /api/v1/servers/:server/modules/:module/brand/:file.svg}, the editor
 * shows the icon at the head of the module's home and the logo beside it; the wordmark, when
 * there is one, replaces Artisan's at the top of the sidebar while the module is open.
 *
 * <p>Files, by name: {@code icon} (square, 16×16 grid), {@code logo-dark} and {@code logo-light}
 * (the full logo for a dark or a light theme), {@code wordmark-dark} and {@code wordmark-light}
 * (Artisan's 39×8 wordmark in the module's colours). Any subset, at least one; each a static SVG
 * of at most {@link #MAX_FILE_SIZE} bytes, with no script, event handler, {@code javascript:}
 * link or {@code foreignObject}. Immutable.
 */
@Beta
public final class ModuleBrandDeclaration {
    /** 64 KiB per file: an icon or a logo, not a picture. */
    public static final int MAX_FILE_SIZE = 64 * 1024;

    /** The file names a brand may carry, in wire order. */
    public static final List<String> FILES = List.of("icon", "logo-dark", "logo-light", "wordmark-dark", "wordmark-light");

    private static final Pattern FORBIDDEN = Pattern.compile(
        "<\\s*script|<\\s*foreignobject|javascript:|\\son[a-z]+\\s*=|<\\s*iframe|<\\s*embed|<\\s*object", Pattern.CASE_INSENSITIVE);
    private static final Pattern VIEW_BOX = Pattern.compile(
        "viewBox\\s*=\\s*\"\\s*0\\s+0\\s+(\\d+)\\s+(\\d+)\\s*\"");

    private final Map<String, byte[]> files;
    private final String hash;
    private final @Nullable int[] logoSize;

    /**
     * @param files SVG text by file name ({@link #FILES}); copied.
     * @throws IllegalArgumentException if empty, a name is unknown, or a file is not a static
     *     UTF-8 SVG within {@link #MAX_FILE_SIZE}.
     */
    public ModuleBrandDeclaration(Map<String, byte[]> files) {
        Objects.requireNonNull(files, "files");
        if (files.isEmpty()) throw new IllegalArgumentException("a module brand carries at least one file");
        Map<String, byte[]> copy = new LinkedHashMap<>();
        for (String name : FILES) {
            byte[] bytes = files.get(name);
            if (bytes == null) continue;
            copy.put(name, checked(name, bytes));
        }
        for (String name : files.keySet()) {
            if (!FILES.contains(name)) throw new IllegalArgumentException("unknown module brand file '" + name + "', expected one of " + FILES);
        }
        this.files = Collections.unmodifiableMap(copy);
        this.hash = sha256(copy);
        byte[] logo = copy.containsKey("logo-dark") ? copy.get("logo-dark") : copy.get("logo-light");
        this.logoSize = logo == null ? null : viewBox(new String(logo, StandardCharsets.UTF_8));
    }

    /**
     * Reads {@code <dir>/<name>.svg} for each name of {@link #FILES} from {@code loader}'s
     * resources, typically the module jar's ({@code getClass().getClassLoader()},
     * {@code "artisan-brand"}); a missing file is left out.
     *
     * @throws IllegalArgumentException if none is found, or a file is invalid.
     */
    public static ModuleBrandDeclaration fromResources(ClassLoader loader, String dir) {
        Objects.requireNonNull(loader, "loader");
        Objects.requireNonNull(dir, "dir");
        String base = dir.endsWith("/") ? dir : dir + "/";
        Map<String, byte[]> found = new LinkedHashMap<>();
        for (String name : FILES) {
            String path = base + name + ".svg";
            try (InputStream in = loader.getResourceAsStream(path)) {
                if (in != null) found.put(name, in.readNBytes(MAX_FILE_SIZE + 1));
            } catch (IOException e) {
                throw new UncheckedIOException("cannot read module brand resource '" + path + "'", e);
            }
        }
        if (found.isEmpty()) throw new IllegalArgumentException("no module brand file under '" + base + "'");
        return new ModuleBrandDeclaration(found);
    }

    /** The file names it carries, in {@link #FILES} order. */
    public List<String> getFileNames() {
        return new ArrayList<>(files.keySet());
    }

    /** A copy of the SVG of {@code name}, or null when it does not carry that file. */
    public byte @Nullable [] getFile(String name) {
        byte[] bytes = files.get(name);
        return bytes == null ? null : bytes.clone();
    }

    /** Lowercase hex SHA-256 over the files, names included: the brand's identity in the announcement and the cache. */
    public String getHash() {
        return hash;
    }

    /** The logo's grid ({@code viewBox="0 0 width height"}), {@code [width, height]}, or null without a logo or a plain viewBox. */
    public int @Nullable [] getLogoSize() {
        return logoSize == null ? null : logoSize.clone();
    }

    /** The {@code brand} field of an {@code installed_modules} entry: {@code {hash, files, logo?: {width, height}}}. */
    public Map<String, Object> toWire() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("hash", hash);
        out.put("files", getFileNames());
        if (logoSize != null) out.put("logo", Map.of("width", logoSize[0], "height", logoSize[1]));
        return out;
    }

    /** The files as text by name, the payload of a brand fetch. */
    public Map<String, String> texts() {
        Map<String, String> out = new LinkedHashMap<>();
        files.forEach((name, bytes) -> out.put(name, new String(bytes, StandardCharsets.UTF_8)));
        return out;
    }

    private static byte[] checked(String name, byte[] bytes) {
        if (bytes.length == 0) throw new IllegalArgumentException("module brand file '" + name + "' is empty");
        if (bytes.length > MAX_FILE_SIZE) {
            throw new IllegalArgumentException("module brand file '" + name + "' is " + bytes.length + " bytes, " + MAX_FILE_SIZE + " at most");
        }
        String text;
        try {
            text = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes))
                .toString();
        } catch (CharacterCodingException e) {
            throw new IllegalArgumentException("module brand file '" + name + "' is not UTF-8 text", e);
        }
        if (!text.toLowerCase(Locale.ROOT).contains("<svg")) {
            throw new IllegalArgumentException("module brand file '" + name + "' is not an SVG");
        }
        if (FORBIDDEN.matcher(text).find()) {
            throw new IllegalArgumentException("module brand file '" + name + "' is not a static SVG (script, event handler, link or embedded content)");
        }
        return bytes.clone();
    }

    private static int @Nullable [] viewBox(String svg) {
        Matcher m = VIEW_BOX.matcher(svg);
        if (!m.find()) return null;
        try {
            int w = Integer.parseInt(m.group(1));
            int h = Integer.parseInt(m.group(2));
            return w > 0 && h > 0 ? new int[] {w, h} : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static String sha256(Map<String, byte[]> files) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            for (Map.Entry<String, byte[]> e : files.entrySet()) {
                digest.update(e.getKey().getBytes(StandardCharsets.UTF_8));
                digest.update((byte) 0);
                digest.update(e.getValue());
                digest.update((byte) 0);
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof ModuleBrandDeclaration other && hash.equals(other.hash);
    }

    @Override
    public int hashCode() {
        return hash.hashCode();
    }

    @Override
    public String toString() {
        return "ModuleBrandDeclaration(" + files.keySet() + ", " + hash + ")";
    }
}
