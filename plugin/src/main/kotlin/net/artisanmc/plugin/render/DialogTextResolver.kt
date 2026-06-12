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

    fun resolveAll(dialog: BundleDialog, langMap: Map<String, String>, ctx: ExecutionContext): ResolvedDialogTexts =
        ResolvedDialogTexts(
            title = resolve(dialog.yaml.title, langMap, ctx),
            bodyTexts = dialog.yaml.body.map { b -> b.text?.takeIf { b.type == "text" }?.let { resolve(it, langMap, ctx) } },
            inputLabels = dialog.yaml.inputs.map { resolve(it.label, langMap, ctx) },
            inputOptionLabels = dialog.yaml.inputs.map { input -> input.options.map { resolve(it.label, langMap, ctx) } },
            buttonLabels = dialog.yaml.buttons.map { resolve(it.label, langMap, ctx) },
        )

    fun resolve(raw: String, langMap: Map<String, String>, ctx: ExecutionContext): String {
        val text = if (raw.startsWith("{i18n:")) langMap[raw.removePrefix("{i18n:").removeSuffix("}")] ?: raw else raw
        return ArgResolver.resolve(text, ctx.resolvedArgs)
    }
}
