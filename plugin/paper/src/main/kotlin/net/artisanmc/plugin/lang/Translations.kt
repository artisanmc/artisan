package net.artisanmc.plugin.lang

import net.artisanmc.modules.api.translation.MessageBundle
import net.artisanmc.modules.api.translation.MessageBundleDeclaration
import net.artisanmc.modules.api.translation.TranslationsApi
import org.bukkit.command.CommandSender
import org.bukkit.configuration.file.YamlConfiguration
import org.bukkit.entity.Player
import org.bukkit.plugin.Plugin
import java.io.File
import java.io.InputStreamReader
import java.util.concurrent.ConcurrentHashMap
import java.util.logging.Level
import java.util.logging.Logger

/**
 * The suite's system-message translations (API [TranslationsApi]). One instance for the
 * plugin's life: [configure] applies `language` / `per_player_language` again on
 * `/artisan reload`, and every bundle reads them at call time.
 */
class Translations(
    defaultLang: String = "en",
    perPlayerLanguage: Boolean = false,
    private val logger: Logger = Logger.getLogger("Artisan"),
) : TranslationsApi {
    @Volatile private var defaultLang: String = defaultLang
    @Volatile private var perPlayerLanguage: Boolean = perPlayerLanguage
    private val bundles = ConcurrentHashMap<String, Registered>()

    private class Registered(val owner: Plugin?, val bundle: MessageBundle)

    fun configure(defaultLang: String, perPlayerLanguage: Boolean) {
        this.defaultLang = defaultLang
        this.perPlayerLanguage = perPlayerLanguage
    }

    override fun getDefaultLang(): String = defaultLang

    override fun langOf(sender: CommandSender): String {
        if (!perPlayerLanguage || sender !is Player) return defaultLang
        return try {
            sender.locale().language.lowercase().ifBlank { defaultLang }
        } catch (_: Exception) {
            defaultLang
        }
    }

    override fun register(declaration: MessageBundleDeclaration): MessageBundle {
        val source = declaration.source
        val load: () -> Map<String, Map<String, String>> =
            if (source != null) source::load
            else ({ FileMessageSource.load(declaration.owner, declaration.bundledLangs) })
        return register(declaration.namespace, declaration.owner, declaration.defaultLang, load)
    }

    /** Artisan's own bundle, and tests: no [Plugin] to release it with. */
    fun register(
        namespace: String,
        owner: Plugin?,
        ownDefaultLang: String?,
        load: () -> Map<String, Map<String, String>>,
    ): MessageBundle {
        require(NAMESPACE.matches(namespace)) { "malformed namespace '$namespace': [a-z][a-z0-9_]*" }
        val bundle = Bundle(
            namespace = namespace,
            load = load,
            defaultLang = { ownDefaultLang ?: defaultLang },
            requestedLang = ::langOf,
            warn = { message, e -> logger.log(Level.WARNING, "[Artisan] $message", e) },
        )
        check(bundles.putIfAbsent(namespace, Registered(owner, bundle)) == null) {
            "translations '$namespace' are already registered"
        }
        return bundle
    }

    override fun unregister(namespace: String) {
        bundles.remove(namespace)
    }

    /** The bundles of a plugin that disables (a plugin reloader registers them again). */
    fun unregisterOwnedBy(owner: Plugin) {
        bundles.entries.removeIf { it.value.owner === owner }
    }

    override fun bundle(namespace: String): MessageBundle? = bundles[namespace]?.bundle

    override fun namespaces(): Set<String> = bundles.keys.toSet()

    private companion object {
        val NAMESPACE = Regex("[a-z][a-z0-9_]*")
    }
}

/**
 * [MessageBundleDeclaration.files]: the jar's `lang/<code>.yml` for each bundled language,
 * merged key by key under the data folder's `lang/<code>.yml` (the server's keys win). Read
 * only: nothing is written.
 */
object FileMessageSource {
    fun load(plugin: Plugin, bundledLangs: List<String>): Map<String, Map<String, String>> {
        val folder = File(plugin.dataFolder, "lang")
        val overrides = folder.listFiles { f -> f.isFile && f.name.endsWith(".yml") }
            ?.associate { it.name.removeSuffix(".yml") to it }
            ?: emptyMap()
        return (bundledLangs + overrides.keys).distinct().associateWith { lang ->
            val bundled = plugin.getResource("lang/$lang.yml")?.use { stream ->
                flatten(YamlConfiguration.loadConfiguration(InputStreamReader(stream, Charsets.UTF_8)))
            } ?: emptyMap()
            val server = overrides[lang]?.let { flatten(YamlConfiguration.loadConfiguration(it)) } ?: emptyMap()
            bundled + server
        }
    }

    fun flatten(cfg: YamlConfiguration): Map<String, String> =
        cfg.getKeys(true).filter { cfg.isString(it) }.associateWith { cfg.getString(it)!! }
}
