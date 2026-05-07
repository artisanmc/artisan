package gg.interfaze.plugin.render

import gg.interfaze.plugin.engine.*
import gg.interfaze.plugin.model.BundleDialog
import gg.interfaze.plugin.model.DialogInputYaml
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

    private val mm = MiniMessage.miniMessage()

    fun open(player: Player, dialog: BundleDialog, lang: String, ctx: ExecutionContext, executor: ActionExecutor) {
        val langMap = dialog.langMaps[lang] ?: emptyMap()
        val ctxWithLang = ctx.copy(lang = lang, langMap = langMap)

        val bodyComponents: List<DialogBody> = dialog.yaml.body.mapNotNull { b ->
            val body: DialogBody? = when (b.type) {
                "text" -> b.text?.let { DialogBody.plainMessage(mm.deserialize(resolveI18n(it, langMap))) }
                "item" -> b.material?.let { mat ->
                    runCatching { Material.valueOf(mat.uppercase()) }.getOrNull()?.let { material ->
                        DialogBody.item(ItemStack(material, b.count.coerceAtLeast(1))).build()
                    }
                }
                else -> null
            }
            body
        }

        val inputList: List<DialogInput> = dialog.yaml.inputs.mapNotNull { inputYaml ->
            val label = mm.deserialize(resolveI18n(inputYaml.label, langMap))
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
                        val entries = inputYaml.options.map { opt ->
                            SingleOptionDialogInput.OptionEntry.create(
                                opt.value,
                                mm.deserialize(resolveI18n(opt.label, langMap)),
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

        val buttons = dialog.yaml.buttons.map { btnYaml ->
            val requirements = btnYaml.requirements.map { ConditionParser.parse(it) }
            val actions      = btnYaml.actions.map { ActionParser.parse(it) }
            val fallback     = btnYaml.fallback.map { ActionParser.parse(it) }
            val handler      = ClickHandler(requirements, actions, fallback)
            val btnLabel     = mm.deserialize(resolveI18n(btnYaml.label, langMap))

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

        val title = mm.deserialize(resolveI18n(dialog.yaml.title, langMap))
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

    private fun resolveI18n(raw: String, langMap: Map<String, String>): String {
        if (!raw.startsWith("{i18n:")) return raw
        val key = raw.removePrefix("{i18n:").removeSuffix("}")
        return langMap[key] ?: raw
    }
}
