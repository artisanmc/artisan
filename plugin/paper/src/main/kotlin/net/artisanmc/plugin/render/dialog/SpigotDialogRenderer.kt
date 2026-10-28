package net.artisanmc.plugin.render.dialog

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import net.artisanmc.plugin.engine.ActionExecutor
import net.artisanmc.plugin.engine.ClickHandler
import net.artisanmc.plugin.engine.ExecutionContext
import net.artisanmc.plugin.model.DialogInputYaml
import net.artisanmc.plugin.model.RuntimeDialog
import net.artisanmc.plugin.text.LenientText
import net.kyori.adventure.text.serializer.gson.GsonComponentSerializer
import net.md_5.bungee.api.chat.BaseComponent
import net.md_5.bungee.api.dialog.DialogBase
import net.md_5.bungee.api.dialog.MultiActionDialog
import net.md_5.bungee.api.dialog.NoticeDialog
import net.md_5.bungee.api.dialog.action.ActionButton
import net.md_5.bungee.api.dialog.action.CustomClickAction
import net.md_5.bungee.api.dialog.body.DialogBody
import net.md_5.bungee.api.dialog.body.PlainMessageBody
import net.md_5.bungee.api.dialog.input.BooleanInput
import net.md_5.bungee.api.dialog.input.DialogInput
import net.md_5.bungee.api.dialog.input.InputOption
import net.md_5.bungee.api.dialog.input.NumberRangeInput
import net.md_5.bungee.api.dialog.input.SingleOptionInput
import net.md_5.bungee.api.dialog.input.TextInput
import net.md_5.bungee.chat.ComponentSerializer
import org.bukkit.Bukkit
import org.bukkit.entity.Player
import org.bukkit.event.Event
import org.bukkit.event.EventPriority
import org.bukkit.event.HandlerList
import org.bukkit.event.Listener
import org.bukkit.event.player.PlayerQuitEvent
import org.bukkit.plugin.Plugin
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Dialogs on Spigot, through the BungeeCord dialog API Spigot ships (same YAML as [DialogRenderer]).
 * Spigot's `showDialog` and `PlayerCustomClickEvent` are absent from paper-api, so both are reached
 * by reflection; nothing here loads on Paper. A button sends `artisan:dialog/<token>/<index>`; the
 * click, with the inputs' values, runs that button's handler once. An item body has no Spigot
 * equivalent and is skipped.
 */
internal object SpigotDialogRenderer {

    private class Pending(
        val token: String,
        val handlers: List<ClickHandler>,
        val inputs: List<DialogInputYaml>,
        val ctx: ExecutionContext,
        val executor: ActionExecutor,
    )

    private val pending = ConcurrentHashMap<UUID, Pending>()
    private val gson = GsonComponentSerializer.gson()
    private val listener = object : Listener {}

