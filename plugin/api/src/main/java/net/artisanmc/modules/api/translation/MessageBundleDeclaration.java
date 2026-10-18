package net.artisanmc.modules.api.translation;

import java.util.List;
import java.util.Objects;
import net.artisanmc.modules.api.annotations.Beta;
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
 *       overrides the keys it holds, the jar answers the others. Artisan never writes them.</li>
 *   <li>{@link #of}: the plugin reads its files itself ({@link MessageSource}).</li>
 * </ul>
 *
 * <p>The bundle goes away when {@code owner} disables.
 */
@Beta
public final class MessageBundleDeclaration {
    private final Plugin owner;
    private final String namespace;
    private final @Nullable MessageSource source;
    private final List<String> bundledLangs;
    private final @Nullable String defaultLang;

    private MessageBundleDeclaration(
        Plugin owner,
        String namespace,
        @Nullable MessageSource source,
        List<String> bundledLangs,
        @Nullable String defaultLang
    ) {
        this.owner = Objects.requireNonNull(owner, "owner");
        this.namespace = Objects.requireNonNull(namespace, "namespace");
        this.source = source;
        this.bundledLangs = List.copyOf(bundledLangs);
        this.defaultLang = defaultLang;
    }

    /**
     * Lang files read by Artisan: {@code lang/<code>.yml} in {@code owner}'s jar for each of
     * {@code bundledLangs}, and every {@code lang/*.yml} of its data folder (a server may add a
     * language the jar does not ship).
     */
    public static MessageBundleDeclaration files(Plugin owner, String namespace, String... bundledLangs) {
        return new MessageBundleDeclaration(owner, namespace, null, List.of(bundledLangs), null);
    }

    /** Translations read by the plugin itself. */
    public static MessageBundleDeclaration of(Plugin owner, String namespace, MessageSource source) {
        return new MessageBundleDeclaration(owner, namespace, Objects.requireNonNull(source, "source"), List.of(), null);
    }

    /**
     * The language of this bundle when the player's is not offered, in place of Artisan's
     * {@code language}: a plugin that has its own {@code language} setting keeps it.
     */
    public MessageBundleDeclaration withDefaultLang(@Nullable String lang) {
        return new MessageBundleDeclaration(owner, namespace, source, bundledLangs, lang);
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
}
