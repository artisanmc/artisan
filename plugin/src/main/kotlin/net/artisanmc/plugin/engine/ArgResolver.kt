package net.artisanmc.plugin.engine

import org.bukkit.World
import org.bukkit.entity.Player

/**
 * Résolution des placeholders de contexte `{name}` et `{alias.field}` (champ
 * d'un item Map d'une itération, ou champ d'un Player : `name`, `uuid`,
 * `world`). Une valeur Bukkit nue (`Player`, `World`) rend son nom, pas son
 * toString. Les refs `{i18n:…}` ne matchent pas le pattern (deux-points) ;
 * `%papi%` n'est pas concerné. Placeholder inconnu → laissé tel quel
 * (cohérent avec le comportement historique).
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
            if (field.isEmpty()) bare(value)
            else dotted(value, field) ?: m.value
        }

    /** Rendu "nu" d'une valeur : les objets Bukkit rendent leur nom, pas leur toString. */
    private fun bare(value: Any): String = when (value) {
        is Player -> value.name
        is World  -> value.name
        else      -> value.toString()
    }

    private fun dotted(value: Any, field: String): String? = when (value) {
        is Map<*, *> -> value[field]?.toString()
        is Player    -> when (field) {
            "name"  -> value.name
            "uuid"  -> value.uniqueId.toString()
            "world" -> value.world.name
            else    -> null
        }
        else -> null
    }

    /**
     * Valeur BRUTE d'un chemin `name` / `name.field` — pour le passage de
     * contexte type-preserving (`context: { cat: "{cat}" }` passe la Map de
     * la ligne entière, `"{item.final_price}"` passe le Number). Null si
     * introuvable — l'appelant retombe alors sur l'interpolation texte.
     */
    fun lookupValue(path: String, args: Map<String, Any>): Any? {
        val dot = path.indexOf('.')
        val name = if (dot == -1) path else path.substring(0, dot)
        val root = args[name] ?: return null
        if (dot == -1) return root
        // Un seul niveau de champ, comme `resolve` (contrat menu/v1).
        val field = path.substring(dot + 1)
        return when (root) {
            is Map<*, *> -> root[field]
            is Player -> when (field) {
                "name"  -> root.name
                "uuid"  -> root.uniqueId.toString()
                "world" -> root.world.name
                else    -> null
            }
            else -> null
        }
    }
}
