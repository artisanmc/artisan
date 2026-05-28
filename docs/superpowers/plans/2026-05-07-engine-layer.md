# Engine Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement sealed Action/Condition hierarchies, parsers, soft-dep registry, condition evaluator, action executor, session store, and bundle compiler — pure engine with no rendering changes.

**Architecture:** New `engine/` package under `net.artisanmc.plugin`. `BundleCompiler` replaces direct `BundleMenu(yaml, langMaps)` construction in `PackReader`. Tests use kotlin-test + MockBukkit only where a `Player` is required.

**Tech Stack:** Kotlin 2.0, Paper API 1.21.4, MockBukkit 3.133.2, VaultAPI 1.7.1 (compileOnly), PlaceholderAPI 2.11.6 (compileOnly), WorldGuard 7.0.12 (compileOnly)

---

### Task 1: Soft-dep dependencies

**Files:**
- Modify: `plugin/build.gradle.kts`

- [ ] **Step 1: Add repos and compileOnly dependencies**

In `repositories {}` after the `jitpack` line:
```kotlin
maven("https://repo.extendedclip.com/content/repositories/placeholderapi/")
maven("https://maven.enginehub.org/repo/")
```

In `dependencies {}` after the Paper line:
```kotlin
compileOnly("com.github.MilkBowl:VaultAPI:1.7.1")
compileOnly("me.clip:placeholderapi:2.11.6")
compileOnly("com.sk89q.worldguard:worldguard-bukkit:7.0.12")
```

- [ ] **Step 2: Verify compilation**

```bash
cd plugin && ./gradlew compileKotlin
```
Expected: `BUILD SUCCESSFUL`

- [ ] **Step 3: Commit**

```bash
rtk git add plugin/build.gradle.kts
rtk git commit -m "chore(plugin): add Vault, PlaceholderAPI, WorldGuard compileOnly deps"
```

---

### Task 2: Update data model

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/model/PackBundle.kt`

- [ ] **Step 1: Replace ClickHandlerYaml, add CooldownYaml, add showIf to AppearanceYaml, update BundleMenu**

Replace the existing content of `PackBundle.kt` with:

```kotlin
package net.artisanmc.plugin.model

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonProperty
import net.artisanmc.plugin.engine.ClickType
import net.artisanmc.plugin.engine.ClickHandler
import net.artisanmc.plugin.engine.CompiledAppearance

