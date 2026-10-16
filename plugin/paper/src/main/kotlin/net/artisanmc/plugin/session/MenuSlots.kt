package net.artisanmc.plugin.session

import org.bukkit.inventory.ItemStack
import java.util.concurrent.atomic.AtomicReferenceArray

/** A menu's `player_inventory` setting: what the bottom of the window shows. */
enum class PlayerInventoryMode {
    /** The player's real inventory, not editable. Positions `≥ size` are ignored. */
    VISIBLE,
    /** Only the menu's buttons, empty elsewhere. */
    HIDDEN;

    companion object {
        fun parse(raw: String?): PlayerInventoryMode = if (raw.equals("hidden", ignoreCase = true)) HIDDEN else VISIBLE
    }
}

/**
 * Kind of slot. `DISPLAY`: content sent as packets, empty anchor, clicks cancelled.
 * `INPUT` (drop slot): real item in the anchor, packets left untouched. Only `DISPLAY`
 * is produced today; the filtering already exists so adding `INPUT` needs no rework.
 */
enum class SlotKind { DISPLAY, INPUT }

/**
 * Contents of a menu window, addressed by protocol rawSlot: `0 until topSize` the
 * menu, `topSize until topSize + 27` the main inventory, then the 9 hotbar slots.
 *
 * The only write point for a menu's contents: the Bukkit anchor stays empty and the
 * client receives these items as packets ([net.artisanmc.plugin.render.packets.MenuWindows]). While the menu is open,
 * every write is pushed to the client.
 *
 * Written on the main thread, read from network threads.
 */
class MenuSlots(val topSize: Int, val playerInventory: PlayerInventoryMode = PlayerInventoryMode.VISIBLE) {
    val size = topSize + PLAYER_SLOTS

    /** Exclusive bound of the positions a menu can address. */
    val slotLimit = if (playerInventory == PlayerInventoryMode.HIDDEN) size else topSize

    private val items = AtomicReferenceArray<ItemStack?>(size)
    private val kinds = AtomicReferenceArray<SlotKind>(Array(size) { SlotKind.DISPLAY })

    /** Open window receiving the writes, set by [net.artisanmc.plugin.render.packets.MenuWindows]. */
    @Volatile internal var client: Client? = null

    internal interface Client {
        fun slotChanged(rawSlot: Int)
        fun allChanged()
    }

    fun addressable(rawSlot: Int): Boolean = rawSlot in 0 until slotLimit

    /** Does this slot's client content come from this menu (rather than the server)? */
    fun rewrites(rawSlot: Int): Boolean = addressable(rawSlot) && kinds[rawSlot] == SlotKind.DISPLAY

    fun kind(rawSlot: Int): SlotKind = kinds[rawSlot]

    fun setKind(rawSlot: Int, kind: SlotKind) {
        kinds[rawSlot] = kind
    }

    operator fun get(rawSlot: Int): ItemStack? = if (addressable(rawSlot)) items[rawSlot] else null

    /** Outside [addressable] (bottom of a `visible` menu): ignored. */
    operator fun set(rawSlot: Int, item: ItemStack?) {
        if (!addressable(rawSlot)) return
        items[rawSlot] = item?.takeUnless { it.type.isAir }
        client?.slotChanged(rawSlot)
    }

    fun clear() {
        for (i in 0 until size) items[i] = null
        client?.allChanged()
    }

    companion object {
        const val PLAYER_SLOTS = 36

        /**
         * Player inventory index (`SET_PLAYER_INVENTORY`, 1.21.2+) to rawSlot:
         * `0..8` hotbar, `9..35` main; the rest (armor, off hand) is not in the window.
         */
        fun playerInventoryToRaw(index: Int, topSize: Int): Int? = when (index) {
            in 0..8 -> topSize + 27 + index
            in 9..35 -> topSize + index - 9
            else -> null
        }

        /**
         * A window's full contents (`WINDOW_ITEMS`): each rewritten slot from [view],
         * the others untouched. `null` if the size does not match.
         */
        fun <T> rewriteContent(items: List<T>, slots: MenuSlots, view: (Int) -> T): List<T>? {
            if (items.size != slots.size) return null
            return items.mapIndexed { i, item -> if (slots.rewrites(i)) view(i) else item }
        }

        /** One slot (`SET_SLOT`): what the client must see, `null` = packet untouched. */
        fun <T> rewriteSlot(rawSlot: Int, slots: MenuSlots, view: (Int) -> T): T? =
            if (slots.rewrites(rawSlot)) view(rawSlot) else null
    }
}
