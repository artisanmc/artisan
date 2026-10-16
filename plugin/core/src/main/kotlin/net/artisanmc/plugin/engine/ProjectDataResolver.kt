package net.artisanmc.plugin.engine

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

    fun canResolve(ref: String): Boolean = ref.startsWith(PREFIX)

    /**
     * Table → localized rows (List<Map>); config → localized object (Map);
     * unknown id → null. Projects of the server are searched in load order
     * (source ids are project-scoped ds_* — collisions are improbable).
     */
    fun resolve(ref: String, lang: String): Any? {
        if (!canResolve(ref)) return null
        val id = ref.removePrefix(PREFIX)
        for (bundle in bundles()) {
            val ds = bundle.dataSources.find { it.id == id } ?: continue
            return ds.resolved(lang)
        }
        return null
    }
}
