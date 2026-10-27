package net.artisanmc.plugin.render.title

import net.artisanmc.plugin.engine.CompiledAppearance
import net.artisanmc.plugin.engine.RuntimeMenu
import net.artisanmc.plugin.model.ElementYaml
import net.artisanmc.plugin.model.LText
import net.artisanmc.plugin.model.MenuTitleLayer
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.render.menu.ImageButtonLayout
import net.artisanmc.plugin.session.PlayerInventoryMode
import net.kyori.adventure.text.minimessage.MiniMessage
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer
import java.security.MessageDigest

/**
 * The title a Bedrock player receives for a menu the Bedrock pack styles.
 * Mirror of `editor/src/lib/pack/bedrock/bedrockTitle.ts`: the two must agree
 * byte for byte, since the pack's JSON UI reads the title by position.
 *
 *   MARKER  key(2)  [button(1) state(1)]*  [text field]*
 *
 * The pack draws the whole U+F800..U+F8FF page blank, so a Bedrock player
 * without the pack sees nothing readable; a Java player never gets this title.
 */
object BedrockTitle {
    const val MARKER = ''
    private const val KEY_BASE = 0xF880
    private const val KEY_RANGE = 0x7F
    private const val BUTTON_BASE = 0xF800
    private const val BUTTON_MAX = 64
    private const val STATE_BASE = 0xF840
    private const val STATE_MAX = 64
    const val TEXT_FIELD = 48
    const val TEXTAREA_FIELD = 128

    /** The 2-character key of a menu, from the folder name of its project. */
    fun key(projectId: String, menuId: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest("$projectId:$menuId".toByteArray(Charsets.UTF_8))
        val b0 = digest[0].toInt() and 0xFF
        val b1 = digest[1].toInt() and 0xFF
        return String(Character.toChars(KEY_BASE + b0 % KEY_RANGE)) + String(Character.toChars(KEY_BASE + b1 % KEY_RANGE))
    }

    /** Chests of 3 or 6 rows with the player inventory visible: the screens the pack modifies. */
    fun supports(menu: MenuYaml): Boolean =
        menu.inventoryType == "chest" && (menu.size == 27 || menu.size == 54) &&
            PlayerInventoryMode.parse(menu.playerInventory) != PlayerInventoryMode.HIDDEN

    /**
     * The image buttons of a menu, in the order the editor numbers them: no
     * iteration or placement, at least one appearance with an image, and
     * slots forming a rectangle of the menu grid.
     */
    fun buttons(menu: MenuYaml): List<ElementYaml> =
        menu.allElements.filter { el ->
            el.iterates == null && el.places == null &&
                (listOf(el.display) + el.states).any { it.image != null } &&
                ImageButtonLayout.rectangle(menu, el) != null
        }.take(BUTTON_MAX)

    /**
     * The title for a Bedrock player: [choices] is the appearance chosen for
     * each element at this render, [resolve] a text layer's value as its text,
     * with its placeholders resolved and its formatting still in MiniMessage.
     */
    fun compile(
        menu: RuntimeMenu,
        choices: Map<String, CompiledAppearance?>,
        resolve: (LText) -> String,
    ): String {
        val out = StringBuilder().append(MARKER).append(key(menu.projectId, menu.id))
        for ((index, el) in buttons(menu.yaml).withIndex()) {
            val appearances = listOf(el.display) + el.states
            val state = appearances.indexOfFirst { it === choices[el.id]?.yaml }.coerceIn(0, STATE_MAX - 1)
            out.appendCodePoint(BUTTON_BASE + index).appendCodePoint(STATE_BASE + state)
        }
        for (layer in menu.title) {
            val (value, length) = when (layer) {
                is MenuTitleLayer.Text -> layer.value to TEXT_FIELD
                is MenuTitleLayer.Plain -> layer.value to TEXT_FIELD
                is MenuTitleLayer.Textarea -> layer.value to TEXTAREA_FIELD
                else -> continue
            }
            out.append(field(plain(resolve(value)), length))
        }
        return out.toString()
    }

    /** Bedrock labels show the characters as they are: formatting tags come off. */
    private fun plain(mini: String): String =
        runCatching { PlainTextComponentSerializer.plainText().serialize(MiniMessage.miniMessage().deserialize(mini)) }
            .getOrDefault(mini)

    /** A field is exactly [length] characters: cut or padded with spaces. */
    internal fun field(text: String, length: Int): String {
        val cps = text.codePoints().toArray()
        if (cps.size >= length) return String(cps, 0, length)
        return text + " ".repeat(length - cps.size)
    }
}
