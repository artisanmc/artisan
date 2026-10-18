package net.artisanmc.plugin.lang

import net.artisanmc.modules.api.translation.MessageBundle
import net.kyori.adventure.text.Component
import org.bukkit.command.CommandSender

/**
 * Artisan's own messages: the bundle `artisan` of [Translations], read like any plugin's
 * (`lang/<code>.yml` of the jar under `plugins/Artisan/lang/`). One instance for the plugin's
 * life: `/artisan reload` reloads the bundle in place.
 */
class LangManager(private val bundle: MessageBundle) {

    /** Tests: fixed tables, no plugin. */
    constructor(translations: Map<String, Map<String, String>>, defaultLang: String, perPlayerLanguage: Boolean) :
        this(Translations(defaultLang, perPlayerLanguage).register(NAMESPACE, null, null) { translations })

    companion object {
        const val NAMESPACE = "artisan"
        val BUNDLED_LANGS = listOf("en", "fr")
    }

    fun getRaw(key: String, lang: String = bundle.defaultLang, vararg args: Pair<String, Any>): String =
        bundle.format(bundle.raw(lang, key), args.toMap())

    fun get(key: String, lang: String = bundle.defaultLang, vararg args: Pair<String, Any>): Component =
        bundle.get(lang, key, args.toMap())

    fun playerLang(sender: CommandSender): String = bundle.langOf(sender)

    fun get(key: String, sender: CommandSender, vararg args: Pair<String, Any>): Component =
        get(key, playerLang(sender), *args)

    fun getRaw(key: String, sender: CommandSender, vararg args: Pair<String, Any>): String =
        getRaw(key, playerLang(sender), *args)

    fun reload() = bundle.reload()
}
