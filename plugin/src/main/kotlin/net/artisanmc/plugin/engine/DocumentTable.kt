package net.artisanmc.plugin.engine

/**
 * Les Documents d'un type (menus, dialogs) de **tous** les projects du serveur,
 * résolus par référence — miroir de `parseDocRef` + `deriveServerGraph` côté
 * éditeur.
 *
 * - `main` : id **nu**, cherché d'abord dans le project qui référence, puis sur
 *   le serveur s'il n'y est défini qu'une fois.
 * - `boutique:main` : id **qualifié** par le dossier d'un project.
 *
 * Un id nu absent du project et porté par plusieurs autres est [Ambiguous] : on
 * garde alors le **dernier chargé**, exactement ce que faisait la table unique
 * d'avant les namespaces — un menu qui s'ouvrait continue de s'ouvrir.
 */
class DocumentTable<T>(entries: List<Pair<String, T>>, idOf: (T) -> String) {
    sealed interface Resolution<out T> {
        val value: T?
    }

    data class Found<T>(override val value: T) : Resolution<T>

    /** [value] = le gagnant historique (dernier chargé) ; [projects] = ceux qui le définissent. */
    data class Ambiguous<T>(override val value: T, val projects: List<String>) : Resolution<T>

    data object Missing : Resolution<Nothing> {
        override val value: Nothing? = null
    }

    private val byId: Map<String, List<Pair<String, T>>> = entries.groupBy { idOf(it.second) }

    val ids: Set<String> get() = byId.keys

    fun resolve(ref: String, fromProject: String?): Resolution<T> {
        val at = ref.indexOf(':')
        if (at > 0 && at < ref.length - 1) {
            val namespace = ref.substring(0, at)
            val hit = byId[ref.substring(at + 1)]?.lastOrNull { it.first == namespace }
            return if (hit != null) Found(hit.second) else Missing
        }
        val all = byId[ref].orEmpty()
        val local = if (fromProject != null) all.filter { it.first == fromProject } else emptyList()
        val candidates = local.ifEmpty { all }
        return when {
            candidates.isEmpty() -> Missing
            candidates.size == 1 -> Found(candidates.single().second)
            else -> Ambiguous(candidates.last().second, candidates.map { it.first })
        }
    }
}
