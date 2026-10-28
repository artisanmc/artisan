package net.artisanmc.plugin.render.dialog

import net.artisanmc.plugin.engine.I18nAddress
import net.artisanmc.plugin.engine.ExecutionContext
import net.artisanmc.plugin.engine.localize
import net.artisanmc.plugin.engine.render
import net.artisanmc.plugin.model.RuntimeDialog
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

    /** Resolves against [ExecutionContext.langMap], [ExecutionContext.lang] and [ExecutionContext.defaultLang] of [ctx]. */
    fun resolveAll(dialog: RuntimeDialog, ctx: ExecutionContext): ResolvedDialogTexts {
        // Canonical i18n addresses, mirror of the editor's visitDialogLTexts:
        // body by INDEX, inputs/options/buttons by ID (stable under reordering).
        val d = dialog.yaml.id
        return ResolvedDialogTexts(
            title = resolve(dialog.yaml.title, ctx, I18nAddress.dialogTitle(d)),
            bodyTexts = dialog.yaml.body.mapIndexed { i, b ->
                b.text?.takeIf { b.type == "text" }?.let { resolve(it, ctx, I18nAddress.dialogBody(d, i)) }
            },
            inputLabels = dialog.yaml.inputs.map {
                resolve(it.label, ctx, I18nAddress.dialogInputLabel(d, it.id))
            },
            inputOptionLabels = dialog.yaml.inputs.map { input ->
                input.options.map {
                    resolve(it.label, ctx, I18nAddress.dialogOptionLabel(d, input.id, it.value))
                }
            },
            buttonLabels = dialog.yaml.buttons.map {
                resolve(it.label, ctx, I18nAddress.dialogButtonLabel(d, it.id))
            },
        )
    }

    /** The slot through [ExecutionContext.localize], then `{arg}` interpolation. */
    fun resolve(raw: LocalizedText?, ctx: ExecutionContext, address: String? = null): String {
        if (raw == null) return ""
        return ctx.render(ctx.localize(raw, address) ?: return "")
    }
}
