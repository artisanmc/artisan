package net.artisanmc.plugin.engine

import net.artisanmc.plugin.model.MenuYaml
import org.bukkit.Bukkit

/**
 * Auto-binding §15.4 : les args de l'appelant (commande, open_menu.context,
 * alias d'itération) peuplent les context_inputs par nom ; les defaults
 * déclarés comblent le reste. Phase B branchera ici le fetch des inputs à
 * `source` (ConnectorBinding) non fournis par l'appelant.
 */
object ContextBinder {
    fun bind(menu: MenuYaml, callerArgs: Map<String, Any>): Map<String, Any> {
        val out = callerArgs.toMutableMap()
        for (input in menu.contextInputs) {
            if (input.name.isEmpty() || out.containsKey(input.name)) continue
            val d = input.default ?: continue
            out[input.name] = coerce(d, input.type)
        }
        return out
    }

    private fun coerce(raw: String, type: String): Any = when (type) {
        "integer" -> raw.toLongOrNull() ?: raw
        "number"  -> raw.toDoubleOrNull() ?: raw
        "boolean" -> raw.toBooleanStrictOrNull() ?: raw
        // Joueur hors-ligne → on garde la string brute ({target} reste rendable, pas de crash).
        "player"  -> Bukkit.getPlayerExact(raw) ?: raw
        else      -> raw
    }
}
