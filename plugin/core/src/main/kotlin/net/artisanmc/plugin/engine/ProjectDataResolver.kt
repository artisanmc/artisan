package net.artisanmc.plugin.engine

import net.artisanmc.plugin.model.BundleDataSource
import net.artisanmc.plugin.model.ProjectBundle

/**
 * Resolver for the reserved `pack:` namespace — Project sources shipped in the
 * Bundle (`data/<id>.yaml`, ADR project-sources-and-data-models). Deliberately
 * NOT registered in the module [net.artisanmc.modules.api.datasource.DataSourceRegistry]:
 * Project sources are project content, not module capabilities — putting them
 * in the registry would leak them into the presence report (`data_sources` WS)
 * and duplicate what the editor already authors locally. Resolution happens at
 * the renderer's fetch seam instead, where the viewer's language is known
 * (ltext fields localize at bind).
 */
class ProjectDataResolver(private val bundles: () -> List<ProjectBundle>) {
    companion object {
        const val PREFIX = "pack:"
    }

    /** The table of the last bundle list seen, rebuilt only when a reload swaps the list. */
    @Volatile private var cache: Pair<List<ProjectBundle>, DocumentTable<BundleDataSource>>? = null

    private fun table(): DocumentTable<BundleDataSource> {
        val current = bundles()
        cache?.let { (list, table) -> if (list === current) return table }
        // Reversed: on an ambiguous id DocumentTable keeps the LAST entry, and the
        // historical winner here is the first source in load order.
        val table = DocumentTable(
            current.flatMap { b -> b.dataSources.map { b.projectId to it } }.asReversed(),
        ) { it.id }
        cache = current to table
        return table
    }

    fun canResolve(ref: String): Boolean = ref.startsWith(PREFIX)

    /**
     * Table → localized rows (List<Map>); config → localized object (Map);
     * unknown id → null.
     *
     * The rule of a bare Document reference ([DocumentTable]): the id is looked
     * up in [fromProject] (the Project of the menu that fetches) first, then on
     * the server if a single Project defines it. Defined by several other
     * Projects, it is ambiguous and the first in load order wins, as before.
     * There is no qualified form: an id holding `:` names no source.
     */
    fun resolve(ref: String, lang: String, fromProject: String? = null): Any? {
        if (!canResolve(ref)) return null
        val id = ref.removePrefix(PREFIX)
        if (':' in id) return null
        return table().resolve(id, fromProject).value?.resolved(lang)
    }
}
