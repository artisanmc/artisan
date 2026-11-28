package net.artisanmc.plugin.lang

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.modules.api.translation.MessageBundle
import net.artisanmc.modules.api.translation.MessageBundleDeclaration
import net.artisanmc.modules.api.translation.TranslationsApi
import net.artisanmc.plugin.model.Originals
import net.artisanmc.plugin.project.ProjectOrigins
import net.artisanmc.plugin.project.ProjectPublisher
import net.artisanmc.plugin.yamlio.Yaml12
import org.bukkit.command.CommandSender
import org.bukkit.entity.Player
import org.bukkit.plugin.Plugin
import java.io.File
import java.util.UUID
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
            if (source == null) {
                val owner = declaration.owner
                try {
                    ShippedLang.write(folder, declaration.bundledLangs.associateWith { lang ->
                        owner.getResource("lang/$lang.yml")?.use { it.readBytes() }
                    }, logger, declaration.namespace)
                } catch (e: Exception) {
                    logger.log(Level.WARNING, "[Artisan] The messages of '${declaration.namespace}' not written to ${folder.path}/originals/lang", e)
                }
            }
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
                read(String(stream.readBytes(), Charsets.UTF_8), "jar lang/$lang.yml", plugin.logger)
            } ?: emptyMap()
            val server = overrides[lang]?.let { read(it.readText(Charsets.UTF_8), it.path, plugin.logger) } ?: emptyMap()
            bundled + server
        }
    }

    /**
     * Read as the editor reads it (YAML 1.2, [Yaml12]): a message `Yes` or `On` stays text, where
     * Bukkit's YAML 1.1 reader made it a boolean and dropped it. The text values by dotted
     * path; numbers, booleans, lists and nulls are not messages. Unreadable: empty, logged.
     */
    fun flatten(text: String): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        fun walk(node: JsonNode, path: String) {
            when {
                node.isObject -> node.fields().forEach { (k, v) -> walk(v, if (path.isEmpty()) k else "$path.$k") }
                node.isTextual && path.isNotEmpty() -> out[path] = node.textValue()
            }
        }
        if (text.isNotBlank()) yaml.readTree(text)?.let { walk(it, "") }
        return out
    }

    private val yaml = ObjectMapper(Yaml12.factory())

    private fun read(text: String, source: String, logger: Logger): Map<String, String> =
        try {
            flatten(text)
        } catch (e: Exception) {
            logger.log(Level.SEVERE, "[Artisan] Cannot read $source: ${e.message}")
            emptyMap()
        }
}

/**
 * [MessageBundleDeclaration.inFolder] of a `files` bundle: the jar's `lang/<code>.yml` of each
 * bundled language, as shipped, in the module's `originals/lang/<code>.yml` (design
 * `originaux-modules`), so the editor lists every message with its default and writes to the
 * module's `lang/` only what the owner changed. The bundle still reads its defaults from the
 * jar ([FileMessageSource]): this copy is what the editor sees of them. A file a template ships
 * there (an origin in `.artisan/origins.yaml`) is the template's, left as is. Written through
 * the module's journal, like the other originals.
 */
object ShippedLang {
    /** The template the messages are indexed under in a folder that holds its whole tree. */
    const val TEMPLATE = "messages"

    fun write(folder: File, bundled: Map<String, ByteArray?>, logger: Logger, module: String = folder.name): List<String> {
        // A folder that holds its whole tree (ADR `editable-module-tree`): `lang/<code>.yml` is the
        // owner's, merged key by key at each update like any shipped file.
        if (!File(folder, Originals.DIR).isDirectory) {
            val files = bundled.filterValues { it != null }
            if (files.isEmpty()) return emptyList()
            val builder = net.artisanmc.modules.api.template.TemplateDeclaration.builder(TEMPLATE, 1)
            for ((lang, bytes) in files.toSortedMap()) builder.file("lang/$lang.yml", bytes!!)
            return net.artisanmc.plugin.project.SystemFiles.sync(folder, module, builder.build(), required = false)
        }
        val origins = ProjectOrigins.read(folder)
        val changes = linkedMapOf<String, ByteArray?>()
        for ((lang, bytes) in bundled) {
            if (bytes == null) continue
            val path = "${Originals.DIR}/lang/$lang.yml"
            if (origins[path] != null) {
                logger.warning("[Artisan] ${folder.path}/$path is shipped by the template of '${origins[path]!!.module}': the messages' copy is not written there.")
                continue
            }
            val file = File(folder, path)
            if (file.isFile && file.readBytes().contentEquals(bytes)) continue
            changes[path] = bytes
        }
        if (changes.isEmpty()) return emptyList()
        folder.mkdirs()
        ProjectPublisher(folder).commit(
            "system-${UUID.randomUUID()}", UUID.randomUUID().toString(), changes,
            ObjectMapper().valueToTree(mapOf("ok" to true)),
        )
        return changes.keys.toList()
    }
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
