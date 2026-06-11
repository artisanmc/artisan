package net.artisanmc.plugin.engine

/**
 * Résolution des placeholders de contexte `{name}` et `{alias.field}` (champ
 * d'un item Map d'une itération). Les refs `{i18n:…}` ne matchent pas le
 * pattern (deux-points) ; `%papi%` n'est pas concerné. Placeholder inconnu →
 * laissé tel quel (cohérent avec le comportement historique).
 *
 * Les noms d'args et de champs sont lowercase par contrat (patterns slug
 * `^[a-z][a-z0-9_]*$` du schéma menu/v1) — une clé hors convention n'est
 * pas résolue.
 */
object ArgResolver {
    private val PATTERN = Regex("\\{([a-z][a-z0-9_]*)(?:\\.([a-z0-9_]+))?}")

    fun resolve(text: String, args: Map<String, Any>): String =
        PATTERN.replace(text) { m ->
            val name = m.groupValues[1]
            val field = m.groupValues[2]
            val value = args[name] ?: return@replace m.value
            if (field.isEmpty()) value.toString()
            else (value as? Map<*, *>)?.get(field)?.toString() ?: m.value
        }
}
