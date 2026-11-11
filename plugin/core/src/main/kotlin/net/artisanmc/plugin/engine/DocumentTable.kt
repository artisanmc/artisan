package net.artisanmc.plugin.engine

/**
 * The Documents of one type (menus, dialogs) across **all** the server's projects,
 * resolved by reference. Mirror of the editor's `parseDocRef` + `deriveServerGraph`.
 *
 * - `main`: **bare** id, looked up first in the referencing project, then on the
 *   server if it is defined only once.
 * - `boutique:main`: id **qualified** by a project folder.
 *
 * A bare id missing from the project and defined by several others is [Ambiguous]:
 * the **last loaded** one wins, exactly what the single table did before
 * namespaces, so a menu that used to open keeps opening.
 */
class DocumentTable<T>(entries: List<Pair<String, T>>, idOf: (T) -> String) {
    sealed interface Resolution<out T> {
        val value: T?
    }

    data class Found<T>(override val value: T) : Resolution<T>

    /** [value] = the historical winner (last loaded); [projects] = those defining it. */
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
