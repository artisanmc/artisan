package net.artisanmc.plugin.project

import net.artisanmc.modules.api.template.TemplateDeclaration
import net.artisanmc.modules.api.template.TemplateRegistry

/**
 * Each module's templates as Presence, `template_fetch` and the system files see them: those it
 * registered ([registry]), then the one Artisan writes for it ([generated], the command files of
 * `ModuleCommandFiles`). A generated template takes its id over from a registered one.
 */
class ModuleTemplates(private val registry: TemplateRegistry) {
    /**
     * module id → builds the template Artisan generates for it from the module's own templates,
     * read at each call: a module may register them after its commands. Replaced as a whole.
     */
    @Volatile
    private var generators: Map<String, (own: List<TemplateDeclaration>) -> TemplateDeclaration?> = emptyMap()

    /** The generated templates by module id, in place of the previous ones. */
    fun setGenerated(byModule: Map<String, (own: List<TemplateDeclaration>) -> TemplateDeclaration?>) {
        generators = byModule.toMap()
    }

    private fun generated(moduleId: String, own: List<TemplateDeclaration> = registry.of(moduleId)): TemplateDeclaration? =
        generators[moduleId]?.invoke(own)

    fun find(moduleId: String, templateId: String): TemplateDeclaration? =
        generated(moduleId)?.takeIf { it.id == templateId } ?: registry.find(moduleId, templateId)

    fun of(moduleId: String): List<TemplateDeclaration> = registry.of(moduleId).let { merge(it, generated(moduleId, it)) }

    /** Every module with a template, in registration order, then those with a generated one only. */
    fun registered(): Map<String, List<TemplateDeclaration>> {
        val extra = generators.keys
        val out = linkedMapOf<String, List<TemplateDeclaration>>()
        registry.registered().forEach { (module, own) -> out[module] = merge(own, generated(module, own)) }
        extra.forEach { module -> if (module !in out) generated(module, emptyList())?.let { out[module] = listOf(it) } }
        return out
    }

    private fun merge(own: List<TemplateDeclaration>, extra: TemplateDeclaration?): List<TemplateDeclaration> =
        if (extra == null) own else own.filter { it.id != extra.id } + extra
}
