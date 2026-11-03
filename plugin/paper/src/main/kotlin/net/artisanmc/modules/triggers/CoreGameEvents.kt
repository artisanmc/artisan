package net.artisanmc.modules.triggers

import net.artisanmc.modules.api.gameevent.GameEventDeclaration
import net.artisanmc.modules.api.gameevent.GameEventFrame
import net.artisanmc.modules.api.gameevent.GameEventFrequency
import net.artisanmc.modules.api.gameevent.GameEventFrequency.NORMAL
import net.artisanmc.modules.api.gameevent.GameEventFrequency.RARE
import net.artisanmc.modules.api.model.ModelField
import net.artisanmc.modules.api.model.ModelFieldType
import net.artisanmc.modules.api.text.TextApi
import org.bukkit.Bukkit
import org.bukkit.Location
import org.bukkit.block.Block
import org.bukkit.entity.Entity
import org.bukkit.entity.Player
import org.bukkit.event.Event
import org.bukkit.event.block.Action
import org.bukkit.event.block.BlockBreakEvent
import org.bukkit.event.block.BlockPlaceEvent
import org.bukkit.event.enchantment.EnchantItemEvent
import org.bukkit.event.entity.EntityDamageEvent
import org.bukkit.event.entity.EntityDeathEvent
import org.bukkit.event.entity.EntityPickupItemEvent
import org.bukkit.event.entity.FoodLevelChangeEvent
import org.bukkit.event.entity.PlayerDeathEvent
import org.bukkit.event.inventory.CraftItemEvent
import org.bukkit.event.player.PlayerAdvancementDoneEvent
import org.bukkit.event.player.PlayerBedEnterEvent
import org.bukkit.event.player.PlayerChangedWorldEvent
import org.bukkit.event.player.PlayerCommandPreprocessEvent
import org.bukkit.event.player.PlayerDropItemEvent
import org.bukkit.event.player.PlayerFishEvent
import org.bukkit.event.player.PlayerGameModeChangeEvent
import org.bukkit.event.player.PlayerInteractEntityEvent
import org.bukkit.event.player.PlayerInteractEvent
import org.bukkit.event.player.PlayerItemBreakEvent
import org.bukkit.event.player.PlayerItemConsumeEvent
import org.bukkit.event.player.PlayerJoinEvent
import org.bukkit.event.player.PlayerKickEvent
import org.bukkit.event.player.PlayerLevelChangeEvent
import org.bukkit.event.player.PlayerPortalEvent
import org.bukkit.event.player.PlayerQuitEvent
import org.bukkit.event.player.PlayerRespawnEvent
import org.bukkit.event.player.PlayerTeleportEvent
import org.bukkit.event.player.PlayerToggleFlightEvent
import org.bukkit.inventory.EquipmentSlot
import org.bukkit.inventory.ItemStack

/**
 * Artisan's catalog of Game events (ADR `triggers-and-variables` §2): the Bukkit events a Trigger
 * may listen to, each declared with its typed context and effects. Every entry passes the admission
 * rules, checked by `CoreGameEventsTest`: synchronous on the player's thread, one player, RARE or
 * NORMAL, nothing read by reflection, present on Paper and Spigot.
 *
 * Context values are plain maps, the shapes of [LOCATION], [ITEM], [BLOCK], [ENTITY] and
 * [PLAYER]: templates read them as `{event.location.x}`, conditions compare them.
 */
internal object CoreGameEvents {
    // ── Field types ─────────────────────────────────────────────────────────

    val LOCATION: ModelFieldType = ModelFieldType.`object`(listOf(
        field("world", ModelFieldType.string()),
        field("x", ModelFieldType.number()),
        field("y", ModelFieldType.number()),
        field("z", ModelFieldType.number()),
        field("yaw", ModelFieldType.number()),
        field("pitch", ModelFieldType.number()),
    ))
    val ITEM: ModelFieldType = ModelFieldType.`object`(listOf(
        field("type", ModelFieldType.string()),
        field("amount", ModelFieldType.integer()),
    ))
    val BLOCK: ModelFieldType = ModelFieldType.`object`(listOf(
        field("type", ModelFieldType.string()),
        field("location", LOCATION),
    ))
    val ENTITY: ModelFieldType = ModelFieldType.`object`(listOf(
        field("type", ModelFieldType.string()),
        field("name", ModelFieldType.string()),
        field("uuid", ModelFieldType.string()),
    ))
    val PLAYER: ModelFieldType = ModelFieldType.`object`(listOf(
        field("name", ModelFieldType.string()),
        field("uuid", ModelFieldType.string()),
    ))