    fun open(player: Player, dialog: RuntimeDialog, lang: String, ctx: ExecutionContext, executor: ActionExecutor) {
        if (dialog.yaml.buttons.isEmpty()) return
        val langMap = dialog.langMapWithFallback(lang)
        val ctxWithLang = ctx.copy(lang = lang, defaultLang = dialog.defaultLang, langMap = langMap)
        val texts = DialogTextResolver.resolveAll(dialog, ctxWithLang)
        val token = UUID.randomUUID().toString().substring(0, 8)

        val body: List<DialogBody> = dialog.yaml.body.indices.mapNotNull { i ->
            texts.bodyTexts[i]?.let { PlainMessageBody(component(it)) }
        }
        val inputs: List<DialogInput> = dialog.yaml.inputs.mapIndexedNotNull { i, input ->
            val label = component(texts.inputLabels[i])
            runCatching {
                when (input.type) {
                    "text" -> TextInput(input.id, label).initial(input.default).maxLength(input.maxLength)
                    "bool" -> BooleanInput(input.id, label).initial(input.default.toBooleanStrictOrNull() ?: false)
                    "number_range" -> NumberRangeInput(
                        input.id, label, input.min.toFloat(), input.max.toFloat(),
                        input.default.toFloatOrNull() ?: input.min.toFloat(),
                    )
                    "single_option" -> SingleOptionInput(
                        input.id, label,
                        *input.options.mapIndexed { j, opt ->
                            InputOption(opt.value, component(texts.inputOptionLabels[i][j]), opt.value == input.default)
                        }.toTypedArray(),
                    )
                    else -> null
                }
            }.getOrNull()
        }
        val buttons = dialog.yaml.buttons.indices.map { i ->
            ActionButton(component(texts.buttonLabels[i]), CustomClickAction("artisan:dialog/$token/$i"))
        }
        val base = DialogBase(component(texts.title))
            .canCloseWithEscape(dialog.yaml.canCloseWithEscape)
            .body(body)
            .inputs(inputs)
        val shown = if (buttons.size == 1) NoticeDialog(base, buttons[0]) else MultiActionDialog(base, *buttons.toTypedArray())

        pending[player.uniqueId] = Pending(token, DialogButtons.handlers(dialog), dialog.yaml.inputs, ctxWithLang, executor)
        val spigot = player.spigot()
        spigot.javaClass.getMethod("showDialog", net.md_5.bungee.api.dialog.Dialog::class.java).invoke(spigot, shown)
    }

    /** Listens to Spigot's `PlayerCustomClickEvent` and to quits. Call once at enable, on Spigot only. */
    fun register(plugin: Plugin) {
        @Suppress("UNCHECKED_CAST")
        val type = Class.forName("org.bukkit.event.player.PlayerCustomClickEvent") as Class<out Event>
        val getId = type.getMethod("getId")
        val getData = type.getMethod("getData")
        val manager = plugin.server.pluginManager
        manager.registerEvent(type, listener, EventPriority.NORMAL, { _, event ->
            if (!type.isInstance(event)) return@registerEvent
            val key = getId.invoke(event) as org.bukkit.NamespacedKey
            click((event as org.bukkit.event.player.PlayerEvent).player, key, getData.invoke(event) as JsonElement?)
        }, plugin)
        manager.registerEvent(PlayerQuitEvent::class.java, listener, EventPriority.MONITOR, { _, event ->
            if (event is PlayerQuitEvent) pending.remove(event.player.uniqueId)
        }, plugin)
    }

    fun unregister() {
        HandlerList.unregisterAll(listener)
        pending.clear()
    }

    private fun click(player: Player, key: org.bukkit.NamespacedKey, data: JsonElement?) {
        if (key.namespace != "artisan") return
        val parts = key.key.split('/')
        if (parts.size != 3 || parts[0] != "dialog") return
        val open = pending[player.uniqueId]?.takeIf { it.token == parts[1] } ?: return
        val handler = parts[2].toIntOrNull()?.let(open.handlers::getOrNull) ?: return
        pending.remove(player.uniqueId, open)
        val values = data as? JsonObject
        val inputValues: Map<String, Any> = open.inputs.associate { it.id to value(values?.get(it.id), it) }
        open.executor.handle(handler, open.ctx.copy(args = open.ctx.args + inputValues))
    }

    /** An input's value as the Paper renderer gives it: strings, `true`/`false`, `3` rather than `3.0`. */
    private fun value(element: JsonElement?, input: DialogInputYaml): String {
        val p = element?.takeIf { it.isJsonPrimitive }?.asJsonPrimitive ?: return when (input.type) {
            "number_range" -> DialogButtons.number(null, input)
            "bool", "text", "single_option" -> input.default
            else -> ""
        }
        return when (input.type) {
            "bool" -> if (p.isBoolean) p.asBoolean.toString() else (p.isNumber && p.asDouble != 0.0).toString()
            "number_range" -> DialogButtons.number(if (p.isNumber) p.asFloat else p.asString.toFloatOrNull(), input)
            "text", "single_option" -> p.asString
            else -> ""
        }
    }

    private fun component(text: String): BaseComponent = ComponentSerializer.deserialize(gson.serialize(LenientText.parse(text)))
}
