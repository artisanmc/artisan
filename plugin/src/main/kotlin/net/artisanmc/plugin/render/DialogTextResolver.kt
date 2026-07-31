package net.artisanmc.plugin.render

import net.artisanmc.plugin.engine.ArgResolver
import net.artisanmc.plugin.engine.ExecutionContext
import net.artisanmc.plugin.model.BundleDialog

/**
 * Textes d'un dialog après résolution, index-alignés sur les listes du YAML
 * (bodyTexts[i] = null pour un body non-text). Consommé par [DialogRenderer].
 */
internal data class ResolvedDialogTexts(
    val title: String,
    val bodyTexts: List<String?>,
    val inputLabels: List<String>,
    val inputOptionLabels: List<List<String>>,
    val buttonLabels: List<String>,
)

/**
 * Chaîne de résolution texte des dialogs — même ordre que MenuRenderer.resolveText :
 * i18n d'abord, puis args ({player} & co via [ArgResolver]). Séparé de
 * [DialogRenderer] pour rester testable sous MockBukkit (l'API dialog Paper
 * 1.21.7 n'existe pas sur le classpath de test paper-api 1.21.1).
 */
internal object DialogTextResolver {

    fun resolveAll(dialog: BundleDialog, langMap: Map<String, String>, ctx: ExecutionContext): ResolvedDialogTexts {
        // Canonical i18n addresses, mirror of the editor's visitDialogLTexts:
        // body by INDEX, inputs/options/buttons by ID (stable under reordering).
        val d = "dialogs.${dialog.yaml.id}"
        return ResolvedDialogTexts(
            title = resolve(dialog.yaml.title, langMap, ctx, "$d.title"),
            bodyTexts = dialog.yaml.body.mapIndexed { i, b ->
                b.text?.takeIf { b.type == "text" }?.let { resolve(it, langMap, ctx, "$d.body.$i.text") }
            },
            inputLabels = dialog.yaml.inputs.map {
                resolve(it.label, langMap, ctx, "$d.inputs.${it.id}.label")
            },
            inputOptionLabels = dialog.yaml.inputs.map { input ->
                input.options.map {
                    resolve(it.label, langMap, ctx, "$d.inputs.${input.id}.options.${it.value}.label")
                }
            },
            buttonLabels = dialog.yaml.buttons.map {
                resolve(it.label, langMap, ctx, "$d.buttons.${it.id}.label")
            },
        )
    }

    /**
     * Explicit `{i18n:key}` ref wins; otherwise the literal is looked up at its
     * canonical ADDRESS (inline mode); otherwise it stands as written.
     */
    fun resolve(
        raw: String,
        langMap: Map<String, String>,
        ctx: ExecutionContext,
        address: String? = null,
    ): String {
        val text = if (raw.startsWith("{i18n:")) {
            langMap[raw.removePrefix("{i18n:").removeSuffix("}")] ?: raw
        } else {
            address?.let { langMap[it] } ?: raw
        }
        return ArgResolver.resolve(text, ctx.resolvedArgs)
    }
}