    private fun field(name: String, type: ModelFieldType) = ModelField(name, type)
    private fun text(name: String) = field(name, ModelFieldType.string())
    private fun int(name: String) = field(name, ModelFieldType.integer())
    private fun num(name: String) = field(name, ModelFieldType.number())
    private fun bool(name: String) = field(name, ModelFieldType.bool())
    private fun message(name: String) = field(name, ModelFieldType.minimessage())
    private fun location(name: String = "location") = field(name, LOCATION)
    private fun item(name: String = "item") = field(name, ITEM)
    private fun block(name: String = "block") = field(name, BLOCK)
    private fun entity(name: String = "entity") = field(name, ENTITY)
    private fun player(name: String) = field(name, PLAYER)

    // ── Values ──────────────────────────────────────────────────────────────

    private fun round(d: Double): Double = Math.round(d * 100) / 100.0

    /** A [LocationValue]: read field by field (`{event.location.x}`), as `world x y z` in a text, as a place by `teleport`. */
    fun locationOf(l: Location?): Map<String, Any?>? = l?.let {
        val world = it.world?.name ?: return@let null
        net.artisanmc.plugin.engine.LocationValue(
            world, round(it.x), round(it.y), round(it.z), round(it.yaw.toDouble()), round(it.pitch.toDouble()),
        )
    }
    fun itemOf(i: ItemStack?): Map<String, Any?>? =
        i?.takeIf { !it.type.isAir }?.let { mapOf("type" to it.type.key.key, "amount" to it.amount) }
    fun blockOf(b: Block?): Map<String, Any?>? = b?.let { mapOf("type" to it.type.key.key, "location" to locationOf(it.location)) }
    fun entityOf(e: Entity?): Map<String, Any?>? =
        e?.let { mapOf("type" to it.type.key.key, "name" to it.name, "uuid" to it.uniqueId.toString()) }
    fun playerOf(p: Player?): Map<String, Any?>? = p?.let { mapOf("name" to it.name, "uuid" to it.uniqueId.toString()) }

    private fun key(e: Enum<*>): String = e.name.lowercase()

    /**
     * A message effect Bukkit would send as one string to everyone (join, quit, death): the event's
     * own message is cleared and each player gets the text in their language, the console in the
     * project's default one. An empty text sends nothing to that reader.
     */
    private fun announce(text: TextApi, frame: GameEventFrame, name: String, except: Player?, clear: () -> Unit) {
        if (!frame.has(name)) return
        clear()
        for (viewer in Bukkit.getOnlinePlayers()) {
            if (viewer.uniqueId == except?.uniqueId) continue
            frame.getText(name, viewer)?.takeIf { it.isNotEmpty() }?.let { text.send(viewer, it) }
        }
        frame.getText(name, null)?.takeIf { it.isNotEmpty() }?.let { text.send(Bukkit.getConsoleSender(), it) }
    }

    /** A message effect for one reader, as the legacy string Bukkit's setters take; empty = none. */
    private fun legacyFor(text: TextApi, frame: GameEventFrame, name: String, reader: Player): String? =
        frame.getText(name, reader)?.let { if (it.isEmpty()) null else text.legacy(it) }

    private fun GameEventFrame.has(name: String) = getEffect(name) != null
    private fun GameEventFrame.bool(name: String) = getEffect(name) as? Boolean
    private fun GameEventFrame.long(name: String) = (getEffect(name) as? Number)?.toLong()
    private fun GameEventFrame.double(name: String) = (getEffect(name) as? Number)?.toDouble()

    // ── Catalog ─────────────────────────────────────────────────────────────

    private inline fun <reified E : Event> on(
        name: String,
        group: String,
        frequency: GameEventFrequency,
        context: List<ModelField>,
        cancellable: Boolean = false,
        effects: List<ModelField> = emptyList(),
        ignoreCancelled: Boolean = true,
        noinline accept: (E) -> Boolean = { true },
        noinline player: (E) -> Player?,
        noinline values: (E) -> Map<String, Any?>,
        noinline apply: (E, GameEventFrame, TextApi) -> Unit = { _, _, _ -> },
    ) = CatalogEvent(
        E::class.java,
        GameEventDeclaration(name, group, frequency, context, cancellable, effects),
        ignoreCancelled, accept, player, values, apply,
    )

