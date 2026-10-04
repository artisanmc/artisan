package net.artisanmc.plugin.engine

internal data class PapiExpansion(val identifier: String, val placeholders: () -> List<String>)
data class PapiPlaceholder(val placeholder: String, val expansion: String)
data class PapiPlaceholderCatalog(val placeholders: List<PapiPlaceholder>, val truncated: Boolean = false) {
    companion object {
        internal fun collect(expansions: Iterable<PapiExpansion>): PapiPlaceholderCatalog {
            val entries = linkedMapOf<String, PapiPlaceholder>()
            var bytes = 0
            for (expansion in expansions) {
                if (!expansion.identifier.matches(Regex("[a-zA-Z0-9-]{1,64}"))) continue
                val declaredPlaceholders = runCatching { expansion.placeholders() }.getOrDefault(emptyList())
                for (declared in declaredPlaceholders) {
                    val name = declared.removeSurrounding("%")
                    if (name.length !in 3..254 || name.any { it.isWhitespace() || it in "%{}" }) continue
                    val prefix = "${expansion.identifier}_"
                    if (!name.startsWith(prefix) && !name.startsWith("rel_$prefix")) continue
                    if (name == prefix || name == "rel_$prefix") continue
                    val token = "%$name%"
                    if (token in entries) continue
                    val size = token.toByteArray(Charsets.UTF_8).size + expansion.identifier.length
                    if (entries.size >= 2_000 || bytes + size > 128 * 1024) {
                        return PapiPlaceholderCatalog(entries.values.sortedBy { it.placeholder }, truncated = true)
                    }
                    entries[token] = PapiPlaceholder(token, expansion.identifier)
                    bytes += size
                }
            }
            return PapiPlaceholderCatalog(entries.values.sortedBy { it.placeholder })
        }
    }
}