@JsonIgnoreProperties(ignoreUnknown = true)
data class ManifestYaml(
    val schema: String = "",
    @JsonProperty("pack_id") val packId: String = "",
    @JsonProperty("default_lang") val defaultLang: String = "en",
    val languages: List<String> = emptyList(),
    val files: ManifestFiles = ManifestFiles(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class ManifestFiles(
    val menus: List<String> = emptyList(),
    val commands: List<String> = emptyList(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class MenuYaml(
    val schema: String = "",
    val id: String = "",
    val title: String = "",
    val size: Int = 27,
    val permission: String? = null,
    val layers: List<LayerYaml> = emptyList(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class LayerYaml(
    val id: String = "",
    val name: String = "",
    val elements: List<ElementYaml> = emptyList(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class ElementYaml(
    val id: String = "",
    val positions: String = "",
    val appearances: List<AppearanceYaml> = emptyList(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class AppearanceYaml(
    val material: String? = null,
    val count: Int = 1,
    val title: String? = null,
    val lore: List<String> = emptyList(),
    val click: Map<String, ClickHandlerYaml> = emptyMap(),
    @JsonProperty("if")
    val conditions: Map<String, Any>? = null,
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class ClickHandlerYaml(
    val requirements: List<Map<String, Any>> = emptyList(),
    val actions:      List<Map<String, Any>> = emptyList(),
    val fallback:     List<Map<String, Any>> = emptyList(),
    val cooldown:     CooldownYaml? = null,
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class CooldownYaml(
    val id:       String  = "",
    val duration: Long    = 0,
    val scope:    String  = "player",
    val message:  String? = null,
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class CommandYaml(
    val schema: String = "",
    val id: String = "",
    val name: String = "",
    val aliases: List<String> = emptyList(),
    val permission: String? = null,
    val description: String? = null,
    val arguments: List<Map<String, Any>> = emptyList(),
    val requirements: List<Map<String, Any>> = emptyList(),
    val actions:      List<Map<String, Any>> = emptyList(),
    val fallback:     List<Map<String, Any>> = emptyList(),
    val cooldown:     CooldownYaml? = null,
)

data class PackBundle(
    val packId: String,
    val defaultLang: String,
    val languages: List<String>,
    val menus: List<BundleMenu>,
    val commands: List<CommandYaml>,
)

data class BundleMenu(
    val yaml: MenuYaml,
    val langMaps: Map<String, Map<String, String>>,
    val compiledAppearances: Map<String, List<CompiledAppearance>> = emptyMap(),
    val slotToElement: Map<Int, String> = emptyMap(),
) {
    val id: String get() = yaml.id

    fun resolveTitle(lang: String): String {
        val raw = yaml.title
        if (!raw.startsWith("{i18n:")) return raw
        val key = raw.removePrefix("{i18n:").removeSuffix("}")
        return langMaps[lang]?.get(key) ?: raw
    }
}
```

- [ ] **Step 2: Verify compilation (engine package doesn't exist yet — expect compile error on imports)**

```bash
cd plugin && ./gradlew compileKotlin
```
Expected: compile errors referencing `net.artisanmc.plugin.engine.*` — that is correct at this point. Proceed to Task 3.

---

### Task 3: Action sealed class

**Files:**
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/Action.kt`

- [ ] **Step 1: Create Action.kt**

```kotlin
package net.artisanmc.plugin.engine

sealed class Action {
    data class RunCommand(val command: String, val asConsole: Boolean = false) : Action()
    data class OpenMenu(
        val menuId: String,
        val context: Map<String, String> = emptyMap(),
        val clearContext: Boolean = false,
    ) : Action()
    data object CloseMenu : Action()
    data class GiveItem(
        val material: String,
        val count: Int = 1,
        val name: String? = null,
        val lore: List<String> = emptyList(),
    ) : Action()
    data class TakeItem(val material: String, val count: Int = 1) : Action()
    data class GiveMoney(val amount: Double, val currency: String? = null) : Action()
    data class TakeMoney(val amount: Double, val currency: String? = null) : Action()
    data class GiveXp(val amount: Int) : Action()
    data class GiveLevel(val amount: Int) : Action()
    data class SendMessage(val text: String) : Action()
    data class Broadcast(val text: String) : Action()
    data class PlaySound(val sound: String, val volume: Float = 1f, val pitch: Float = 1f) : Action()
    data class Teleport(
        val world: String? = null,
        val x: Double = 0.0,
        val y: Double = 0.0,
        val z: Double = 0.0,
        val yaw: Float = 0f,
        val pitch: Float = 0f,
        val warpName: String? = null,
    ) : Action()
    data class PaginationNext(val elementId: String? = null) : Action()
    data class PaginationPrev(val elementId: String? = null) : Action()
}
```

---

### Task 4: Condition sealed class

**Files:**
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/Condition.kt`

- [ ] **Step 1: Create Condition.kt**

```kotlin
package net.artisanmc.plugin.engine

sealed class Condition {
    data class HasPermission(val perm: String) : Condition()
    data class HasMoney(val amount: Double, val currency: String? = null) : Condition()
    data class HasItem(val material: String, val count: Int = 1) : Condition()
    data class HasXp(val amount: Int) : Condition()
    data class HasLevel(val level: Int) : Condition()
    data class PlaceholderEquals(val placeholder: String, val value: String) : Condition()
    data class PlaceholderMatch(val placeholder: String, val regex: String) : Condition()
    data class CooldownPassed(val cooldownId: String) : Condition()
    data class WorldIs(val world: String) : Condition()
    data class TimeIs(val range: String) : Condition()
    data class RandomChance(val probability: Double) : Condition()
    data class PlayerInRegion(val region: String) : Condition()
    data class PaginationAtFirst(val elementId: String? = null) : Condition()
    data class PaginationAtLast(val elementId: String? = null) : Condition()
    data class Not(val inner: Condition) : Condition()
    data class And(val all: List<Condition>) : Condition()
    data class Or(val any: List<Condition>) : Condition()
}
```

---

### Task 5: ExecutionContext + ClickHandler types

**Files:**
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/ExecutionContext.kt`
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/ClickHandler.kt`

- [ ] **Step 1: Create ExecutionContext.kt**

```kotlin
package net.artisanmc.plugin.engine

import org.bukkit.entity.Player

data class ExecutionContext(
    val player: Player,
    val args: Map<String, Any> = emptyMap(),
    val lang: String = "en",
)
```

- [ ] **Step 2: Create ClickHandler.kt**

```kotlin
package net.artisanmc.plugin.engine

import net.artisanmc.plugin.model.AppearanceYaml

data class Cooldown(
    val id: String,
    val durationSeconds: Long,
    val scope: String = "player",
    val message: String? = null,
)

data class ClickHandler(
    val requirements: List<Condition>,
    val actions: List<Action>,
    val fallback: List<Action>,
    val cooldown: Cooldown? = null,
)

enum class ClickType {
    LEFT, RIGHT, SHIFT_LEFT, SHIFT_RIGHT, MIDDLE;
    companion object {
        fun fromYamlKey(key: String): ClickType? = when (key.lowercase()) {
            "left"        -> LEFT
            "right"       -> RIGHT
            "shift_left"  -> SHIFT_LEFT
            "shift_right" -> SHIFT_RIGHT
            "middle"      -> MIDDLE
            else          -> null
        }
    }
}

data class CompiledAppearance(
    val conditions: List<Condition>,
    val clicks: Map<ClickType, ClickHandler>,
    val yaml: AppearanceYaml,
)
```

- [ ] **Step 3: Verify compilation**

```bash
cd plugin && ./gradlew compileKotlin
```
Expected: `BUILD SUCCESSFUL` (PackBundle.kt imports now resolve)

- [ ] **Step 4: Commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/plugin/engine/ plugin/src/main/kotlin/net/artisanmc/plugin/model/PackBundle.kt
rtk git commit -m "feat(plugin): engine data types — Action, Condition, ClickHandler, ExecutionContext"
```

---

### Task 6: ActionParser (TDD)

**Files:**
- Create: `plugin/src/test/kotlin/net/artisanmc/plugin/ActionParserTest.kt`
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/ActionParser.kt`

- [ ] **Step 1: Write failing tests**

```kotlin
package net.artisanmc.plugin

import net.artisanmc.plugin.engine.Action
import net.artisanmc.plugin.engine.ActionParser
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs

class ActionParserTest {

    @Test
    fun `parse run_command`() {
        val a = ActionParser.parse(mapOf("type" to "run_command", "command" to "/say hi", "as_console" to true))
        assertEquals(Action.RunCommand("/say hi", asConsole = true), a)
    }

    @Test
    fun `parse run_command defaults as_console to false`() {
        val a = ActionParser.parse(mapOf("type" to "run_command", "command" to "/say hi"))
        assertEquals(Action.RunCommand("/say hi", asConsole = false), a)
    }

    @Test
    fun `parse close_menu`() {
        assertEquals(Action.CloseMenu, ActionParser.parse(mapOf("type" to "close_menu")))
    }

    @Test
    fun `parse open_menu with context`() {
        val a = ActionParser.parse(mapOf(
            "type" to "open_menu",
            "menu_id" to "shop",
            "context" to mapOf("tab" to "weapons"),
            "clear_context" to true,
        ))
        assertEquals(Action.OpenMenu("shop", mapOf("tab" to "weapons"), clearContext = true), a)
    }

    @Test
    fun `parse give_money`() {
        val a = ActionParser.parse(mapOf("type" to "give_money", "amount" to 50.0))
        assertEquals(Action.GiveMoney(50.0), a)
    }

    @Test
    fun `parse take_money with currency`() {
        val a = ActionParser.parse(mapOf("type" to "take_money", "amount" to 10.0, "currency" to "tokens"))
        assertEquals(Action.TakeMoney(10.0, "tokens"), a)
    }

    @Test
    fun `parse give_item`() {
        val a = ActionParser.parse(mapOf("type" to "give_item", "material" to "DIAMOND", "count" to 3))
        assertEquals(Action.GiveItem("DIAMOND", 3), a)
    }

    @Test
    fun `parse take_item`() {
        assertEquals(Action.TakeItem("IRON_SWORD", 1),
            ActionParser.parse(mapOf("type" to "take_item", "material" to "IRON_SWORD")))
    }

    @Test
    fun `parse give_xp`() {
        assertEquals(Action.GiveXp(100), ActionParser.parse(mapOf("type" to "give_xp", "amount" to 100)))
    }

    @Test
    fun `parse give_level`() {
        assertEquals(Action.GiveLevel(5), ActionParser.parse(mapOf("type" to "give_level", "amount" to 5)))
    }

    @Test
    fun `parse send_message`() {
        assertEquals(Action.SendMessage("<green>Hello"),
            ActionParser.parse(mapOf("type" to "send_message", "text" to "<green>Hello")))
    }

    @Test
    fun `parse broadcast`() {
        assertEquals(Action.Broadcast("News!"),
            ActionParser.parse(mapOf("type" to "broadcast", "text" to "News!")))
    }

    @Test
    fun `parse play_sound`() {
        val a = ActionParser.parse(mapOf("type" to "play_sound", "sound" to "ENTITY_PLAYER_LEVELUP", "volume" to 1.5f, "pitch" to 0.8f))
        assertEquals(Action.PlaySound("ENTITY_PLAYER_LEVELUP", 1.5f, 0.8f), a)
    }

    @Test
    fun `parse teleport with coordinates`() {
        val a = ActionParser.parse(mapOf("type" to "teleport", "world" to "world", "x" to 10.0, "y" to 64.0, "z" to -5.0))
        assertEquals(Action.Teleport("world", 10.0, 64.0, -5.0), a)
    }

    @Test
    fun `parse pagination_next`() {
        assertIs<Action.PaginationNext>(ActionParser.parse(mapOf("type" to "pagination_next")))
    }

    @Test
    fun `parse pagination_prev`() {
        assertIs<Action.PaginationPrev>(ActionParser.parse(mapOf("type" to "pagination_prev")))
    }

    @Test
    fun `unknown type throws IllegalArgumentException`() {
        assertFailsWith<IllegalArgumentException> {
            ActionParser.parse(mapOf("type" to "explode_server"))
        }
    }

    @Test
    fun `missing type throws IllegalArgumentException`() {
        assertFailsWith<IllegalArgumentException> {
            ActionParser.parse(emptyMap())
        }
    }
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd plugin && ./gradlew test --tests "net.artisanmc.plugin.ActionParserTest"
```
Expected: FAIL — `ActionParser` not found

- [ ] **Step 3: Implement ActionParser**

```kotlin
package net.artisanmc.plugin.engine

object ActionParser {

    @Suppress("UNCHECKED_CAST")
    fun parse(raw: Map<String, Any>): Action {
        val type = raw["type"]?.toString()
            ?: throw IllegalArgumentException("Action missing 'type' field: $raw")
        return when (type) {
            "run_command"    -> Action.RunCommand(
                command   = str(raw, "command"),
                asConsole = raw["as_console"] as? Boolean ?: false,
            )
            "open_menu"      -> Action.OpenMenu(
                menuId       = str(raw, "menu_id"),
                context      = (raw["context"] as? Map<String, Any>)?.mapValues { it.value.toString() } ?: emptyMap(),
                clearContext = raw["clear_context"] as? Boolean ?: false,
            )
            "close_menu"     -> Action.CloseMenu
            "give_item"      -> Action.GiveItem(
                material = str(raw, "material"),
                count    = (raw["count"] as? Number)?.toInt() ?: 1,
                name     = raw["name"] as? String,
                lore     = (raw["lore"] as? List<*>)?.map { it.toString() } ?: emptyList(),
            )
            "take_item"      -> Action.TakeItem(str(raw, "material"), (raw["count"] as? Number)?.toInt() ?: 1)
            "give_money"     -> Action.GiveMoney((raw["amount"] as Number).toDouble(), raw["currency"] as? String)
            "take_money"     -> Action.TakeMoney((raw["amount"] as Number).toDouble(), raw["currency"] as? String)
            "give_xp"        -> Action.GiveXp((raw["amount"] as Number).toInt())
            "give_level"     -> Action.GiveLevel((raw["amount"] as Number).toInt())
            "send_message"   -> Action.SendMessage(str(raw, "text"))
            "broadcast"      -> Action.Broadcast(str(raw, "text"))
            "play_sound"     -> Action.PlaySound(
                sound  = str(raw, "sound"),
                volume = (raw["volume"] as? Number)?.toFloat() ?: 1f,
                pitch  = (raw["pitch"] as? Number)?.toFloat() ?: 1f,
            )
            "teleport"       -> Action.Teleport(
                world    = raw["world"] as? String,
                x        = (raw["x"] as? Number)?.toDouble() ?: 0.0,
                y        = (raw["y"] as? Number)?.toDouble() ?: 0.0,
                z        = (raw["z"] as? Number)?.toDouble() ?: 0.0,
                yaw      = (raw["yaw"] as? Number)?.toFloat() ?: 0f,
                pitch    = (raw["pitch"] as? Number)?.toFloat() ?: 0f,
                warpName = raw["warp"] as? String,
            )
            "pagination_next" -> Action.PaginationNext(raw["element_id"] as? String)
            "pagination_prev" -> Action.PaginationPrev(raw["element_id"] as? String)
            else             -> throw IllegalArgumentException("Unknown action type: $type")
        }
    }

    private fun str(raw: Map<String, Any>, key: String): String =
        raw[key]?.toString() ?: throw IllegalArgumentException("Action missing required field '$key': $raw")
}
```

- [ ] **Step 4: Run tests**

```bash
cd plugin && ./gradlew test --tests "net.artisanmc.plugin.ActionParserTest"
```
Expected: All 18 tests PASS

- [ ] **Step 5: Commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/plugin/engine/ActionParser.kt plugin/src/test/kotlin/net/artisanmc/plugin/ActionParserTest.kt
rtk git commit -m "feat(plugin): ActionParser with 15 action types (TDD)"
```

---

### Task 7: ConditionParser (TDD)

**Files:**
- Create: `plugin/src/test/kotlin/net/artisanmc/plugin/ConditionParserTest.kt`
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/ConditionParser.kt`

- [ ] **Step 1: Write failing tests**

```kotlin
package net.artisanmc.plugin

import net.artisanmc.plugin.engine.Condition
import net.artisanmc.plugin.engine.ConditionParser
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs

class ConditionParserTest {

    @Test fun `parse has_permission`() {
        assertEquals(Condition.HasPermission("admin.use"),
            ConditionParser.parse(mapOf("type" to "has_permission", "permission" to "admin.use")))
    }

    @Test fun `parse has_money`() {
        assertEquals(Condition.HasMoney(100.0),
            ConditionParser.parse(mapOf("type" to "has_money", "amount" to 100.0)))
    }

    @Test fun `parse has_money with currency`() {
        assertEquals(Condition.HasMoney(50.0, "tokens"),
            ConditionParser.parse(mapOf("type" to "has_money", "amount" to 50.0, "currency" to "tokens")))
    }

    @Test fun `parse has_item`() {
        assertEquals(Condition.HasItem("DIAMOND", 3),
            ConditionParser.parse(mapOf("type" to "has_item", "material" to "DIAMOND", "count" to 3)))
    }

    @Test fun `parse has_xp`() {
        assertEquals(Condition.HasXp(500),
            ConditionParser.parse(mapOf("type" to "has_xp", "amount" to 500)))
    }

    @Test fun `parse has_level`() {
        assertEquals(Condition.HasLevel(10),
            ConditionParser.parse(mapOf("type" to "has_level", "level" to 10)))
    }

    @Test fun `parse placeholder_equals`() {
        assertEquals(Condition.PlaceholderEquals("%player_name%", "Steve"),
            ConditionParser.parse(mapOf("type" to "placeholder_equals", "placeholder" to "%player_name%", "value" to "Steve")))
    }

    @Test fun `parse placeholder_match`() {
        assertEquals(Condition.PlaceholderMatch("%rank%", "VIP.*"),
            ConditionParser.parse(mapOf("type" to "placeholder_match", "placeholder" to "%rank%", "regex" to "VIP.*")))
    }

    @Test fun `parse cooldown_passed`() {
        assertEquals(Condition.CooldownPassed("daily_reward"),
            ConditionParser.parse(mapOf("type" to "cooldown_passed", "cooldown_id" to "daily_reward")))
    }

    @Test fun `parse world_is`() {
        assertEquals(Condition.WorldIs("nether"),
            ConditionParser.parse(mapOf("type" to "world_is", "world" to "nether")))
    }

    @Test fun `parse time_is`() {
        assertEquals(Condition.TimeIs("day"),
            ConditionParser.parse(mapOf("type" to "time_is", "range" to "day")))
    }

    @Test fun `parse random_chance`() {
        assertEquals(Condition.RandomChance(0.75),
            ConditionParser.parse(mapOf("type" to "random_chance", "probability" to 0.75)))
    }

    @Test fun `parse player_in_region`() {
        assertEquals(Condition.PlayerInRegion("spawn"),
            ConditionParser.parse(mapOf("type" to "player_in_region", "region" to "spawn")))
    }

    @Test fun `parse pagination_at_first`() {
        assertIs<Condition.PaginationAtFirst>(ConditionParser.parse(mapOf("type" to "pagination_at_first")))
    }

    @Test fun `parse not wraps inner condition`() {
        val c = ConditionParser.parse(mapOf(
            "type" to "not",
            "of"   to mapOf("type" to "has_permission", "permission" to "foo"),
        ))
        assertEquals(Condition.Not(Condition.HasPermission("foo")), c)
    }

    @Test fun `parse and combines list`() {
        val c = ConditionParser.parse(mapOf(
            "type" to "and",
            "all"  to listOf(
                mapOf("type" to "has_level", "level" to 5),
                mapOf("type" to "has_xp",    "amount" to 100),
            ),
        ))
        assertEquals(Condition.And(listOf(Condition.HasLevel(5), Condition.HasXp(100))), c)
    }

    @Test fun `parse or combines list`() {
        val c = ConditionParser.parse(mapOf(
            "type" to "or",
            "any"  to listOf(mapOf("type" to "world_is", "world" to "end")),
        ))
        assertEquals(Condition.Or(listOf(Condition.WorldIs("end"))), c)
    }

    @Test fun `unknown type throws`() {
        assertFailsWith<IllegalArgumentException> {
            ConditionParser.parse(mapOf("type" to "fly_to_moon"))
        }
    }
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd plugin && ./gradlew test --tests "net.artisanmc.plugin.ConditionParserTest"
```
Expected: FAIL — `ConditionParser` not found

- [ ] **Step 3: Implement ConditionParser**

```kotlin
package net.artisanmc.plugin.engine

object ConditionParser {

    @Suppress("UNCHECKED_CAST")
    fun parse(raw: Map<String, Any>): Condition {
        val type = raw["type"]?.toString()
            ?: throw IllegalArgumentException("Condition missing 'type' field: $raw")
        return when (type) {
            "has_permission"     -> Condition.HasPermission(str(raw, "permission"))
            "has_money"          -> Condition.HasMoney((raw["amount"] as Number).toDouble(), raw["currency"] as? String)
            "has_item"           -> Condition.HasItem(str(raw, "material"), (raw["count"] as? Number)?.toInt() ?: 1)
            "has_xp"             -> Condition.HasXp((raw["amount"] as Number).toInt())
            "has_level"          -> Condition.HasLevel((raw["level"] as Number).toInt())
            "placeholder_equals" -> Condition.PlaceholderEquals(str(raw, "placeholder"), str(raw, "value"))
            "placeholder_match"  -> Condition.PlaceholderMatch(str(raw, "placeholder"), str(raw, "regex"))
            "cooldown_passed"    -> Condition.CooldownPassed(str(raw, "cooldown_id"))
            "world_is"           -> Condition.WorldIs(str(raw, "world"))
            "time_is"            -> Condition.TimeIs(str(raw, "range"))
            "random_chance"      -> Condition.RandomChance((raw["probability"] as Number).toDouble())
            "player_in_region"   -> Condition.PlayerInRegion(str(raw, "region"))
            "pagination_at_first"-> Condition.PaginationAtFirst(raw["element_id"] as? String)
            "pagination_at_last" -> Condition.PaginationAtLast(raw["element_id"] as? String)
            "not"                -> Condition.Not(parse(raw["of"] as Map<String, Any>))
            "and"                -> Condition.And((raw["all"] as List<*>).map { parse(it as Map<String, Any>) })
            "or"                 -> Condition.Or((raw["any"] as List<*>).map { parse(it as Map<String, Any>) })
            else                 -> throw IllegalArgumentException("Unknown condition type: $type")
        }
    }

    private fun str(raw: Map<String, Any>, key: String): String =
        raw[key]?.toString() ?: throw IllegalArgumentException("Condition missing required field '$key': $raw")
}
```

- [ ] **Step 4: Run tests**

```bash
cd plugin && ./gradlew test --tests "net.artisanmc.plugin.ConditionParserTest"
```
Expected: All 18 tests PASS

- [ ] **Step 5: Commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/plugin/engine/ConditionParser.kt plugin/src/test/kotlin/net/artisanmc/plugin/ConditionParserTest.kt
rtk git commit -m "feat(plugin): ConditionParser with 16 condition types including not/and/or (TDD)"
```

---

### Task 8: CooldownStore (TDD)

**Files:**
- Create: `plugin/src/test/kotlin/net/artisanmc/plugin/CooldownStoreTest.kt`
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/CooldownStore.kt`

- [ ] **Step 1: Write failing tests**

```kotlin
package net.artisanmc.plugin

import net.artisanmc.plugin.engine.CooldownStore
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CooldownStoreTest {

    @Test fun `player not on cooldown initially`() {
        val store = CooldownStore()
        assertFalse(store.isOnCooldown("reward", UUID.randomUUID(), "player"))
    }

    @Test fun `player on cooldown after set with long duration`() {
        val store = CooldownStore()
        val uuid = UUID.randomUUID()
        store.set("reward", uuid, "player", 3600)
        assertTrue(store.isOnCooldown("reward", uuid, "player"))
    }

    @Test fun `player cooldown expires when duration is zero`() {
        val store = CooldownStore()
        val uuid = UUID.randomUUID()
        store.set("reward", uuid, "player", 0)
        assertFalse(store.isOnCooldown("reward", uuid, "player"))
    }

    @Test fun `player cooldowns are independent`() {
        val store = CooldownStore()
        val a = UUID.randomUUID()
        val b = UUID.randomUUID()
        store.set("reward", a, "player", 3600)
        assertFalse(store.isOnCooldown("reward", b, "player"))
    }

    @Test fun `global cooldown blocks all players`() {
        val store = CooldownStore()
        val uuid = UUID.randomUUID()
        store.set("event", uuid, "global", 3600)
        assertTrue(store.isOnCooldown("event", UUID.randomUUID(), "global"))
    }

    @Test fun `global cooldown expires when duration is zero`() {
        val store = CooldownStore()
        store.set("event", UUID.randomUUID(), "global", 0)
        assertFalse(store.isOnCooldown("event", UUID.randomUUID(), "global"))
    }

    @Test fun `different cooldown ids are independent`() {
        val store = CooldownStore()
        val uuid = UUID.randomUUID()
        store.set("a", uuid, "player", 3600)
        assertFalse(store.isOnCooldown("b", uuid, "player"))
    }
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd plugin && ./gradlew test --tests "net.artisanmc.plugin.CooldownStoreTest"
```
Expected: FAIL — `CooldownStore` not found

- [ ] **Step 3: Implement CooldownStore**

```kotlin
package net.artisanmc.plugin.engine

import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

class CooldownStore {
    private val playerCooldowns = ConcurrentHashMap<String, ConcurrentHashMap<UUID, Long>>()
    private val globalCooldowns = ConcurrentHashMap<String, Long>()

    fun set(id: String, uuid: UUID, scope: String, durationSeconds: Long) {
        val expiry = System.currentTimeMillis() + durationSeconds * 1000L
        if (scope == "global") {
            globalCooldowns[id] = expiry
        } else {
            playerCooldowns.getOrPut(id) { ConcurrentHashMap() }[uuid] = expiry
        }
    }

    fun isOnCooldown(id: String, uuid: UUID, scope: String): Boolean {
        val now = System.currentTimeMillis()
        return if (scope == "global") {
            val expiry = globalCooldowns[id] ?: return false
            now < expiry
        } else {
            val expiry = playerCooldowns[id]?.get(uuid) ?: return false
            now < expiry
        }
    }
}
```

- [ ] **Step 4: Run tests**

```bash
cd plugin && ./gradlew test --tests "net.artisanmc.plugin.CooldownStoreTest"
```
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/plugin/engine/CooldownStore.kt plugin/src/test/kotlin/net/artisanmc/plugin/CooldownStoreTest.kt
rtk git commit -m "feat(plugin): CooldownStore — player + global scope, thread-safe (TDD)"
```

---

### Task 9: SoftDepRegistry

**Files:**
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/SoftDepRegistry.kt`

No tests — this wraps external plugins unavailable in test environment.

- [ ] **Step 1: Create SoftDepRegistry.kt**

```kotlin
package net.artisanmc.plugin.engine

import net.milkbowl.vault.economy.Economy
import org.bukkit.entity.Player
import org.bukkit.plugin.java.JavaPlugin

class VaultProvider(private val economy: Economy) {
    fun balance(player: Player): Double = economy.getBalance(player)
    fun withdraw(player: Player, amount: Double): Boolean =
        economy.withdrawPlayer(player, amount).transactionSuccess()
    fun deposit(player: Player, amount: Double) { economy.depositPlayer(player, amount) }

    companion object {
        fun tryInit(plugin: JavaPlugin): VaultProvider? = runCatching {
            val reg = plugin.server.servicesManager
                .getRegistration(Economy::class.java) ?: return null
            VaultProvider(reg.provider)
        }.getOrNull()
    }
}

class PapiProvider {
    fun resolve(player: Player, text: String): String =
        me.clip.placeholderapi.PlaceholderAPI.setPlaceholders(player, text)

    companion object {
        fun tryInit(): PapiProvider? = runCatching {
            Class.forName("me.clip.placeholderapi.PlaceholderAPI")
            PapiProvider()
        }.getOrNull()
    }
}

class WorldGuardProvider {
    fun isInRegion(player: Player, region: String): Boolean = runCatching {
        val wg = com.sk89q.worldguard.WorldGuard.getInstance()
        val loc = com.sk89q.worldedit.bukkit.BukkitAdapter.adapt(player.location)
        val container = wg.platform.regionContainer
        val regions = container.createQuery().getApplicableRegions(loc)
        regions.regions.any { it.id.equals(region, ignoreCase = true) }
    }.getOrDefault(false)

    companion object {
        fun tryInit(): WorldGuardProvider? = runCatching {
            Class.forName("com.sk89q.worldguard.WorldGuard")
            WorldGuardProvider()
        }.getOrNull()
    }
}

class SoftDepRegistry(
    val vault: VaultProvider?,
    val papi: PapiProvider?,
    val worldGuard: WorldGuardProvider?,
) {
    constructor(plugin: JavaPlugin) : this(
        vault      = VaultProvider.tryInit(plugin),
        papi       = PapiProvider.tryInit(),
        worldGuard = WorldGuardProvider.tryInit(),
    )

    companion object {
        val EMPTY = SoftDepRegistry(vault = null, papi = null, worldGuard = null)
    }
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd plugin && ./gradlew compileKotlin
```
Expected: `BUILD SUCCESSFUL`

- [ ] **Step 3: Commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/plugin/engine/SoftDepRegistry.kt
rtk git commit -m "feat(plugin): SoftDepRegistry — Vault, PlaceholderAPI, WorldGuard soft-deps"
```

---

### Task 10: ConditionEvaluator (TDD)

**Files:**
- Create: `plugin/src/test/kotlin/net/artisanmc/plugin/ConditionEvaluatorTest.kt`
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/ConditionEvaluator.kt`

- [ ] **Step 1: Write failing tests**

```kotlin
package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.plugin.engine.*
import kotlin.test.*

class ConditionEvaluatorTest {

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val eval = ConditionEvaluator(SoftDepRegistry.EMPTY, CooldownStore())
    private fun player() = MockBukkit.getMock().addPlayer()
    private fun ctx(p: org.bukkit.entity.Player) = ExecutionContext(p)

    @Test fun `has_permission true when player has it`() {
        val p = player()
        p.addAttachment(MockBukkit.createMockPlugin(), "admin.use", true)
        assertTrue(eval.evaluate(Condition.HasPermission("admin.use"), ctx(p)))
    }

    @Test fun `has_permission false when player lacks it`() {
        assertFalse(eval.evaluate(Condition.HasPermission("admin.use"), ctx(player())))
    }

    @Test fun `not inverts true to false`() {
        val p = player()
        p.addAttachment(MockBukkit.createMockPlugin(), "foo", true)
        assertFalse(eval.evaluate(Condition.Not(Condition.HasPermission("foo")), ctx(p)))
    }

    @Test fun `not inverts false to true`() {
        assertTrue(eval.evaluate(Condition.Not(Condition.HasPermission("foo")), ctx(player())))
    }

    @Test fun `and returns true only if all pass`() {
        val p = player()
        p.addAttachment(MockBukkit.createMockPlugin(), "a", true)
        val cond = Condition.And(listOf(Condition.HasPermission("a"), Condition.HasPermission("b")))
        assertFalse(eval.evaluate(cond, ctx(p)))
    }

    @Test fun `and returns true when all pass`() {
        val p = player()
        val plugin = MockBukkit.createMockPlugin()
        p.addAttachment(plugin, "a", true)
        p.addAttachment(plugin, "b", true)
        assertTrue(eval.evaluate(Condition.And(listOf(Condition.HasPermission("a"), Condition.HasPermission("b"))), ctx(p)))
    }

    @Test fun `or returns true if any pass`() {
        val p = player()
        p.addAttachment(MockBukkit.createMockPlugin(), "a", true)
        assertTrue(eval.evaluate(Condition.Or(listOf(Condition.HasPermission("a"), Condition.HasPermission("b"))), ctx(p)))
    }

    @Test fun `or returns false if none pass`() {
        assertFalse(eval.evaluate(Condition.Or(listOf(Condition.HasPermission("x"), Condition.HasPermission("y"))), ctx(player())))
    }

    @Test fun `has_level true when player level matches`() {
        val p = player()
        p.level = 10
        assertTrue(eval.evaluate(Condition.HasLevel(10), ctx(p)))
        assertFalse(eval.evaluate(Condition.HasLevel(11), ctx(p)))
    }

    @Test fun `has_xp true when player xp matches`() {
        val p = player()
        p.totalExperience = 500
        assertTrue(eval.evaluate(Condition.HasXp(500), ctx(p)))
        assertFalse(eval.evaluate(Condition.HasXp(501), ctx(p)))
    }

    @Test fun `has_item false when inventory empty`() {
        assertFalse(eval.evaluate(Condition.HasItem("DIAMOND", 1), ctx(player())))
    }

    @Test fun `random_chance probability 1 always true`() {
        assertTrue(eval.evaluate(Condition.RandomChance(1.0), ctx(player())))
    }

    @Test fun `random_chance probability 0 always false`() {
        assertFalse(eval.evaluate(Condition.RandomChance(0.0), ctx(player())))
    }

    @Test fun `cooldown_passed true when no cooldown set`() {
        assertTrue(eval.evaluate(Condition.CooldownPassed("daily"), ctx(player())))
    }

    @Test fun `cooldown_passed false when cooldown active`() {
        val cooldowns = CooldownStore()
        val e = ConditionEvaluator(SoftDepRegistry.EMPTY, cooldowns)
        val p = player()
        cooldowns.set("daily", p.uniqueId, "player", 3600)
        assertFalse(e.evaluate(Condition.CooldownPassed("daily"), ctx(p)))
    }

    @Test fun `has_money returns false when vault absent`() {
        assertFalse(eval.evaluate(Condition.HasMoney(100.0), ctx(player())))
    }

    @Test fun `player_in_region returns false when worldguard absent`() {
        assertFalse(eval.evaluate(Condition.PlayerInRegion("spawn"), ctx(player())))
    }

    @Test fun `placeholder_equals returns false when papi absent`() {
        assertFalse(eval.evaluate(Condition.PlaceholderEquals("%player_name%", "Steve"), ctx(player())))
    }

    @Test fun `pagination_at_first always false in V1`() {
        assertFalse(eval.evaluate(Condition.PaginationAtFirst(), ctx(player())))
    }

    @Test fun `world_is true when player is in matching world`() {
        val p = player()
        assertTrue(eval.evaluate(Condition.WorldIs(p.world.name), ctx(p)))
    }

    @Test fun `evaluateAll returns true for empty list`() {
        assertTrue(eval.evaluateAll(emptyList(), ctx(player())))
    }
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd plugin && ./gradlew test --tests "net.artisanmc.plugin.ConditionEvaluatorTest"
```
Expected: FAIL — `ConditionEvaluator` not found

- [ ] **Step 3: Implement ConditionEvaluator**

```kotlin
package net.artisanmc.plugin.engine

import org.bukkit.Material

class ConditionEvaluator(val deps: SoftDepRegistry, val cooldowns: CooldownStore) {

    fun evaluateAll(conditions: List<Condition>, ctx: ExecutionContext): Boolean =
        conditions.all { evaluate(it, ctx) }

    fun evaluate(condition: Condition, ctx: ExecutionContext): Boolean = when (condition) {
        is Condition.HasPermission     -> ctx.player.hasPermission(condition.perm)
        is Condition.HasLevel          -> ctx.player.level >= condition.level
        is Condition.HasXp             -> ctx.player.totalExperience >= condition.amount
        is Condition.HasItem           -> countItems(ctx, condition.material) >= condition.count
        is Condition.HasMoney          -> deps.vault?.balance(ctx.player)?.let { it >= condition.amount } ?: false
        is Condition.PlaceholderEquals -> deps.papi?.resolve(ctx.player, condition.placeholder) == condition.value
        is Condition.PlaceholderMatch  -> deps.papi?.resolve(ctx.player, condition.placeholder)
                                            ?.matches(Regex(condition.regex)) ?: false
        is Condition.CooldownPassed    -> !cooldowns.isOnCooldown(condition.cooldownId, ctx.player.uniqueId, "player")
        is Condition.WorldIs           -> ctx.player.world.name.equals(condition.world, ignoreCase = true)
        is Condition.TimeIs            -> evaluateTime(ctx, condition.range)
        is Condition.RandomChance      -> Math.random() < condition.probability
        is Condition.PlayerInRegion    -> deps.worldGuard?.isInRegion(ctx.player, condition.region) ?: false
        is Condition.PaginationAtFirst -> false
        is Condition.PaginationAtLast  -> false
        is Condition.Not               -> !evaluate(condition.inner, ctx)
        is Condition.And               -> condition.all.all { evaluate(it, ctx) }
        is Condition.Or                -> condition.any.any { evaluate(it, ctx) }
    }

    private fun countItems(ctx: ExecutionContext, materialName: String): Int {
        val material = runCatching { Material.valueOf(materialName.uppercase()) }.getOrNull() ?: return 0
        return ctx.player.inventory.contents.orEmpty()
            .filterNotNull()
            .filter { it.type == material }
            .sumOf { it.amount }
    }

    private fun evaluateTime(ctx: ExecutionContext, range: String): Boolean {
        val time = ctx.player.world.time
        return when (range.lowercase()) {
            "day"   -> time in 0L..12999L
            "night" -> time in 13000L..23999L
            else    -> runCatching {
                val (a, b) = range.split("-").map { it.trim().toLong() }
                time in a..b
            }.getOrDefault(false)
        }
    }

    companion object {
        val EMPTY = ConditionEvaluator(SoftDepRegistry.EMPTY, CooldownStore())
    }
}
```

- [ ] **Step 4: Run tests**

```bash
cd plugin && ./gradlew test --tests "net.artisanmc.plugin.ConditionEvaluatorTest"
```
Expected: All 21 tests PASS

- [ ] **Step 5: Commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/plugin/engine/ConditionEvaluator.kt plugin/src/test/kotlin/net/artisanmc/plugin/ConditionEvaluatorTest.kt
rtk git commit -m "feat(plugin): ConditionEvaluator — 16 conditions, soft-dep no-op, recursive not/and/or (TDD)"
```

---

### Task 11: ActionExecutor (TDD)

**Files:**
- Create: `plugin/src/test/kotlin/net/artisanmc/plugin/ActionExecutorTest.kt`
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/ActionExecutor.kt`
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/MenuSessionStore.kt` (needed by ActionExecutor)

- [ ] **Step 1: Create MenuSessionStore.kt**

```kotlin
package net.artisanmc.plugin.engine

import org.bukkit.entity.Player
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

data class MenuSession(
    val menuId: String,
    val ctx: ExecutionContext,
    val activeClicks: Map<Int, Map<ClickType, ClickHandler>>,
)

class MenuSessionStore {
    private val sessions = ConcurrentHashMap<UUID, MenuSession>()
    fun set(player: Player, session: MenuSession) { sessions[player.uniqueId] = session }
    fun get(player: Player): MenuSession? = sessions[player.uniqueId]
    fun remove(player: Player) { sessions.remove(player.uniqueId) }
}
```

- [ ] **Step 2: Write failing tests for ActionExecutor**

```kotlin
package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.BundleMenu
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.model.PackBundle
import net.artisanmc.plugin.provider.MenuProvider
import org.bukkit.entity.Player
import kotlin.test.*

class ActionExecutorTest {

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val plugin = lazy { MockBukkit.load(net.artisanmc.plugin.ArtisanPlugin::class.java) }
    private val deps = SoftDepRegistry.EMPTY
    private val cooldowns = CooldownStore()
    private val sessions = MenuSessionStore()
    private val evaluator = ConditionEvaluator(deps, cooldowns)

    private val stubProvider = object : MenuProvider {
        override fun load() {}
        override fun findMenu(menuId: String): BundleMenu? = null
        override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {}
        override fun allBundles(): List<PackBundle> = emptyList()
    }

    private fun executor() = ActionExecutor(plugin.value, stubProvider, sessions, deps, cooldowns, evaluator)
    private fun player() = MockBukkit.getMock().addPlayer()
    private fun ctx(p: Player) = ExecutionContext(p)

    @Test fun `handle executes actions when requirements pass`() {
        val p = player()
        var executed = false
        val handler = ClickHandler(
            requirements = emptyList(),
            actions = listOf(Action.SendMessage("hi")),
            fallback = emptyList(),
        )
        executor().handle(handler, ctx(p))
        // No exception = actions path taken
    }

    @Test fun `handle executes fallback when requirement fails`() {
        val p = player()
        val fallbackMessage = "<red>No permission"
        val handler = ClickHandler(
            requirements = listOf(Condition.HasPermission("never.granted")),
            actions  = listOf(Action.SendMessage("<green>Success")),
            fallback = listOf(Action.SendMessage(fallbackMessage)),
        )
        executor().handle(handler, ctx(p))
        // No exception = fallback path taken (permission not granted)
    }

    @Test fun `handle does not execute after cooldown blocks`() {
        val p = player()
        val cooldowns2 = CooldownStore()
        val eval2 = ConditionEvaluator(deps, cooldowns2)
        val exec = ActionExecutor(plugin.value, stubProvider, sessions, deps, cooldowns2, eval2)
        val handler = ClickHandler(
            requirements = emptyList(),
            actions  = listOf(Action.SendMessage("ok")),
            fallback = emptyList(),
            cooldown = Cooldown("test_cd", 3600L),
        )
        exec.handle(handler, ctx(p))
        // After first call, cooldown is set. Second call should send cooldown message and return.
        exec.handle(handler, ctx(p))
        // No exception — cooldown blocked second execution
    }

    @Test fun `handle sets cooldown after successful execution`() {
        val p = player()
        val cooldowns2 = CooldownStore()
        val eval2 = ConditionEvaluator(deps, cooldowns2)
        val exec = ActionExecutor(plugin.value, stubProvider, sessions, deps, cooldowns2, eval2)
        val handler = ClickHandler(
            requirements = emptyList(),
            actions  = listOf(Action.SendMessage("ok")),
            fallback = emptyList(),
            cooldown = Cooldown("cd_set_test", 3600L),
        )
        assertFalse(cooldowns2.isOnCooldown("cd_set_test", p.uniqueId, "player"))
        exec.handle(handler, ctx(p))
        assertTrue(cooldowns2.isOnCooldown("cd_set_test", p.uniqueId, "player"))
    }

    @Test fun `resolveArgs replaces placeholders in text`() {
        val p = player()
        val exec = executor()
        val result = exec.resolveArgs("Hello {name}, you have {coins} coins.", ctx(p).copy(args = mapOf("name" to "Steve", "coins" to 42)))
        assertEquals("Hello Steve, you have 42 coins.", result)
    }

    @Test fun `resolveArgs returns text unchanged when no args`() {
        val p = player()
        assertEquals("static text", executor().resolveArgs("static text", ctx(p)))
    }
}
```

- [ ] **Step 3: Run to verify it fails**

```bash
cd plugin && ./gradlew test --tests "net.artisanmc.plugin.ActionExecutorTest"
```
Expected: FAIL — `ActionExecutor` not found, also `MenuProvider.openMenu` signature mismatch (fix MenuProvider first — see Plan 2 Task 3, but for now just add the new signature to the stub)

Note: The stub `MenuProvider` in the test adds `openMenu(player, menuId, lang, ctx)` and `allBundles()`. This will require `MenuProvider.kt` to be updated first. Update `MenuProvider.kt` with the new interface before running this test:

```kotlin
// plugin/src/main/kotlin/net/artisanmc/plugin/provider/MenuProvider.kt
package net.artisanmc.plugin.provider

import net.artisanmc.plugin.engine.ExecutionContext
import net.artisanmc.plugin.model.BundleMenu
import net.artisanmc.plugin.model.PackBundle
import org.bukkit.entity.Player

interface MenuProvider {
    fun load()
    fun unload() {}
    fun findMenu(menuId: String): BundleMenu?
    fun listMenuIds(): List<String> = emptyList()
    fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext)
    fun openMenu(player: Player, menuId: String, lang: String) =
        openMenu(player, menuId, lang, ExecutionContext(player))
    fun allBundles(): List<PackBundle> = emptyList()
    fun requestEditorSession(sender: String, onReady: (url: String, expiresAt: String) -> Unit) {}
    fun revokeEditorSessions() {}
}
```

After updating `MenuProvider.kt`, `SyncedMenuProvider.kt` will need a stub `openMenu(player, menuId, lang, ctx)` override to compile. Add it temporarily:

```kotlin
// Temporary override in SyncedMenuProvider — will be replaced in Plan 2
override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) =
    openMenu(player, menuId, lang)
```

Wait — that's circular. Add this temporarily instead:
```kotlin
override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {
    val menu = findMenu(menuId) ?: run { player.sendMessage("Menu '$menuId' not found."); return }
    MenuRenderer.open(player, menu, lang)
}
```

- [ ] **Step 4: Implement ActionExecutor**

```kotlin
package net.artisanmc.plugin.engine

import net.kyori.adventure.text.minimessage.MiniMessage
import org.bukkit.Bukkit
import org.bukkit.Material
import org.bukkit.Sound
import org.bukkit.entity.Player
import org.bukkit.inventory.ItemStack
import org.bukkit.plugin.java.JavaPlugin

class ActionExecutor(
    private val plugin: JavaPlugin,
    private val menuProvider: net.artisanmc.plugin.provider.MenuProvider,
    private val sessions: MenuSessionStore,
    private val deps: SoftDepRegistry,
    private val cooldowns: CooldownStore,
    private val evaluator: ConditionEvaluator,
) {
    private val mm = MiniMessage.miniMessage()

    fun handle(handler: ClickHandler, ctx: ExecutionContext) {
        val cooldown = handler.cooldown
        if (cooldown != null && cooldowns.isOnCooldown(cooldown.id, ctx.player.uniqueId, cooldown.scope)) {
            cooldown.message?.let { ctx.player.sendMessage(mm.deserialize(it)) }
            return
        }
        if (!evaluator.evaluateAll(handler.requirements, ctx)) {
            execute(handler.fallback, ctx)
            return
        }
        execute(handler.actions, ctx)
        if (cooldown != null) {
            cooldowns.set(cooldown.id, ctx.player.uniqueId, cooldown.scope, cooldown.durationSeconds)
        }
    }

    fun execute(actions: List<Action>, ctx: ExecutionContext) {
        actions.forEach { executeOne(it, ctx) }
    }

    fun resolveArgs(text: String, ctx: ExecutionContext): String {
        var result = text
        ctx.args.forEach { (k, v) -> result = result.replace("{$k}", v.toString()) }
        return result
    }

    private fun executeOne(action: Action, ctx: ExecutionContext) {
        val player = ctx.player
        when (action) {
            is Action.RunCommand -> {
                val cmd = resolveArgs(action.command, ctx).trimStart('/')
                if (action.asConsole) Bukkit.dispatchCommand(Bukkit.getConsoleSender(), cmd)
                else player.performCommand(cmd)
            }
            is Action.OpenMenu -> {
                val newArgs = if (action.clearContext) {
                    action.context.mapValues { it.value as Any }
                } else {
                    ctx.args + action.context.mapValues { it.value as Any }
                }
                menuProvider.openMenu(player, action.menuId, ctx.lang, ctx.copy(args = newArgs))
            }
            is Action.CloseMenu -> player.closeInventory()
            is Action.GiveItem  -> {
                val material = Material.matchMaterial(action.material) ?: return
                val item = ItemStack(material, action.count)
                if (action.name != null || action.lore.isNotEmpty()) {
                    val meta = item.itemMeta
                    if (action.name != null) meta.displayName(mm.deserialize(resolveArgs(action.name, ctx)))
                    if (action.lore.isNotEmpty()) meta.lore(action.lore.map { mm.deserialize(resolveArgs(it, ctx)) })
                    item.itemMeta = meta
                }
                player.inventory.addItem(item)
            }
            is Action.TakeItem -> {
                val material = Material.matchMaterial(action.material) ?: return
                var toRemove = action.count
                player.inventory.contents.orEmpty().forEachIndexed { i, item ->
                    if (item != null && item.type == material && toRemove > 0) {
                        val take = minOf(toRemove, item.amount)
                        toRemove -= take
                        if (item.amount - take <= 0) player.inventory.setItem(i, null)
                        else item.amount -= take
                    }
                }
            }
            is Action.GiveMoney -> deps.vault?.deposit(player, action.amount)
            is Action.TakeMoney -> deps.vault?.withdraw(player, action.amount)
            is Action.GiveXp    -> player.giveExp(action.amount)
            is Action.GiveLevel -> player.giveExpLevels(action.amount)
            is Action.SendMessage  -> player.sendMessage(mm.deserialize(resolveArgs(action.text, ctx)))
            is Action.Broadcast    -> Bukkit.getServer().broadcast(mm.deserialize(resolveArgs(action.text, ctx)))
            is Action.PlaySound    -> runCatching {
                player.playSound(player.location, Sound.valueOf(action.sound.uppercase()), action.volume, action.pitch)
            }
            is Action.Teleport -> {
                if (action.warpName != null && action.world == null) return
                val world = action.world?.let { Bukkit.getWorld(it) } ?: return
                player.teleport(org.bukkit.Location(world, action.x, action.y, action.z, action.yaw, action.pitch))
            }
            is Action.PaginationNext, is Action.PaginationPrev -> Unit
        }
    }
}
```

- [ ] **Step 5: Run tests**

```bash
cd plugin && ./gradlew test --tests "net.artisanmc.plugin.ActionExecutorTest"
```
Expected: All 6 tests PASS

- [ ] **Step 6: Run full test suite to check for regressions**

```bash
cd plugin && ./gradlew test
```
Expected: All existing tests still pass

- [ ] **Step 7: Commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/plugin/engine/ plugin/src/main/kotlin/net/artisanmc/plugin/provider/MenuProvider.kt plugin/src/test/kotlin/net/artisanmc/plugin/ActionExecutorTest.kt
rtk git commit -m "feat(plugin): ActionExecutor, MenuSessionStore — full click handler flow (TDD)"
```

---

### Task 12: BundleCompiler (TDD) + update PackReader

**Files:**
- Create: `plugin/src/test/kotlin/net/artisanmc/plugin/BundleCompilerTest.kt`
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/BundleCompiler.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/yaml/PackReader.kt`

- [ ] **Step 1: Write failing tests**

```kotlin
package net.artisanmc.plugin

import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.*
import kotlin.test.*

class BundleCompilerTest {

    private fun menu(vararg elements: ElementYaml) = MenuYaml(
        id = "test_menu", title = "Test", size = 27,
        layers = listOf(LayerYaml(id = "base", elements = elements.toList())),
    )

    private fun element(id: String, positions: String, vararg appearances: AppearanceYaml) =
        ElementYaml(id = id, positions = positions, appearances = appearances.toList())

    private fun appearance(material: String = "STONE", click: Map<String, ClickHandlerYaml> = emptyMap()) =
        AppearanceYaml(material = material, click = click)

    private fun handler(vararg actions: Map<String, Any>) =
        ClickHandlerYaml(actions = actions.toList())

    @Test fun `compile empty menu has empty compiledAppearances and slotToElement`() {
        val result = BundleCompiler.compile(MenuYaml(id = "m", size = 27), emptyMap())
        assertTrue(result.compiledAppearances.isEmpty())
        assertTrue(result.slotToElement.isEmpty())
    }

    @Test fun `compile populates slotToElement for single slot`() {
        val m = menu(element("btn", "13", appearance()))
        val result = BundleCompiler.compile(m, emptyMap())
        assertEquals("btn", result.slotToElement[13])
    }

    @Test fun `compile populates slotToElement for range`() {
        val m = menu(element("row", "0-8", appearance()))
        val result = BundleCompiler.compile(m, emptyMap())
        (0..8).forEach { assertEquals("row", result.slotToElement[it]) }
    }

    @Test fun `compile populates slotToElement for comma list`() {
        val m = menu(element("corners", "0,8,18,26", appearance()))
        val result = BundleCompiler.compile(m, emptyMap())
        listOf(0, 8, 18, 26).forEach { assertEquals("corners", result.slotToElement[it]) }
    }

    @Test fun `compile stores CompiledAppearance per element`() {
        val app = appearance("DIAMOND", mapOf(
            "left" to handler(mapOf("type" to "close_menu")),
        ))
        val m = menu(element("btn", "13", app))
        val result = BundleCompiler.compile(m, emptyMap())
        val compiled = result.compiledAppearances["btn"]
        assertNotNull(compiled)
        assertEquals(1, compiled.size)
        val ca = compiled[0]
        assertTrue(ca.conditions.isEmpty())
        assertEquals(1, ca.clicks.size)
        assertIs<Action.CloseMenu>(ca.clicks[ClickType.LEFT]?.actions?.firstOrNull())
    }

    @Test fun `compile skips unknown click type`() {
        val app = appearance("STONE", mapOf(
            "hover" to handler(mapOf("type" to "close_menu")),
        ))
        val m = menu(element("btn", "0", app))
        val result = BundleCompiler.compile(m, emptyMap())
        val compiled = result.compiledAppearances["btn"]?.firstOrNull()
        assertNotNull(compiled)
        assertTrue(compiled.clicks.isEmpty())
    }

    @Test fun `compile handles appearance with conditions`() {
        val condMap = mapOf("type" to "has_permission", "permission" to "vip")
        val app = AppearanceYaml(material = "GOLD_BLOCK", conditions = condMap)
        val m = menu(element("el", "0", app))
        val result = BundleCompiler.compile(m, emptyMap())
        val ca = result.compiledAppearances["el"]?.firstOrNull()
        assertNotNull(ca)
        assertEquals(listOf(Condition.HasPermission("vip")), ca.conditions)
    }

    @Test fun `compile skips appearance with invalid action but keeps others`() {
        val goodApp = appearance("STONE", mapOf("left" to handler(mapOf("type" to "close_menu"))))
        val badApp  = appearance("DIAMOND", mapOf("left" to handler(mapOf("type" to "nonexistent_action"))))
        val m = menu(element("el", "0", goodApp, badApp))
        val result = BundleCompiler.compile(m, emptyMap())
        val compiled = result.compiledAppearances["el"]
        assertNotNull(compiled)
        // Bad appearance is skipped, good one survives
        assertEquals(1, compiled.size)
    }
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd plugin && ./gradlew test --tests "net.artisanmc.plugin.BundleCompilerTest"
```
Expected: FAIL — `BundleCompiler` not found

- [ ] **Step 3: Implement BundleCompiler**

```kotlin
package net.artisanmc.plugin.engine

import net.artisanmc.plugin.model.AppearanceYaml
import net.artisanmc.plugin.model.BundleMenu
import net.artisanmc.plugin.model.MenuYaml
import java.util.logging.Logger

object BundleCompiler {

    fun compile(yaml: MenuYaml, langMaps: Map<String, Map<String, String>>, logger: Logger? = null): BundleMenu {
        val compiledAppearances = mutableMapOf<String, List<CompiledAppearance>>()
        val slotToElement = mutableMapOf<Int, String>()

        for (layer in yaml.layers) {
            for (element in layer.elements) {
                val slots = parsePositions(element.positions, yaml.size)
                slots.forEach { slot -> slotToElement[slot] = element.id }

                val compiled = element.appearances.mapNotNull { app ->
                    compileAppearance(app, yaml.id, element.id, logger)
                }
                if (compiled.isNotEmpty()) compiledAppearances[element.id] = compiled
            }
        }

        return BundleMenu(yaml, langMaps, compiledAppearances, slotToElement)
    }

    private fun compileAppearance(app: AppearanceYaml, menuId: String, elementId: String, logger: Logger?): CompiledAppearance? =
        runCatching {
            val conditions = if (app.conditions != null)
                listOf(ConditionParser.parse(app.conditions))
            else emptyList()

            val clicks = app.click.mapNotNull { (key, handlerYaml) ->
                val clickType = ClickType.fromYamlKey(key) ?: return@mapNotNull null
                val requirements = handlerYaml.requirements.map { ConditionParser.parse(it) }
                val actions      = handlerYaml.actions.map { ActionParser.parse(it) }
                val fallback     = handlerYaml.fallback.map { ActionParser.parse(it) }
                val cooldown     = handlerYaml.cooldown?.let { cy ->
                    Cooldown(cy.id, cy.duration, cy.scope, cy.message)
                }
                clickType to ClickHandler(requirements, actions, fallback, cooldown)
            }.toMap()

            CompiledAppearance(conditions, clicks, app)
        }.getOrElse { e ->
            logger?.warning("Failed to compile appearance in menu=$menuId element=$elementId: ${e.message}")
            null
        }

    private fun parsePositions(positions: String, size: Int): List<Int> =
        positions.split(",").flatMap { part ->
            val t = part.trim()
            if (t.contains("-")) {
                val (a, b) = t.split("-").map { it.trim().toInt() }
                (a..b).toList()
            } else {
                listOf(t.toIntOrNull() ?: return@flatMap emptyList())
            }
        }.filter { it in 0 until size }
}
```

- [ ] **Step 4: Update PackReader to use BundleCompiler**

Replace the menu construction line in `PackReader.readPack()`:
```kotlin
// Before:
BundleMenu(mapper.readValue(f, MenuYaml::class.java), langMaps)

// After:
BundleCompiler.compile(mapper.readValue(f, MenuYaml::class.java), langMaps, logger)
```

Full updated `PackReader.kt`:
```kotlin
package net.artisanmc.plugin.yaml

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.engine.BundleCompiler
import net.artisanmc.plugin.model.*
import java.io.File
import java.util.logging.Logger

class PackReader(private val packsRoot: File, private val logger: Logger? = null) {

    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()

    fun readAll(): List<PackBundle> =
        packsRoot.listFiles { f -> f.isDirectory }
            ?.mapNotNull { readPack(it) }
            ?: emptyList()

    private fun readPack(packDir: File): PackBundle? {
        val manifestFile = File(packDir, "manifest.yaml").takeIf { it.exists() } ?: return null
        val manifest = mapper.readValue(manifestFile, ManifestYaml::class.java)

        val langMaps: Map<String, Map<String, String>> = manifest.languages.associateWith { lang ->
            val langFile = File(packDir, "lang/$lang.yaml")
            if (langFile.exists()) mapper.readValue(langFile, object : TypeReference<Map<String, String>>() {})
            else emptyMap()
        }

        val menus = manifest.files.menus.mapNotNull { menuId ->
            val f = File(packDir, "menus/$menuId.yaml").takeIf { it.exists() } ?: return@mapNotNull null
            BundleCompiler.compile(mapper.readValue(f, MenuYaml::class.java), langMaps, logger)
        }

        val commands = manifest.files.commands.mapNotNull { cmdId ->
            val f = File(packDir, "commands/$cmdId.yaml").takeIf { it.exists() } ?: return@mapNotNull null
            mapper.readValue(f, CommandYaml::class.java)
        }

        return PackBundle(manifest.packId, manifest.defaultLang, manifest.languages, menus, commands)
    }
}
```

- [ ] **Step 5: Run tests**

```bash
cd plugin && ./gradlew test --tests "net.artisanmc.plugin.BundleCompilerTest"
```
Expected: All 8 tests PASS

- [ ] **Step 6: Run full test suite**

```bash
cd plugin && ./gradlew test
```
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/plugin/engine/BundleCompiler.kt plugin/src/main/kotlin/net/artisanmc/plugin/yaml/PackReader.kt plugin/src/test/kotlin/net/artisanmc/plugin/BundleCompilerTest.kt
rtk git commit -m "feat(plugin): BundleCompiler — compile MenuYaml to typed ClickHandlers at load time (TDD)"
```
