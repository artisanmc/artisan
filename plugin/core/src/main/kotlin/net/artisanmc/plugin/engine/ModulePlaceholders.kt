package net.artisanmc.plugin.engine

private val TOKEN = Regex("%([a-z][a-z0-9]*)_([^%\\s]+)%")
private val NAMESPACE = Regex("[a-z][a-z0-9]*")

/** A namespace usable in `%namespace_key%`, in Artisan's templates and as a PlaceholderAPI identifier. */
fun isPlaceholderNamespace(namespace: String) = namespace.length <= 64 && NAMESPACE.matches(namespace)

/**
 * Replaces the `%namespace_key%` tokens that [lookup] answers; the others stay as
 * written, for PlaceholderAPI to resolve next.
 */
fun expandPlaceholders(text: String, lookup: (namespace: String, key: String) -> String?): String {
    if (text.indexOf('%') == -1) return text
    return TOKEN.replace(text) { m -> lookup(m.groupValues[1], m.groupValues[2]) ?: m.value }
}