    /**
     * Events Artisan fires itself, not from a Bukkit listener. `variable_changed` (ADR
     * `triggers-and-variables` §5, §10): a Variable's value changed for the player. `var` is its
     * name as `var.` reads it (`last_death`, `guilds.rank`), `project` the project of a Project
     * variable ("" for a module's), `key` the key of a keyed module Variable ("" otherwise).
     */
    val VARIABLE_CHANGED: GameEventDeclaration = GameEventDeclaration(
        "variable_changed", "variables", NORMAL, listOf(text("var"), text("project"), text("key")),
    )

    val FIRED_BY_ARTISAN: List<GameEventDeclaration> = listOf(VARIABLE_CHANGED)

    @Suppress("DEPRECATION") // the String setters exist on Spigot and Paper alike
    val ALL: List<CatalogEvent<*>> = listOf(
        // Connection
        on<PlayerJoinEvent>("player_join", "connection", RARE,
            context = listOf(location(), bool("first_join")),
            effects = listOf(message("join_message")),
            player = { it.player },
            values = { mapOf("location" to locationOf(it.player.location), "first_join" to !it.player.hasPlayedBefore()) },
            apply = { e, f, t -> announce(t, f, "join_message", except = null) { e.joinMessage = null } }),
        on<PlayerJoinEvent>("player_first_join", "connection", RARE,
            context = listOf(location()),
            effects = listOf(message("join_message")),
            accept = { !it.player.hasPlayedBefore() },
            player = { it.player },
            values = { mapOf("location" to locationOf(it.player.location)) },
            apply = { e, f, t -> announce(t, f, "join_message", except = null) { e.joinMessage = null } }),
        on<PlayerQuitEvent>("player_quit", "connection", RARE,
            context = listOf(location()),
            effects = listOf(message("quit_message")),
            player = { it.player },
            values = { mapOf("location" to locationOf(it.player.location)) },
            apply = { e, f, t -> announce(t, f, "quit_message", except = e.player) { e.quitMessage = null } }),
        on<PlayerKickEvent>("player_kick", "connection", RARE,
            context = listOf(text("reason")),
            cancellable = true,
            effects = listOf(message("reason"), message("leave_message")),
            player = { it.player },
            values = { mapOf("reason" to it.reason) },
            apply = { e, f, t ->
                if (f.has("reason")) e.reason = legacyFor(t, f, "reason", e.player) ?: ""
                // A cancelled kick leaves no one: nothing to announce.
                if (!e.isCancelled) announce(t, f, "leave_message", except = e.player) { e.leaveMessage = "" }
            }),

        // Life
        on<PlayerDeathEvent>("player_death", "life", RARE,
            context = listOf(location(), text("cause"), player("killer"), int("level"), text("death_message")),
            effects = listOf(message("death_message"), bool("keep_inventory"), bool("keep_level"), bool("clear_drops"), int("dropped_exp")),
            player = { it.entity },
            values = {
                mapOf(
                    "location" to locationOf(it.entity.location),
                    "cause" to it.entity.lastDamageCause?.cause?.let(::key),
                    "killer" to playerOf(it.entity.killer),
                    "level" to it.entity.level,
                    "death_message" to it.deathMessage,
                )
            },
            apply = { e, f, t ->
                announce(t, f, "death_message", except = null) { e.deathMessage = null }
                f.bool("keep_inventory")?.let { keep -> e.keepInventory = keep; if (keep) e.drops.clear() }
                f.bool("keep_level")?.let { keep -> e.keepLevel = keep; if (keep) e.droppedExp = 0 }
                if (f.bool("clear_drops") == true) e.drops.clear()
                f.long("dropped_exp")?.let { e.droppedExp = it.toInt().coerceAtLeast(0) }
            }),
        on<PlayerRespawnEvent>("player_respawn", "life", RARE,
            context = listOf(location(), bool("bed_spawn"), bool("anchor_spawn")),
            player = { it.player },
            values = { mapOf("location" to locationOf(it.respawnLocation), "bed_spawn" to it.isBedSpawn, "anchor_spawn" to it.isAnchorSpawn) }),
        on<EntityDamageEvent>("player_damage", "life", NORMAL,
            context = listOf(text("cause"), num("damage"), num("health")),
            cancellable = true,
            effects = listOf(num("damage")),
            accept = { it.entity is Player },
            player = { it.entity as? Player },
            values = { mapOf("cause" to key(it.cause), "damage" to round(it.damage), "health" to round((it.entity as Player).health)) },
            apply = { e, f, _ -> f.double("damage")?.let { e.damage = it.coerceAtLeast(0.0) } }),
        on<FoodLevelChangeEvent>("player_food_change", "life", NORMAL,
            context = listOf(int("food_level"), int("previous_level")),
            cancellable = true,
            effects = listOf(int("food_level")),
            player = { it.entity as? Player },
            values = { mapOf("food_level" to it.foodLevel, "previous_level" to (it.entity as Player).foodLevel) },
            apply = { e, f, _ -> f.long("food_level")?.let { e.foodLevel = it.toInt().coerceIn(0, 20) } }),

        // World
        on<PlayerChangedWorldEvent>("player_change_world", "world", RARE,
            context = listOf(text("from_world"), text("world"), location()),
            player = { it.player },
            values = { mapOf("from_world" to it.from.name, "world" to it.player.world.name, "location" to locationOf(it.player.location)) }),
        on<PlayerTeleportEvent>("player_teleport", "world", NORMAL,
            context = listOf(location("from"), location("to"), text("cause")),
            cancellable = true,
            player = { it.player },
            values = { mapOf("from" to locationOf(it.from), "to" to locationOf(it.to), "cause" to key(it.cause)) }),
        on<PlayerPortalEvent>("player_portal", "world", RARE,
            context = listOf(location("from"), location("to"), text("cause")),
            cancellable = true,
            player = { it.player },
            values = { mapOf("from" to locationOf(it.from), "to" to locationOf(it.to), "cause" to key(it.cause)) }),
        on<PlayerBedEnterEvent>("player_bed_enter", "world", RARE,
            context = listOf(block("bed"), text("result")),
            cancellable = true,
            player = { it.player },
            values = { mapOf("bed" to blockOf(it.bed), "result" to key(it.bedEnterResult)) }),
        on<PlayerGameModeChangeEvent>("player_gamemode_change", "world", RARE,
            context = listOf(text("gamemode"), text("previous_gamemode")),
            cancellable = true,
            player = { it.player },
            values = { mapOf("gamemode" to key(it.newGameMode), "previous_gamemode" to key(it.player.gameMode)) }),
        on<PlayerToggleFlightEvent>("player_toggle_flight", "world", NORMAL,
            context = listOf(bool("flying")),
            cancellable = true,
            player = { it.player },
            values = { mapOf("flying" to it.isFlying) }),

        // Blocks
        on<BlockBreakEvent>("block_break", "blocks", NORMAL,
            context = listOf(block(), item("tool")),
            cancellable = true,
            effects = listOf(int("exp_to_drop"), bool("drop_items")),
            player = { it.player },
            values = { mapOf("block" to blockOf(it.block), "tool" to itemOf(it.player.inventory.itemInMainHand)) },
            apply = { e, f, _ ->
                f.long("exp_to_drop")?.let { e.expToDrop = it.toInt().coerceAtLeast(0) }
                f.bool("drop_items")?.let { e.isDropItems = it }
            }),
        on<BlockPlaceEvent>("block_place", "blocks", NORMAL,
            context = listOf(block(), block("against")),
            cancellable = true,
            player = { it.player },
            values = { mapOf("block" to blockOf(it.blockPlaced), "against" to blockOf(it.blockAgainst)) }),
        // A right click in the air reaches listeners already cancelled (Bukkit denies the block
        // use): `ignoreCancelled` would hide it. What counts is a denied item use, or a denied
        // block use on a clicked block: that is what a protection plugin sets.
        on<PlayerInteractEvent>("player_interact", "blocks", NORMAL,
            context = listOf(text("action"), block(), item()),
            cancellable = true,
            ignoreCancelled = false,
            accept = {
                it.hand == EquipmentSlot.HAND && it.action != Action.PHYSICAL &&
                    it.useItemInHand() != Event.Result.DENY &&
                    (it.clickedBlock == null || it.useInteractedBlock() != Event.Result.DENY)
            },
            player = { it.player },
            values = { mapOf("action" to key(it.action), "block" to blockOf(it.clickedBlock), "item" to itemOf(it.item)) }),
        on<PlayerInteractEntityEvent>("player_interact_entity", "blocks", NORMAL,
            context = listOf(entity(), item()),
            cancellable = true,
            accept = { it.hand == EquipmentSlot.HAND },
            player = { it.player },
            values = { mapOf("entity" to entityOf(it.rightClicked), "item" to itemOf(it.player.inventory.itemInMainHand)) }),

        // Items
        on<PlayerDropItemEvent>("player_drop_item", "items", NORMAL,
            context = listOf(item()),
            cancellable = true,
            player = { it.player },
            values = { mapOf("item" to itemOf(it.itemDrop.itemStack)) }),
        on<EntityPickupItemEvent>("player_pickup_item", "items", NORMAL,
            context = listOf(item()),
            cancellable = true,
            player = { it.entity as? Player },
            values = { mapOf("item" to itemOf(it.item.itemStack)) }),
        on<PlayerItemConsumeEvent>("player_consume_item", "items", NORMAL,
            context = listOf(item()),
            cancellable = true,
            player = { it.player },
            values = { mapOf("item" to itemOf(it.item)) }),
        on<PlayerFishEvent>("player_fish", "items", NORMAL,
            context = listOf(text("state"), entity("caught")),
            cancellable = true,
            player = { it.player },
            values = { mapOf("state" to key(it.state), "caught" to entityOf(it.caught)) }),
        on<CraftItemEvent>("craft_item", "items", NORMAL,
            context = listOf(item()),
            cancellable = true,
            player = { it.whoClicked as? Player },
            values = { mapOf("item" to itemOf(it.recipe.result)) }),
        on<EnchantItemEvent>("enchant_item", "items", RARE,
            context = listOf(item(), int("level_cost")),
            cancellable = true,
            player = { it.enchanter },
            values = { mapOf("item" to itemOf(it.item), "level_cost" to it.expLevelCost) }),
        on<PlayerItemBreakEvent>("player_item_break", "items", RARE,
            context = listOf(item()),
            player = { it.player },
            values = { mapOf("item" to itemOf(it.brokenItem)) }),

        // Combat
        on<EntityDeathEvent>("player_kill_entity", "combat", NORMAL,
            context = listOf(entity(), location()),
            effects = listOf(int("dropped_exp"), bool("clear_drops")),
            accept = { it.entity !is Player && it.entity.killer != null },
            player = { it.entity.killer },
            values = { mapOf("entity" to entityOf(it.entity), "location" to locationOf(it.entity.location)) },
            apply = { e, f, _ ->
                f.long("dropped_exp")?.let { e.droppedExp = it.toInt().coerceAtLeast(0) }
                if (f.bool("clear_drops") == true) e.drops.clear()
            }),
        on<PlayerDeathEvent>("player_kill_player", "combat", RARE,
            context = listOf(player("victim"), location()),
            accept = { it.entity.killer != null && it.entity.killer != it.entity },
            player = { it.entity.killer },
            values = { mapOf("victim" to playerOf(it.entity), "location" to locationOf(it.entity.location)) }),

        // Progression
        on<PlayerLevelChangeEvent>("player_level_change", "progression", NORMAL,
            context = listOf(int("level"), int("previous_level")),
            player = { it.player },
            values = { mapOf("level" to it.newLevel, "previous_level" to it.oldLevel) }),
        // Recipe unlocks are advancements too, by the dozen: left out, they are not progression.
        on<PlayerAdvancementDoneEvent>("player_advancement_done", "progression", RARE,
            context = listOf(text("advancement")),
            accept = { !it.advancement.key.key.startsWith("recipes/") },
            player = { it.player },
            values = { mapOf("advancement" to it.advancement.key.toString()) }),

        // Commands
        on<PlayerCommandPreprocessEvent>("player_command", "commands", NORMAL,
            context = listOf(text("command"), text("message")),
            cancellable = true,
            player = { it.player },
            values = { mapOf("command" to it.message.removePrefix("/").substringBefore(' ').lowercase(), "message" to it.message) }),
    )
}
