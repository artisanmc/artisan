package net.artisanmc.plugin.lang

import net.artisanmc.modules.api.translation.MessageBundle
import net.artisanmc.plugin.text.ArtisanText
import net.kyori.adventure.text.Component
import net.kyori.adventure.text.minimessage.MiniMessage
import org.bukkit.command.CommandSender

/**
 * A plugin's system messages (API [MessageBundle]). [load] reads every language at once;
 * [defaultLang] and [requestedLang] are read at call time, so `/artisan reload` reaches the
 * bundles already registered.
 */
class Bundle(
    private val namespace: String,
    private val load: () -> Map<String, Map<String, String>>,
    private val defaultLang: () -> String,
    private val requestedLang: (CommandSender) -> String,
    private val warn: (String, Throwable?) -> Unit = { _, _ -> },
) : MessageBundle {
    @Volatile private var tables: Map<String, Map<String, String>> = emptyMap()

    init {
        reload()
    }

    override fun getNamespace(): String = namespace

    override fun getLanguages(): Set<String> = tables.keys

    override fun getDefaultLang(): String = LangCodes.match(tables.keys, defaultLang()) ?: defaultLang()

    override fun langOf(viewer: CommandSender): String =
        LangCodes.match(tables.keys, requestedLang(viewer)) ?: getDefaultLang()

    override fun find(lang: String, key: String): String? = tables[lang]?.get(key)

    override fun raw(lang: String, key: String): String {
        val current = tables
        val chain = listOfNotNull(
            LangCodes.match(current.keys, lang),
            LangCodes.match(current.keys, defaultLang()),
            LangCodes.match(current.keys, "en"),
        )
        return chain.firstNotNullOfOrNull { current[it]?.get(key) } ?: key
    }

    override fun format(template: String, placeholders: Map<String, *>): String =
        MessageFormat.format(template, placeholders)

    override fun get(lang: String, key: String, placeholders: Map<String, *>): Component =
        MINI_MESSAGE.deserialize(format(raw(lang, key), placeholders))

    override fun send(viewer: CommandSender, key: String, placeholders: Map<String, *>) =
        viewer.sendMessage(get(langOf(viewer), key, placeholders))

    override fun legacy(lang: String, key: String, placeholders: Map<String, *>): String =
        ArtisanText.legacy(get(lang, key, placeholders))

    override fun reload() {
        tables = try {
            load().mapValues { (_, table) -> table.toMap() }
        } catch (e: Exception) {
            warn("translations of '$namespace' could not be read, the previous ones stay: ${e.message}", e)
            return
        }
    }

    private companion object {
        val MINI_MESSAGE = MiniMessage.miniMessage()
    }
}

/** Language codes as plugins name their files: `en`, `fr`, `fr_FR`, `pt-BR`. */
object LangCodes {
    private fun normalize(code: String) = code.trim().lowercase().replace('-', '_')

    private fun language(code: String) = normalize(code).substringBefore('_')

    /**
     * The code of [available] that answers [requested]: the same code (case and `-`/`_`
     * aside), else the same language (`fr` for `fr_FR` and the reverse, the bare one first).
     */
    fun match(available: Collection<String>, requested: String): String? {
        if (requested.isBlank()) return null
        val wanted = normalize(requested)
        available.firstOrNull { normalize(it) == wanted }?.let { return it }
        val language = language(requested)
        return available.firstOrNull { normalize(it) == language }
            ?: available.firstOrNull { language(it) == language }
    }
}

/** Placeholders of a message template (API [MessageBundle.format]). */
object MessageFormat {
    private val MINI_MESSAGE = MiniMessage.miniMessage()
    private val PLACEHOLDER = Regex("""<([A-Za-z0-9_.-]+)>|\{([A-Za-z0-9_.-]+)}|%([A-Za-z0-9_.-]+)%""")

    /**
     * Replaces `<name>`, `{name}` and `%name%` for each name of [placeholders], in one pass (a
     * value is never read again), with the value's tags escaped: it shows as typed.
     */
    fun format(template: String, placeholders: Map<String, *>): String {
        if (placeholders.isEmpty()) return template
        return PLACEHOLDER.replace(template) { match ->
            val name = match.groupValues.drop(1).first { it.isNotEmpty() }
            if (!placeholders.containsKey(name)) match.value
            else MINI_MESSAGE.escapeTags(placeholders[name]?.toString() ?: "")
        }
    }
}
