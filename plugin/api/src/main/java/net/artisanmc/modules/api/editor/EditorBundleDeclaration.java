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
import java.util.Arrays;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;
import net.artisanmc.modules.api.annotations.Beta;

/**
 * The editor view of a module, shipped in its jar (ADR {@code editor-web-server}, runtime module
 * bundles, level 3): one ES module script built against {@code @artisan/editor-sdk}. The server
 * announces it at Presence ({@code installed_modules[].editor_bundle}), the hub serves it at
 * {@code GET /api/v1/servers/:server/modules/:module/ui.js}, the editor loads it against the SDK
 * version it declares. Immutable; the script is UTF-8 text, at most {@link #MAX_SIZE} bytes.
 */
@Beta
public final class EditorBundleDeclaration {
    /** 4 MiB: the bundle travels whole in one WebSocket message from a leaf to the hub. */
    public static final int MAX_SIZE = 4 * 1024 * 1024;

    private static final Pattern SDK = Pattern.compile("^\\d+\\.\\d+(\\.\\d+)?$");

    private final byte[] script;
    private final String sdk;
    private final String hash;

    /**
     * @param script the bundle, UTF-8 JavaScript (an ES module); copied.
     * @param sdk the {@code @artisan/editor-sdk} version it was built against, {@code MAJOR.MINOR}
     *     or {@code MAJOR.MINOR.PATCH}.
     */
    public EditorBundleDeclaration(byte[] script, String sdk) {
        Objects.requireNonNull(script, "script");
        this.sdk = Objects.requireNonNull(sdk, "sdk");
        if (!SDK.matcher(sdk).matches()) {
            throw new IllegalArgumentException("invalid editor SDK version '" + sdk + "': expected MAJOR.MINOR or MAJOR.MINOR.PATCH");
        }
        if (script.length == 0) throw new IllegalArgumentException("the editor bundle is empty");
        if (script.length > MAX_SIZE) {
            throw new IllegalArgumentException("the editor bundle is " + script.length + " bytes, " + MAX_SIZE + " at most");
        }
        // The hub relays it as JSON text: bytes that are not UTF-8 would not come back the same.
        try {
            StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(script));
        } catch (CharacterCodingException e) {
            throw new IllegalArgumentException("the editor bundle is not UTF-8 text", e);
        }
        this.script = script.clone();
        this.hash = sha256(this.script);
    }

    /**
     * Reads the bundle from {@code loader}'s resources, typically the module jar's
     * ({@code getClass().getClassLoader()}, {@code "artisan-editor/ui.js"}).
     *
     * @throws IllegalArgumentException if the resource is missing, or the script invalid.
     */
    public static EditorBundleDeclaration fromResource(ClassLoader loader, String path, String sdk) {
        Objects.requireNonNull(loader, "loader");
        Objects.requireNonNull(path, "path");
        try (InputStream in = loader.getResourceAsStream(path)) {
            if (in == null) throw new IllegalArgumentException("editor bundle resource '" + path + "' not found");
            byte[] bytes = in.readNBytes(MAX_SIZE + 1);
            return new EditorBundleDeclaration(bytes, sdk);
        } catch (IOException e) {
            throw new UncheckedIOException("cannot read editor bundle resource '" + path + "'", e);
        }
    }

    /** A copy of the script. */
    public byte[] getScript() {
        return script.clone();
    }

    public String getSdk() {
        return sdk;
    }

    /** Lowercase hex SHA-256 of the script: the bundle's identity in the announcement and the cache. */
    public String getHash() {
        return hash;
    }

    /** The script's size in bytes. */
    public int getSize() {
        return script.length;
    }

    /** The {@code editor_bundle} field of an {@code installed_modules} entry: {@code {sdk, hash, size}}. */
    public Map<String, Object> toWire() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("sdk", sdk);
        out.put("hash", hash);
        out.put("size", script.length);
        return out;
    }

    private static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof EditorBundleDeclaration other && sdk.equals(other.sdk) && Arrays.equals(script, other.script);
    }

    @Override
    public int hashCode() {
        return Objects.hash(sdk, hash);
    }

    @Override
    public String toString() {
        return "EditorBundleDeclaration(sdk " + sdk + ", " + script.length + " bytes, " + hash + ")";
    }
}
