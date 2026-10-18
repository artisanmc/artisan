package net.artisanmc.modules.api.translation;

import java.util.Map;
import java.util.Set;
import net.artisanmc.modules.api.annotations.Beta;
import net.kyori.adventure.text.Component;
import org.bukkit.command.CommandSender;
import org.jetbrains.annotations.Nullable;

/**
 * The suite's translations of system messages ({@code api.getTranslations()}): one rule for the
 * language of a player, one loader and one renderer for every plugin, each plugin keeping its
 * own lang files under its own namespace ({@link MessageBundle}). Artisan's own messages are
 * the bundle {@code artisan}.
 *
 * <p>The texts of a Project ({@code ltext}, {@code {i18n:key}}) are not here: actions read them
 * with {@code ActionRuntime.text}.
 */
@Beta
public interface TranslationsApi {
    /** Inert default (tests / partial wiring): {@code en}, and bundles that answer the key itself. */
    TranslationsApi NOOP = new TranslationsApi() {
        @Override
        public String getDefaultLang() {
            return "en";
        }

        @Override
        public String langOf(CommandSender sender) {
            return "en";
        }

        @Override
        public MessageBundle register(MessageBundleDeclaration declaration) {
            String namespace = declaration.getNamespace();
            return new MessageBundle() {
                @Override
                public String getNamespace() {
                    return namespace;
                }

                @Override
                public Set<String> getLanguages() {
                    return Set.of();
                }

                @Override
                public String getDefaultLang() {
                    return "en";
                }

                @Override
                public String langOf(CommandSender viewer) {
                    return "en";
                }

                @Override
                public @Nullable String find(String lang, String key) {
                    return null;
                }

                @Override
                public String raw(String lang, String key) {
                    return key;
                }

                @Override
                public String format(String template, Map<String, ?> placeholders) {
                    return template;
                }

                @Override
                public Component get(String lang, String key, Map<String, ?> placeholders) {
                    return Component.text(key);
                }

                @Override
                public void reload() {}
            };
        }

        @Override
        public void unregister(String namespace) {}

        @Override
        public @Nullable MessageBundle bundle(String namespace) {
            return null;
        }

        @Override
        public Set<String> namespaces() {
            return Set.of();
        }
    };

    /** Artisan's {@code language} ({@code config.yml}). */
    String getDefaultLang();

    /**
     * The language asked for {@code sender}: its client language ({@code fr}, {@code en}...)
     * when {@code per_player_language} is on and it is a player, else {@link #getDefaultLang()}.
     * Whether a bundle has it is {@link MessageBundle#langOf}'s business.
     */
    String langOf(CommandSender sender);

    /**
     * Registers and loads a bundle. {@code namespace} is a lowercase identifier
     * ({@code [a-z][a-z0-9_]*}). Throws {@link IllegalArgumentException} for a malformed
     * namespace, {@link IllegalStateException} for one already registered.
     */
    MessageBundle register(MessageBundleDeclaration declaration);

    /** Removes the bundle. Unknown namespaces are ignored. */
    void unregister(String namespace);

    @Nullable MessageBundle bundle(String namespace);

    Set<String> namespaces();
}
