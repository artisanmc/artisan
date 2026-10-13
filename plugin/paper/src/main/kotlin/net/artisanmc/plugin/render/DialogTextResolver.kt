package net.artisanmc.plugin.render

import net.artisanmc.plugin.engine.I18nAddress
import net.artisanmc.plugin.engine.ExecutionContext
import net.artisanmc.plugin.engine.render
import net.artisanmc.plugin.model.BundleDialog
import net.artisanmc.plugin.model.LocalizedText

/**
 * A dialog's resolved texts, index-aligned with the YAML lists (bodyTexts[i] = null
 * for a non-text body). Consumed by [DialogRenderer].
 */
internal data class ResolvedDialogTexts(
    val title: String,
    val bodyTexts: List<String?>,
    val inputLabels: List<String>,
    val inputOptionLabels: List<List<String>>,
    val buttonLabels: List<String>,
)

/**
 * Dialog text resolution chain, same order as MenuRenderer.resolveText: i18n first,
 * then the Template ({player} & co). Kept apart from [DialogRenderer] to stay testable
 * under MockBukkit (the Paper 1.21.7 dialog API is not on the paper-api 1.21.1 test
 * classpath).
 */
internal object DialogTextResolver {

    fun resolveAll(dialog: BundleDialog, langMap: Map<String, String>, ctx: ExecutionContext): ResolvedDialogTexts {
        // Canonical i18n addresses, mirror of the editor's visitDialogLTexts:
        // body by INDEX, inputs/options/buttons by ID (stable under reordering).
        val d = dialog.yaml.id
        return ResolvedDialogTexts(
            title = resolve(dialog.yaml.title, langMap, ctx, I18nAddress.dialogTitle(d)),
            bodyTexts = dialog.yaml.body.mapIndexed { i, b ->
                b.text?.takeIf { b.type == "text" }?.let { resolve(it, langMap, ctx, I18nAddress.dialogBody(d, i)) }
            },
            inputLabels = dialog.yaml.inputs.map {
                resolve(it.label, langMap, ctx, I18nAddress.dialogInputLabel(d, it.id))
            },
            inputOptionLabels = dialog.yaml.inputs.map { input ->
                input.options.map {
                    resolve(it.label, langMap, ctx, I18nAddress.dialogOptionLabel(d, input.id, it.value))
                }
            },
            buttonLabels = dialog.yaml.buttons.map {
                resolve(it.label, langMap, ctx, I18nAddress.dialogButtonLabel(d, it.id))
            },
        )
    }

    /**
     * A field-local map wins (ADR `field-local-translations`); otherwise a bare
     * value keeps the legacy chain: explicit `{i18n:key}` ref → canonical ADDRESS
     * (inline mode) → the value as written. Then `{arg}`/`%papi%` interpolation.
     */
    fun resolve(
        raw: LocalizedText?,
        langMap: Map<String, String>,
        ctx: ExecutionContext,
        address: String? = null,
    ): String {
        if (raw == null) return ""
        val value = raw.forLang(ctx.lang, ctx.defaultLang) ?: return ""
        val text = when {
            raw.isMap -> value
            value.startsWith("{i18n:") -> langMap[value.removePrefix("{i18n:").removeSuffix("}")] ?: value
            else -> address?.let { langMap[it] } ?: value
        }
        return ctx.render(text)
    }
}
