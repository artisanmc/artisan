package net.artisanmc.plugin.config

import org.bukkit.configuration.Configuration

/** What the editor can read and write in `config.yml`, plugin side. */
interface ServerConfigAccess {
    fun report(): Map<String, Any?>

    /** Writes and reloads; returns `"<key>: <error>"` when refused (nothing written). */
    fun write(changes: Map<String, Any?>): String?
}

/**
 * `config.yml` as seen from the editor (ADR `server-config-from-editor`): the
 * leaf keys of the bundled defaults, typed like them. Paths may not leave the
 * server root, the only power a path adds over menu console commands.
 */
class EditableConfig(private val defaults: Configuration) {
    val keys: List<String> = (defaults.getKeys(true).filter { !defaults.isConfigurationSection(it) } + MENU_VARIANTS).distinct().sorted()

    fun report(cfg: Configuration): Map<String, Any?> = keys.associateWith {
        if (it == MENU_VARIANTS) menuVariants(cfg.getList(it)) else cfg.get(it)
    }

    fun apply(cfg: Configuration, changes: Map<String, Any?>): String? {
        for ((key, value) in changes) validate(key, value)?.let { return "$key: $it" }
        changes.forEach { (key, value) -> cfg.set(key, if (key == MENU_VARIANTS && value == emptyList<Any>()) null else value) }
        return null
    }

    /** `menu-variants` as plain lists and maps (a section read back from YAML included); none: an empty list. */
    private fun menuVariants(raw: List<*>?): List<Any?> = raw.orEmpty().map(::plain)

    private fun plain(v: Any?): Any? = when (v) {
        is org.bukkit.configuration.ConfigurationSection -> v.getKeys(false).associateWith { plain(v.get(it)) }
        is Map<*, *> -> v.entries.associate { (k, x) -> k.toString() to plain(x) }
        is List<*> -> v.map(::plain)
        else -> v
    }

    private fun validate(key: String, value: Any?): String? {
        if (key == MENU_VARIANTS) {
            if (value !is List<*>) return "invalid_type"
            // Written only when every variant reads: one left out would vanish from players' menus silently.
            return if (net.artisanmc.plugin.engine.ServerVariants.parse(value).problems.isEmpty()) null else "invalid_menu_variants"
        }
        if (key !in keys) return "unknown_key"
        val typed = when (defaults.get(key)) {
            is Boolean -> value is Boolean
            is Number -> value is Int || value is Long
            is String -> value is String
            is List<*> -> value is List<*> && value.all { it is String }
            else -> false
        }
        if (!typed) return "invalid_type"
        if (key == "resource-pack.delegate-to-dir" && unsafePath(value as String)) return "unsafe_path"
        if (key.startsWith("resource-pack.container-textures.") && value != "" && !TEXTURE_REF.matches(value as String)) return "invalid_reference"
        if (key == "resource-pack.theme" && value != "" && !THEME.matches(value as String)) return "invalid_theme"
        if (key == "text-palette.colors" && !(value as List<*>).all { PALETTE_COLOR.matches(it as String) }) return "invalid_palette_entry"
        if (key == "text-palette.gradients" && !(value as List<*>).all { PALETTE_GRADIENT.matches(it as String) }) return "invalid_palette_entry"
        return null
    }

    private fun unsafePath(path: String): Boolean {
        val normalized = path.replace('\\', '/')
        return normalized.startsWith("/") || DRIVE.containsMatchIn(normalized) || normalized.split('/').any { it == ".." }
    }

    companion object {
        /** The server's menu variants: a list of `{name, parent, if, selectable}`, not in the bundled defaults. */
        const val MENU_VARIANTS = "menu-variants"
        private val DRIVE = Regex("^[A-Za-z]:")
        private val TEXTURE_REF = Regex("""[^:\s]+:[^:\s]+""")
        /** A theme's folder name, as `KitTheme.isName` reads it. */
        private val THEME = Regex("^[a-z0-9][a-z0-9_-]*$")
        /** `<name> #rrggbb`, the name free text. */
        private val PALETTE_COLOR = Regex("""\S.* #[0-9a-fA-F]{6}""")
        /** `<name> #rrggbb #rrggbb [...]`: two stops at least. */
        private val PALETTE_GRADIENT = Regex("""\S.*?( #[0-9a-fA-F]{6}){2,}""")
    }
}
