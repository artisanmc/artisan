package net.artisanmc.modules.api.translation;

import java.io.File;
import java.util.List;
import java.util.Objects;
import net.artisanmc.modules.api.annotations.Beta;
import net.artisanmc.modules.api.annotations.Stable;
import org.bukkit.plugin.Plugin;
import org.jetbrains.annotations.Nullable;

/**
 * A plugin's system messages (commands, statuses, errors), registered with
 * {@link TranslationsApi#register}: a {@code namespace}, where its translations come from, and
 * optionally a default language of its own.
 *
 * <ul>
 *   <li>{@link #files}: Artisan reads {@code lang/<code>.yml} from the plugin's jar and
 *       {@code plugins/<Plugin>/lang/<code>.yml} from its folder, key by key: a server's file
 *       overrides the keys it holds, the jar answers the others. Artisan never writes them.
 *       {@link #inFolder} reads the server's files from the module's folder instead.</li>
 *   <li>{@link #of}: the plugin reads its files itself ({@link MessageSource}).</li>
 * </ul>
 *
 * <p>The bundle goes away when {@code owner} disables.
 */
@Stable
public final class MessageBundleDeclaration {
    private final Plugin owner;
    private final String namespace;
    private final @Nullable MessageSource source;
    private final List<String> bundledLangs;
    private final @Nullable String defaultLang;
    private final @Nullable File folder;

    private MessageBundleDeclaration(
        Plugin owner,
        String namespace,
        @Nullable MessageSource source,
        List<String> bundledLangs,
        @Nullable String defaultLang,
        @Nullable File folder
    ) {
        this.owner = Objects.requireNonNull(owner, "owner");
        this.namespace = Objects.requireNonNull(namespace, "namespace");
        this.source = source;
        this.bundledLangs = List.copyOf(bundledLangs);
        this.defaultLang = defaultLang;
        this.folder = folder;
    }

    /**
     * Lang files read by Artisan: {@code lang/<code>.yml} in {@code owner}'s jar for each of
     * {@code bundledLangs}, and every {@code lang/*.yml} of its data folder (a server may add a
     * language the jar does not ship).
     */
    public static MessageBundleDeclaration files(Plugin owner, String namespace, String... bundledLangs) {
        return new MessageBundleDeclaration(owner, namespace, null, List.of(bundledLangs), null, null);
    }

    /** Translations read by the plugin itself. */
    public static MessageBundleDeclaration of(Plugin owner, String namespace, MessageSource source) {
        return new MessageBundleDeclaration(owner, namespace, Objects.requireNonNull(source, "source"), List.of(), null, null);
    }

    /**
     * The language of this bundle when the player's is not offered, in place of Artisan's
     * {@code language}: a plugin that has its own {@code language} setting keeps it.
     */
    public MessageBundleDeclaration withDefaultLang(@Nullable String lang) {
        return new MessageBundleDeclaration(owner, namespace, source, bundledLangs, lang, folder);
    }

    /**
     * For {@link #files}: the server's {@code lang/<code>.yml} are read from {@code folder/lang/},
     * the module's folder ({@link net.artisanmc.modules.api.project.ProjectRootRegistry#moduleFolder}),
     * in place of the plugin's data folder. They are then published and versioned with the module,
     * shown in the editor's Translations, and read again when the module's projects reload.
     *
     * <p>The data folder's {@code lang/*.yml} move there once, at {@link TranslationsApi#register}:
     * each file whose name {@code folder/lang/} does not hold yet, the other ones left in place and
     * named in the log. The jar's files still answer the keys the server's lack. Since 2.17.0.
     *
     * @throws IllegalStateException for a declaration made with {@link #of}
     */
    @Beta
    public MessageBundleDeclaration inFolder(File folder) {
        if (source != null) throw new IllegalStateException("inFolder is for files(): this bundle reads its own source");
        return new MessageBundleDeclaration(owner, namespace, null, bundledLangs, defaultLang,
            Objects.requireNonNull(folder, "folder"));
    }

    public Plugin getOwner() {
        return owner;
    }

    public String getNamespace() {
        return namespace;
    }

    /** Null for {@link #files}. */
    public @Nullable MessageSource getSource() {
        return source;
    }

    /** The jar's languages of {@link #files}; empty for {@link #of}. */
    public List<String> getBundledLangs() {
        return bundledLangs;
    }

    /** Null: Artisan's {@code language}. */
    public @Nullable String getDefaultLang() {
        return defaultLang;
    }

    /** The folder whose {@code lang/} holds the server's files ({@link #inFolder}); null: the plugin's data folder. */
    @Beta
    public @Nullable File getFolder() {
        return folder;
    }
}
