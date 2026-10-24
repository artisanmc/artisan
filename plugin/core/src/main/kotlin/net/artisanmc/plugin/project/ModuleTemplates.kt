package net.artisanmc.plugin.project

import net.artisanmc.modules.api.template.TemplateDeclaration
import net.artisanmc.modules.api.template.TemplateRegistry

/**
 * Each module's templates as Presence, `template_fetch` and the system files see them: those it
 * registered ([registry]), then the one Artisan writes for it ([generated], the command files of
 * `ModuleCommandFiles`). A generated template takes its id over from a registered one.
 */
class ModuleTemplates(private val registry: TemplateRegistry) {
    /** module id → the template Artisan generated for it; replaced as a whole. */
    @Volatile
    private var generated: Map<String, TemplateDeclaration> = emptyMap()

    /** The generated templates by module id, in place of the previous ones. */
    fun setGenerated(byModule: Map<String, TemplateDeclaration>) {
        generated = byModule.toMap()
    }

    fun find(moduleId: String, templateId: String): TemplateDeclaration? =
        generated[moduleId]?.takeIf { it.id == templateId } ?: registry.find(moduleId, templateId)

    fun of(moduleId: String): List<TemplateDeclaration> = merge(registry.of(moduleId), generated[moduleId])

    /** Every module with a template, in registration order, then those with a generated one only. */
    fun registered(): Map<String, List<TemplateDeclaration>> {
        val extra = generated
        val out = linkedMapOf<String, List<TemplateDeclaration>>()
        registry.registered().forEach { (module, own) -> out[module] = merge(own, extra[module]) }
        extra.forEach { (module, template) -> out.putIfAbsent(module, listOf(template)) }
        return out
    }

    private fun merge(own: List<TemplateDeclaration>, extra: TemplateDeclaration?): List<TemplateDeclaration> =
        if (extra == null) own else own.filter { it.id != extra.id } + extra
}
