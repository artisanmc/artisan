package net.artisanmc.plugin.render.dialog

import net.artisanmc.plugin.engine.ActionChainCompiler
import net.artisanmc.plugin.engine.ClickHandler
import net.artisanmc.plugin.engine.ConditionParser
import net.artisanmc.plugin.engine.I18nAddress
import net.artisanmc.plugin.model.DialogInputYaml
import net.artisanmc.plugin.model.RuntimeDialog

/** What a dialog's buttons run and how its inputs read back: shared by the Paper and Spigot renderers. */
internal object DialogButtons {

    /** One handler per button, in order: requirements, then `actions` (keyed, DSL string or `{steps}`), else `fallback`. */
    fun handlers(dialog: RuntimeDialog): List<ClickHandler> = dialog.yaml.buttons.map { btnYaml ->
        val requirements = btnYaml.requirements.map { ConditionParser.parse(it) }
        val steps = runCatching {
            ActionChainCompiler.compile(btnYaml.actions, I18nAddress.dialogButton(dialog.yaml.id, btnYaml.id))
        }.getOrElse { e ->
            org.bukkit.Bukkit.getLogger().warning("[Artisan] dialog button '${btnYaml.id}' steps skipped — ${e.message}")
            emptyList()
        }
        ClickHandler(requirements, ActionChainCompiler.compile(btnYaml.fallback), steps = steps)
    }

    /** A number as the actions see it: `3`, not `3.0`. */
    fun number(f: Float?, input: DialogInputYaml): String = when {
        f == null -> input.default.ifEmpty { input.min.toString() }
        f == f.toLong().toFloat() -> f.toLong().toString()
        else -> f.toString()
    }
}
