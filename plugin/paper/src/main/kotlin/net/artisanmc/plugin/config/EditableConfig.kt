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
    val keys: List<String> = defaults.getKeys(true).filter { !defaults.isConfigurationSection(it) }.sorted()

    fun report(cfg: Configuration): Map<String, Any?> = keys.associateWith { cfg.get(it) }

    fun apply(cfg: Configuration, changes: Map<String, Any?>): String? {
        for ((key, value) in changes) validate(key, value)?.let { return "$key: $it" }
        changes.forEach { (key, value) -> cfg.set(key, value) }
        return null
    }

    private fun validate(key: String, value: Any?): String? {
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
        return null
    }

    private fun unsafePath(path: String): Boolean {
        val normalized = path.replace('\\', '/')
        return normalized.startsWith("/") || DRIVE.containsMatchIn(normalized) || normalized.split('/').any { it == ".." }
    }

    private companion object {
        val DRIVE = Regex("^[A-Za-z]:")
        val TEXTURE_REF = Regex("""[^:\s]+:[^:\s]+""")
    }
}
