package net.artisanmc.plugin.render.packets

import io.netty.channel.Channel
import net.kyori.adventure.text.Component
import net.kyori.adventure.text.serializer.gson.GsonComponentSerializer
import org.bukkit.Server
import org.bukkit.entity.Player
import org.bukkit.inventory.ItemStack
import java.lang.invoke.MethodHandle
import java.lang.invoke.MethodHandles
import java.lang.reflect.Field
import java.lang.reflect.Modifier

/**
 * [MenuPacketCodec] over the server's own classes, by their Mojang names.
 *
 * Paper (and Folia, Leaf) runs with Mojang names since 1.20.5, Spigot since 26.1 (no more
 * remapping in BuildData). Spigot 1.21.x is obfuscated: [resolve] fails there, and the
 * plugin refuses to start before reaching it (`ServerPlatform.obfuscated`). Every member is looked up
 * once, in [resolve]: a missing one fails the whole codec with its name, instead of a
 * packet failing later on a network thread.
 *
 * Two shapes are handled: `ClientboundContainerSetContentPacket` became a record in
 * 1.21.5 (`containerId()`…, a `List`) and took a `NonNullList` with `getContainerId()`…
 * before; `ClientboundSetPlayerInventoryPacket` exists since 1.21.2 only.
 */
class NmsMenuPackets private constructor(
    private val openScreen: Class<*>,
    private val openScreenNew: MethodHandle,
    private val openScreenId: MethodHandle,
    private val openScreenType: MethodHandle,
    private val openScreenTitle: MethodHandle,
    private val menuTypeId: (Any) -> Int,
    private val content: Class<*>,
    private val contentNew: MethodHandle,
    private val contentList: ((List<Any>) -> Any)?,
    private val contentId: MethodHandle,
    private val contentState: MethodHandle,
    private val contentItems: MethodHandle,
    private val contentCarried: MethodHandle,
    private val setSlot: Class<*>,
    private val setSlotNew: MethodHandle,
    private val setSlotId: MethodHandle,
    private val setSlotState: MethodHandle,
    private val setSlotSlot: MethodHandle,
    private val setSlotItem: MethodHandle,
    private val playerInventory: Class<*>?,
    private val playerInventoryNew: MethodHandle?,
    private val playerInventorySlot: MethodHandle?,
    private val playerInventoryItem: MethodHandle?,
    private val asNmsCopy: MethodHandle,
    override val emptyItem: Any,
    private val toAdventure: (Any) -> Component,
    private val toVanilla: (Component) -> Any,
    private val playerHandle: (Player) -> Any,
    private val gameListener: Field,
    private val connection: Field,
    private val channel: Field,
) : MenuPacketCodec {

    override fun decode(packet: Any): MenuPacket? = when (packet.javaClass) {
        openScreen -> {
            val type = openScreenType.invoke(packet) as Any
            MenuPacket.OpenScreen(openScreenId.invoke(packet) as Int, type, menuTypeId(type), openScreenTitle.invoke(packet) as Any)
        }
        content -> @Suppress("UNCHECKED_CAST") MenuPacket.Content(
            contentId.invoke(packet) as Int, contentState.invoke(packet) as Int,
            contentItems.invoke(packet) as List<Any>, contentCarried.invoke(packet) as Any,
        )
        setSlot -> MenuPacket.Slot(
            setSlotId.invoke(packet) as Int, setSlotState.invoke(packet) as Int,
            setSlotSlot.invoke(packet) as Int, setSlotItem.invoke(packet) as Any,
        )
        playerInventory -> MenuPacket.PlayerInventory(playerInventorySlot!!.invoke(packet) as Int, playerInventoryItem!!.invoke(packet) as Any)
        else -> null
    }

    override fun encode(packet: MenuPacket): Any = when (packet) {
        is MenuPacket.OpenScreen -> openScreenNew.invoke(packet.containerId, packet.type, packet.title)
        is MenuPacket.Content -> contentNew.invoke(
            packet.containerId, packet.stateId, contentList?.invoke(packet.items) ?: packet.items, packet.carried,
        )
        is MenuPacket.Slot -> setSlotNew.invoke(packet.containerId, packet.stateId, packet.slot, packet.item)
        is MenuPacket.PlayerInventory -> checkNotNull(playerInventoryNew) { "no SET_PLAYER_INVENTORY before 1.21.2" }
            .invoke(packet.slot, packet.item)
    } as Any

    override fun item(stack: ItemStack): Any = asNmsCopy.invoke(stack) as Any

    override fun title(raw: Any): Component = toAdventure(raw)

    override fun rawTitle(title: Component): Any = toVanilla(title)

    /** The player's connection channel; null while they are not fully connected. */
    fun channel(player: Player): Channel? {
        val listener = gameListener.get(playerHandle(player)) ?: return null
        val connection = connection.get(listener) ?: return null
        return channel.get(connection) as Channel?
    }

    companion object {
        private val lookup = MethodHandles.publicLookup()

        /** Throws [IllegalStateException] naming the first class or member this server lacks. */
        fun resolve(server: Server): NmsMenuPackets {
            val loader = server.javaClass.classLoader
            fun cls(name: String): Class<*> = runCatching { Class.forName(name, false, loader) }
                .getOrElse { throw IllegalStateException("class $name not found", it) }
            fun game(name: String) = cls("net.minecraft.network.protocol.game.$name")
            fun Class<*>.method(vararg names: String): MethodHandle {
                val method = names.firstNotNullOfOrNull { name -> runCatching { getMethod(name) }.getOrNull() }
                    ?: throw IllegalStateException("$simpleName has none of ${names.joinToString()}")
                return lookup.unreflect(method)
            }
            fun Class<*>.constructor(arity: Int) = constructors.singleOrNull { it.parameterCount == arity }
                ?.let { lookup.unreflectConstructor(it) }
                ?: throw IllegalStateException("$simpleName has no single $arity-argument constructor")

            val nmsItem = cls("net.minecraft.world.item.ItemStack")
            val empty = nmsItem.getField("EMPTY").get(null)

            val openScreen = game("ClientboundOpenScreenPacket")
            val menus = cls("net.minecraft.core.registries.BuiltInRegistries").getField("MENU").get(null)
            val getId = lookup.unreflect(cls("net.minecraft.core.IdMap").getMethod("getId", Any::class.java))

            val content = game("ClientboundContainerSetContentPacket")
            val contentCtor = content.constructors.singleOrNull { it.parameterCount == 4 }
                ?: throw IllegalStateException("ClientboundContainerSetContentPacket has no 4-argument constructor")
            val listType = contentCtor.parameterTypes[2]
            // 1.21.4 and before: a NonNullList, built with the empty stack as its default.
            val contentList: ((List<Any>) -> Any)? = if (listType == List::class.java) null else {
                val of = listType.getMethod("of", Any::class.java, Array<Any>::class.java)
                val list = { items: List<Any> ->
                    val array = java.lang.reflect.Array.newInstance(nmsItem, items.size)
                    items.forEachIndexed { i, item -> java.lang.reflect.Array.set(array, i, item) }
                    of.invoke(null, empty, array) as Any
                }
                list
            }

            val setSlot = game("ClientboundContainerSetSlotPacket")
            val playerInventory = runCatching { Class.forName("net.minecraft.network.protocol.game.ClientboundSetPlayerInventoryPacket", false, loader) }.getOrNull()

            val craftItem = cls("org.bukkit.craftbukkit.inventory.CraftItemStack")
            val nmsComponent = cls("net.minecraft.network.chat.Component")
            // Paper converts Adventure itself; Spigot through the JSON both sides read.
            val paperAdventure = runCatching { Class.forName("io.papermc.paper.adventure.PaperAdventure", false, loader) }.getOrNull()
            val (toAdventure, toVanilla) = if (paperAdventure != null) {
                val asAdventure = lookup.unreflect(paperAdventure.getMethod("asAdventure", nmsComponent))
                val asVanilla = lookup.unreflect(paperAdventure.getMethod("asVanilla", Component::class.java))
                Pair<(Any) -> Component, (Component) -> Any>({ raw -> asAdventure.invoke(raw) as Component }, { title -> asVanilla.invoke(title) as Any })
            } else {
                val chat = cls("org.bukkit.craftbukkit.util.CraftChatMessage")
                val toJson = lookup.unreflect(chat.getMethod("toJSON", nmsComponent))
                val fromJson = lookup.unreflect(chat.getMethod("fromJSON", String::class.java))
                Pair<(Any) -> Component, (Component) -> Any>(
                    { raw -> GsonComponentSerializer.gson().deserialize(toJson.invoke(raw) as String) },
                    { title -> fromJson.invoke(GsonComponentSerializer.gson().serialize(title)) as Any },
                )
            }

            val craftPlayer = cls("org.bukkit.craftbukkit.entity.CraftPlayer")
            val getHandle = lookup.unreflect(craftPlayer.getMethod("getHandle"))
            val serverPlayer = getHandle.type().returnType()
            val connectionClass = cls("net.minecraft.network.Connection")
            val gameListener = serverPlayer.getField("connection")
            // Public on Paper, protected on Spigot (vanilla).
            val connection = field(gameListener.type, connectionClass)
            val channel = field(connectionClass, Channel::class.java)

            return NmsMenuPackets(
                openScreen = openScreen,
                openScreenNew = openScreen.constructor(3),
                openScreenId = openScreen.method("getContainerId", "containerId"),
                openScreenType = openScreen.method("getType", "type"),
                openScreenTitle = openScreen.method("getTitle", "title"),
                menuTypeId = { type -> getId.invoke(menus, type) as Int },
                content = content,
                contentNew = lookup.unreflectConstructor(contentCtor),
                contentList = contentList,
                contentId = content.method("containerId", "getContainerId"),
                contentState = content.method("stateId", "getStateId"),
                contentItems = content.method("items", "getItems"),
                contentCarried = content.method("carriedItem", "getCarriedItem"),
                setSlot = setSlot,
                setSlotNew = setSlot.constructor(4),
                setSlotId = setSlot.method("getContainerId", "containerId"),
                setSlotState = setSlot.method("getStateId", "stateId"),
                setSlotSlot = setSlot.method("getSlot", "slot"),
                setSlotItem = setSlot.method("getItem", "item"),
                playerInventory = playerInventory,
                playerInventoryNew = playerInventory?.constructor(2),
                playerInventorySlot = playerInventory?.method("slot", "getSlot"),
                playerInventoryItem = playerInventory?.method("contents", "getContents"),
                asNmsCopy = lookup.unreflect(craftItem.getMethod("asNMSCopy", ItemStack::class.java)),
                emptyItem = empty,
                toAdventure = toAdventure,
                toVanilla = toVanilla,
                playerHandle = { player -> getHandle.invoke(player) as Any },
                gameListener = gameListener,
                connection = connection,
                channel = channel,
            )
        }

        /** The instance field of [owner] (or a superclass) of type [type], made accessible. */
        private fun field(owner: Class<*>, type: Class<*>): Field {
            var c: Class<*>? = owner
            while (c != null) {
                c.declaredFields.firstOrNull { !Modifier.isStatic(it.modifiers) && it.type == type }
                    ?.let { return it.apply { isAccessible = true } }
                c = c.superclass
            }
            throw IllegalStateException("${owner.simpleName} has no ${type.simpleName} field")
        }
    }
}
