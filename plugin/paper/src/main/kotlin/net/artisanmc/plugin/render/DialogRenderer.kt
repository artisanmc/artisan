package net.artisanmc.plugin.render

import net.artisanmc.plugin.engine.compileActionDsl
import net.artisanmc.plugin.engine.I18nAddress
import net.artisanmc.plugin.engine.assignI18nAddresses
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.RuntimeDialog
import net.artisanmc.plugin.model.DialogInputYaml
import io.papermc.paper.dialog.Dialog
import io.papermc.paper.dialog.DialogResponseView
import io.papermc.paper.registry.data.dialog.ActionButton
import io.papermc.paper.registry.data.dialog.DialogBase
import io.papermc.paper.registry.data.dialog.DialogRegistryEntry
import io.papermc.paper.registry.RegistryBuilderFactory
import io.papermc.paper.registry.data.dialog.action.DialogAction
import io.papermc.paper.registry.data.dialog.action.DialogActionCallback
import io.papermc.paper.registry.data.dialog.body.DialogBody
import io.papermc.paper.registry.data.dialog.input.DialogInput
import io.papermc.paper.registry.data.dialog.input.SingleOptionDialogInput
import io.papermc.paper.registry.data.dialog.type.DialogType
import net.kyori.adventure.audience.Audience
import net.kyori.adventure.text.event.ClickCallback
import net.kyori.adventure.text.minimessage.MiniMessage
import org.bukkit.Material
import org.bukkit.entity.Player
import org.bukkit.inventory.ItemStack

object DialogRenderer {


    fun open(player: Player, dialog: RuntimeDialog, lang: String, ctx: ExecutionContext, executor: ActionExecutor) {
        val langMap = dialog.langMapWithFallback(lang)
        val ctxWithLang = ctx.copy(lang = lang, defaultLang = dialog.defaultLang, langMap = langMap)
        // i18n then args ({player} & co): same chain as MenuRenderer.resolveText.
        val texts = DialogTextResolver.resolveAll(dialog, ctxWithLang)

        val bodyComponents: List<DialogBody> = dialog.yaml.body.mapIndexedNotNull { i, b ->
            val body: DialogBody? = when (b.type) {
                "text" -> texts.bodyTexts[i]?.let { DialogBody.plainMessage(LenientText.parse(it)) }
                "item" -> b.material?.let { mat ->
                    runCatching { Material.valueOf(mat.uppercase()) }.getOrNull()?.let { material ->
                        DialogBody.item(ItemStack(material, b.count.coerceAtLeast(1))).build()
                    }
                }
                else -> null
            }
            body
        }

        val inputList: List<DialogInput> = dialog.yaml.inputs.mapIndexedNotNull { i, inputYaml ->
            val label = LenientText.parse(texts.inputLabels[i])
            runCatching {
                when (inputYaml.type) {
                    "text" -> DialogInput.text(inputYaml.id, label)
                        .initial(inputYaml.default)
                        .maxLength(inputYaml.maxLength)
                        .build()
                    "bool" -> DialogInput.bool(inputYaml.id, label)
                        .initial(inputYaml.default.toBooleanStrictOrNull() ?: false)
                        .build()
                    "number_range" -> DialogInput.numberRange(
                        inputYaml.id,
                        label,
                        inputYaml.min.toFloat(),
                        inputYaml.max.toFloat()
                    ).initial(inputYaml.default.toFloatOrNull() ?: inputYaml.min.toFloat())
                        .build()
                    "single_option" -> {
                        val defaultVal = inputYaml.default
                        val entries = inputYaml.options.mapIndexed { j, opt ->
                            SingleOptionDialogInput.OptionEntry.create(
                                opt.value,
                                LenientText.parse(texts.inputOptionLabels[i][j]),
                                opt.value == defaultVal
                            )
                        }
                        DialogInput.singleOption(inputYaml.id, label, entries).build()
                    }
                    else -> null
                }
            }.getOrNull()
        }

        val inputIds = dialog.yaml.inputs.map { it.id }
        val inputsByIdYaml = dialog.yaml.inputs.associateBy { it.id }

        val buttons = dialog.yaml.buttons.mapIndexed { i, btnYaml ->
            val requirements = btnYaml.requirements.map { ConditionParser.parse(it) }
            // Button `actions`: keyed (map/list), DSL string, or `{steps}`.
            val steps        = runCatching {
                ActionChainCompiler.compile(
                    btnYaml.actions,
                    I18nAddress.dialogButton(dialog.yaml.id, btnYaml.id),
                )
            }
                .getOrElse { e ->
                    org.bukkit.Bukkit.getLogger()
                        .warning("[Artisan] dialog button '${btnYaml.id}' steps skipped — ${e.message}")
                    emptyList()
                }
            val fallback     = ActionChainCompiler.compile(btnYaml.fallback)
            val handler      = ClickHandler(requirements, fallback, steps = steps)
            val btnLabel     = LenientText.parse(texts.buttonLabels[i])

            val callback = DialogActionCallback { view: DialogResponseView, _: Audience ->
                val inputValues: Map<String, Any> = inputIds.associateWith { id ->
                    extractInputValue(view, id, inputsByIdYaml[id])
                }
                val newCtx = ctxWithLang.copy(args = ctxWithLang.args + inputValues)
                executor.handle(handler, newCtx)
            }

            val options = ClickCallback.Options.builder()
                .uses(1)
                .lifetime(ClickCallback.DEFAULT_LIFETIME)
                .build()

            ActionButton.builder(btnLabel)
                .action(DialogAction.customClick(callback, options))
                .build()
        }

        val title = LenientText.parse(texts.title)
        val base = DialogBase.builder(title)
            .canCloseWithEscape(dialog.yaml.canCloseWithEscape)
            .body(bodyComponents)
            .inputs(inputList)
            .build()

        if (buttons.isEmpty()) return

        val paperDialog = runCatching {
            val type: DialogType = if (buttons.size == 1) {
                DialogType.notice(buttons[0]) as DialogType
            } else {
                DialogType.multiAction(buttons).build() as DialogType
            }
            @Suppress("UNCHECKED_CAST")
            Dialog.create { factory ->
                @Suppress("UNCHECKED_CAST")
                val builder = (factory as RegistryBuilderFactory<Dialog, DialogRegistryEntry.Builder>).empty()
                builder.base(base).type(type)
            }
        }.getOrNull() ?: return
        player.showDialog(paperDialog)
    }

    private fun extractInputValue(view: DialogResponseView, id: String, inputYaml: DialogInputYaml?): String =
        when (inputYaml?.type) {
            "text"          -> view.getText(id) ?: inputYaml.default
            "bool"          -> view.getBoolean(id)?.toString() ?: inputYaml.default
            "number_range"  -> {
                val f = view.getFloat(id)
                if (f != null) {
                    if (f == f.toLong().toFloat()) f.toLong().toString() else f.toString()
                } else {
                    inputYaml.default.ifEmpty { inputYaml.min.toString() }
                }
            }
            "single_option" -> view.getText(id) ?: inputYaml.default
            else            -> ""
        }
}
