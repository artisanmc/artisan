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

    private class Registered(val owner: Plugin?, val bundle: MessageBundle, val folder: File? = null)

    fun configure(defaultLang: String, perPlayerLanguage: Boolean) {
        this.defaultLang = defaultLang
        this.perPlayerLanguage = perPlayerLanguage
    }

    override fun getDefaultLang(): String = defaultLang

    override fun langOf(sender: CommandSender): String {
        if (!perPlayerLanguage || sender !is Player) return defaultLang
        return try {
            // `fr_fr`: getLocale exists on Spigot too, locale() is Paper's.
            @Suppress("DEPRECATION")
            sender.locale.substringBefore('_').lowercase().ifBlank { defaultLang }
        } catch (_: Exception) {
            defaultLang
        }
    }

    override fun register(declaration: MessageBundleDeclaration): MessageBundle {
        val source = declaration.source
        val folder = declaration.folder
        if (folder != null) {
            require(NAMESPACE.matches(declaration.namespace)) { "malformed namespace '${declaration.namespace}': [a-z][a-z0-9_]*" }
            check(!bundles.containsKey(declaration.namespace)) { "translations '${declaration.namespace}' are already registered" }
            LangFolderMove.run(File(declaration.owner.dataFolder, "lang"), File(folder, "lang"), logger)
        }
        val load: () -> Map<String, Map<String, String>> =
            if (source != null) source::load
            else ({ FileMessageSource.load(declaration.owner, declaration.bundledLangs, folder ?: declaration.owner.dataFolder) })
        return register(declaration.namespace, declaration.owner, declaration.defaultLang, folder, load)
    }

    /** Artisan's own bundle, and tests: no [Plugin] to release it with. */
    fun register(
        namespace: String,
        owner: Plugin?,
        ownDefaultLang: String?,
        folder: File? = null,
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
        check(bundles.putIfAbsent(namespace, Registered(owner, bundle, folder)) == null) {
            "translations '$namespace' are already registered"
        }
        return bundle
    }

    override fun unregister(namespace: String) {
        bundles.remove(namespace)
    }

    /**
     * The bundles whose files live in a module's folder ([MessageBundleDeclaration.inFolder]), read
     * again: the projects were reloaded, a publication may have changed their `lang/`.
     */
    fun reloadFolderBundles() {
        bundles.values.filter { it.folder != null }.forEach { it.bundle.reload() }
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
 * merged key by key under the server's `lang/<code>.yml` of [root], the data folder or the
 * module's folder (the server's keys win). Read only: nothing is written. In a module's folder,
 * a `.yaml` file is read when no `.yml` twin exists.
 */
object FileMessageSource {
    fun load(plugin: Plugin, bundledLangs: List<String>, root: File = plugin.dataFolder): Map<String, Map<String, String>> {
        val extensions = if (root == plugin.dataFolder) listOf(".yml") else listOf(".yaml", ".yml")
        // `.yml` last: it wins over its `.yaml` twin.
        val overrides = File(root, "lang").listFiles { f -> f.isFile && extensions.any(f.name::endsWith) }.orEmpty()
            .sortedBy { it.name.endsWith(".yml") }
            .associateBy { it.name.substringBeforeLast('.') }
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

/**
 * [MessageBundleDeclaration.inFolder]: the `.yml` files of the data folder's `lang/` moved once into the
 * module's `lang/`. A file whose language the module's folder already has (`.yml` or `.yaml`)
 * stays where it is, named in the log; the data folder's `lang/` goes once empty.
 */
object LangFolderMove {
    fun run(from: File, to: File, logger: Logger): List<String> {
        val files = from.listFiles { f -> f.isFile && f.name.endsWith(".yml") }.orEmpty().sortedBy { it.name }
        val moved = mutableListOf<String>()
        for (file in files) {
            val lang = file.name.removeSuffix(".yml")
            if (File(to, "$lang.yml").exists() || File(to, "$lang.yaml").exists()) {
                logger.warning("[Artisan] ${file.path} not moved: ${to.path} already has $lang. Merge it there, then delete it.")
                continue
            }
            try {
                to.mkdirs()
                java.nio.file.Files.move(file.toPath(), File(to, file.name).toPath())
                moved += file.name
            } catch (e: java.io.IOException) {
                logger.log(Level.WARNING, "[Artisan] Could not move ${file.path} to ${to.path}", e)
            }
        }
        if (moved.isNotEmpty()) logger.info("[Artisan] Moved ${moved.joinToString()} from ${from.path} to ${to.path}.")
        from.list()?.let { if (it.isEmpty()) from.delete() }
        return moved
    }
}
