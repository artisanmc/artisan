package net.artisanmc.plugin.provider

import net.artisanmc.plugin.model.ProjectBundle

/**
 * Table de traduction d'un project, pour une exécution qui n'a ni menu ni
 * dialog en contexte — typiquement les actions portées par une source de
 * données et lancées par un module (ADR `yaml-assisted-editing` ④).
 *
 * Vide quand le project n'est pas résoluble : les textes restent alors
 * littéraux, jamais d'erreur (philosophie non-hermétique).
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
