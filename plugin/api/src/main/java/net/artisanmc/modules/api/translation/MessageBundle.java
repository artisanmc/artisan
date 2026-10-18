package net.artisanmc.modules.api.translation;

import java.util.Map;
import java.util.Set;
import net.artisanmc.modules.api.annotations.Beta;
import net.kyori.adventure.text.Component;
import org.bukkit.command.CommandSender;
import org.jetbrains.annotations.Nullable;

/**
 * A plugin's system messages, registered with {@link TranslationsApi#register}. Every method may
 * be called from any thread.
 *
 * <p><b>Language.</b> {@link #langOf} picks, among this bundle's languages, the one asked by
 * {@link TranslationsApi#langOf} (the player's client language when {@code per_player_language}
 * is on), else this bundle's default, else {@code en}. A code matches its region variants:
 * {@code fr} finds {@code fr_FR} and the reverse.
 *
 * <p><b>Missing key.</b> {@link #raw} falls back to the bundle's default language, then
 * {@code en}, then returns the key itself.
 *
 * <p><b>Placeholders.</b> {@link #format} replaces {@code <name>}, {@code {name}} and
 * {@code %name%} for each entry of the map, with the value as plain text: its MiniMessage tags
 * are escaped, so a player-typed value cannot inject a click or a color. Names absent from the
 * map are left alone (a PlaceholderAPI {@code %x%} stays for PlaceholderAPI).
 */
@Beta
public interface MessageBundle {
    String getNamespace();

    /** The languages this bundle holds ({@code en}, {@code fr_FR}...), as its source names them. */
    Set<String> getLanguages();

    /** This bundle's default language, as it holds it (Artisan's {@code language} unless declared). */
    String getDefaultLang();

    /** The language {@code viewer} reads this bundle in. */
    String langOf(CommandSender viewer);

    /** The text of {@code key} in {@code lang} exactly, null when that language lacks it. */
    @Nullable String find(String lang, String key);

    /** The raw MiniMessage text of {@code key} in {@code lang}, with the fallbacks above. */
    String raw(String lang, String key);

    default String raw(CommandSender viewer, String key) {
        return raw(langOf(viewer), key);
    }

    /** {@code template} with the placeholders above replaced, still MiniMessage. */
    String format(String template, Map<String, ?> placeholders);

    /** {@link #raw}, {@link #format}ted and parsed. */
    Component get(String lang, String key, Map<String, ?> placeholders);

    default Component get(CommandSender viewer, String key, Map<String, ?> placeholders) {
        return get(langOf(viewer), key, placeholders);
    }

    default Component get(CommandSender viewer, String key) {
        return get(langOf(viewer), key, Map.of());
    }

    /** Reads the translations again; on a failure (logged) the previous ones stay. */
    void reload();
}
