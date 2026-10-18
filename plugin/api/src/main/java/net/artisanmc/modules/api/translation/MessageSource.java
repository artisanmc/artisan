package net.artisanmc.modules.api.translation;

import java.util.Map;
import net.artisanmc.modules.api.annotations.Beta;

/**
 * Reads a bundle's translations ({@link MessageBundleDeclaration#of}): one flat table per
 * language, {@code lang -> (dotted key -> MiniMessage text)}, for a plugin that keeps its own
 * lang files (its own format, its own updater).
 *
 * <p>Called by {@link TranslationsApi#register} and by each {@link MessageBundle#reload()}, on
 * the calling thread. A source that throws leaves the bundle's previous translations in place.
 */
@Beta
@FunctionalInterface
public interface MessageSource {
    Map<String, Map<String, String>> load() throws Exception;
}
