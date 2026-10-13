package net.artisanmc.plugin.provider

import net.artisanmc.plugin.model.ProjectBundle

/**
 * A project's translation table, for an execution with no menu or dialog in
 * context: typically actions carried by a data source and run by a module
 * (ADR `yaml-assisted-editing`).
 *
 * Empty when the project cannot be resolved: texts then stay literal, never an
 * error.
 */
fun projectLangMap(
    bundles: List<ProjectBundle>,
    projectId: String?,
    lang: String,
): Map<String, String> {
    if (projectId == null) return emptyMap()
    val bundle = bundles.firstOrNull { it.projectId == projectId } ?: return emptyMap()
    return bundle.langMapWithFallback(lang)
}
