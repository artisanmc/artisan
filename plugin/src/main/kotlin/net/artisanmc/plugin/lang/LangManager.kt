package net.artisanmc.plugin.lang

import net.kyori.adventure.text.Component
import net.kyori.adventure.text.minimessage.MiniMessage
import org.bukkit.command.CommandSender
import org.bukkit.configuration.file.YamlConfiguration
import org.bukkit.entity.Player
import org.bukkit.plugin.Plugin
import java.io.File
import java.io.InputStreamReader

class LangManager(
    private val translations: Map<String, Map<String, String>>,
    private val defaultLang: String,
    private val perPlayerLanguage: Boolean,
) {
    private val mm = MiniMessage.miniMessage()

    companion object {
        fun fromPlugin(plugin: Plugin, defaultLang: String, perPlayerLanguage: Boolean): LangManager {
            val translations = mutableMapOf<String, Map<String, String>>()
            for (lang in listOf("en", "fr")) {
                val map = loadLang(plugin, lang)
                if (map != null) translations[lang] = map
            }
            return LangManager(translations, defaultLang, perPlayerLanguage)
        }

        private fun loadLang(plugin: Plugin, lang: String): Map<String, String>? {
            val override = File(plugin.dataFolder, "lang/$lang.yml")
            val cfg = if (override.exists()) {
                YamlConfiguration.loadConfiguration(override)
            } else {
                val stream = plugin.getResource("lang/$lang.yml") ?: return null
                YamlConfiguration.loadConfiguration(InputStreamReader(stream, Charsets.UTF_8))
            }
            return cfg.getKeys(true)
                .filter { cfg.isString(it) }
                .associateWith { cfg.getString(it)!! }
        }
    }

    fun getRaw(key: String, lang: String = defaultLang, vararg args: Pair<String, Any>): String {
        val effective = if (translations.containsKey(lang)) lang else defaultLang
        val value = translations[effective]?.get(key)
            ?: translations["en"]?.get(key)
            ?: key
        return args.fold(value) { s, (k, v) -> s.replace("{$k}", v.toString()) }
    }

    fun get(key: String, lang: String = defaultLang, vararg args: Pair<String, Any>): Component =
        mm.deserialize(getRaw(key, lang, *args))

    fun playerLang(sender: CommandSender): String {
        if (!perPlayerLanguage || sender !is Player) return defaultLang
        return try {
            val lang = sender.locale().language.lowercase()
            if (translations.containsKey(lang)) lang else defaultLang
        } catch (_: Exception) { defaultLang }
    }

    fun get(key: String, sender: CommandSender, vararg args: Pair<String, Any>): Component =
        get(key, playerLang(sender), *args)

    fun getRaw(key: String, sender: CommandSender, vararg args: Pair<String, Any>): String =
        getRaw(key, playerLang(sender), *args)
}
