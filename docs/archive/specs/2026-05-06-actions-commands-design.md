# Design — Actions and Commands System (Plugin)

**Date:** 2026-05-06  
**Scope:** Kotlin plugin (Paper 1.21.4)  
**Status:** Approved

---

## Context

Menu rendering works (`MenuRenderer`). Clicks are cancelled by `MenuListener` but no action is executed. `CommandYaml`s are parsed from the YAML but never registered with Bukkit.

This design covers:
1. The **actions system** — running the 15 MVP actions when a menu slot is clicked
2. The **conditions system** — evaluating the 16 conditions (with Vault/PAPI/WorldGuard soft-deps)
3. The **commands system** — dynamic registration of the commands defined in packs

---

## Key decisions

| Decision | Choice | Reason |
|---|---|---|
| Action/condition architecture | Sealed class hierarchy, parse at load | Config errors caught at load, not at click; type-safe execution code |
| Soft-deps | Centralized `SoftDepRegistry`, nullable providers | Clean architecture, explicit no-op if plugin absent |
| Command registration | Paper `Bukkit.getCommandMap()` | No reflection, supports re-register on reload |
| Action scope | The 15 MVP spec actions | Consistent with the spec, Vault as soft-dep |
| Condition scope | The 16 spec conditions | Soft-deps no-op if absent |
| Pagination in V1 | `PaginationNext/Prev` = no-op, `PaginationAtFirst/Last` = `false` | Pagination not yet implemented; hooks are in place for the next sprint |
| Context propagation | Complete from V1 | `ExecutionContext` carries args command → open_menu → menu |

---

## Architecture — Overview

```
plugin/src/main/kotlin/net/artisanmc/plugin/
  engine/
    Action.kt              ← sealed class hierarchy (15 actions)
    Condition.kt           ← sealed class hierarchy (16 conditions)
    ClickHandler.kt        ← ClickHandler, Cooldown, ClickType, MenuSession
    ExecutionContext.kt    ← data class player + args
    ActionParser.kt        ← Map<String,Any> → Action
    ConditionParser.kt     ← Map<String,Any> → Condition (recursive)
    ArgDef.kt              ← sealed class ArgDef + ArgDefParser
    SoftDepRegistry.kt     ← VaultProvider, PapiProvider, WorldGuardProvider
    CooldownStore.kt       ← in-memory, thread-safe
    ConditionEvaluator.kt  ← evaluates Condition recursively
    ActionExecutor.kt      ← handle(ClickHandler, ctx), execute(actions, ctx)
    MenuSessionStore.kt    ← UUID → MenuSession
  command/
    CompiledCommand.kt     ← compiled version of CommandYaml
    CommandCompiler.kt     ← CommandYaml → CompiledCommand
    PackCommand.kt         ← Bukkit Command per pack command
    ArgParser.kt           ← parses raw args + tabComplete
    CommandRegistrar.kt    ← register/unregister via commandMap

  model/PackBundle.kt      ← ClickHandlerYaml update + BundleMenu.compiledClicks
  render/MenuListener.kt   ← click → ActionExecutor wiring
  ArtisanPlugin.kt       ← init SoftDepRegistry, CommandRegistrar
```

---

## Section 1 — Data model

### YAML layer (Jackson)

Update to `ClickHandlerYaml` (currently `steps: List<Map<String,Any>>` does not match the spec):

```kotlin
data class ClickHandlerYaml(
    val requirements: List<Map<String, Any>> = emptyList(),
    val actions:      List<Map<String, Any>> = emptyList(),
    val fallback:     List<Map<String, Any>> = emptyList(),
    val cooldown:     CooldownYaml? = null,
)

data class CooldownYaml(
    val id:       String  = "",
    val duration: Long    = 0,   // seconds
    val scope:    String  = "player", // "player" | "global"
    val message:  String? = null,
)
```

### Compiled layer (sealed classes)

**`Action`** — 15 actions:

```kotlin
sealed class Action {
    data class RunCommand(val command: String, val asConsole: Boolean = false) : Action()
    data class OpenMenu(val menuId: String, val context: Map<String, String> = emptyMap(), val clearContext: Boolean = false) : Action()
    data object CloseMenu : Action()
    data class GiveItem(val material: String, val count: Int = 1, val name: String? = null, val lore: List<String> = emptyList()) : Action()
    data class TakeItem(val material: String, val count: Int = 1) : Action()
    data class GiveMoney(val amount: Double, val currency: String? = null) : Action()
    data class TakeMoney(val amount: Double, val currency: String? = null) : Action()
    data class GiveXp(val amount: Int) : Action()
    data class GiveLevel(val amount: Int) : Action()
    data class SendMessage(val text: String) : Action()
    data class Broadcast(val text: String) : Action()
    data class PlaySound(val sound: String, val volume: Float = 1f, val pitch: Float = 1f) : Action()
    data class Teleport(
        val world: String? = null, val x: Double = 0.0, val y: Double = 0.0, val z: Double = 0.0,
        val yaw: Float = 0f, val pitch: Float = 0f, val warpName: String? = null,
    ) : Action()
    data class PaginationNext(val elementId: String? = null) : Action()  // no-op in V1
    data class PaginationPrev(val elementId: String? = null) : Action()  // no-op in V1
}
```

**`Condition`** — 16 conditions:

```kotlin
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
    data class TimeIs(val range: String) : Condition()      // "day" | "night" | "<ticks>-<ticks>"
    data class RandomChance(val probability: Double) : Condition()
    data class PlayerInRegion(val region: String) : Condition()
    data class PaginationAtFirst(val elementId: String? = null) : Condition()  // returns false in V1
    data class PaginationAtLast(val elementId: String? = null) : Condition()   // returns false in V1
    data class Not(val inner: Condition) : Condition()
    data class And(val all: List<Condition>) : Condition()
    data class Or(val any: List<Condition>) : Condition()
}
```

**`ClickHandler`** and related types:

```kotlin
data class Cooldown(val id: String, val durationSeconds: Long, val scope: String = "player", val message: String? = null)
data class ClickHandler(val requirements: List<Condition>, val actions: List<Action>, val fallback: List<Action>, val cooldown: Cooldown? = null)

enum class ClickType { LEFT, RIGHT, SHIFT_LEFT, SHIFT_RIGHT, MIDDLE }
```

**`BundleMenu`** — new compiled field:

```kotlin
data class BundleMenu(
    val yaml: MenuYaml,
    val langMaps: Map<String, Map<String, String>>,
    val compiledClicks: Map<String, Map<ClickType, ClickHandler>>, // elementId → clickType → handler
    val slotToElement: Map<Int, String>,                           // slot index → elementId (precomputed)
)
```

---

## Section 2 — Parsing layer

### `ActionParser`

Stateless object. Converts `Map<String, Any>` → `Action`. Throws `IllegalArgumentException` on unknown type or missing field — the caller (`PackReader`) catches and logs.

### `ConditionParser`

Stateless object. Recursive for `not`, `and`, `or`:

```kotlin
"not" -> Condition.Not(parse(raw["of"] as Map<String, Any>))
"and" -> Condition.And((raw["all"] as List<*>).map { parse(it as Map<String, Any>) })
"or"  -> Condition.Or((raw["any"] as List<*>).map { parse(it as Map<String, Any>) })
```

### `ArgDefParser`

Converts `List<Map<String, Any>>` → `List<ArgDef>`. Types supported in V1: `string`, `int`, `player`, `world`, `item_material`, `enum`.

```kotlin
sealed class ArgDef {
    abstract val name: String
    abstract val required: Boolean
    data class StringArg(override val name: String, override val required: Boolean, val default: String?) : ArgDef()
    data class IntArg(override val name: String, override val required: Boolean, val default: Int?) : ArgDef()
    data class PlayerArg(override val name: String, override val required: Boolean) : ArgDef()
    data class WorldArg(override val name: String, override val required: Boolean) : ArgDef()
    data class ItemMaterialArg(override val name: String, override val required: Boolean) : ArgDef()
    data class EnumArg(override val name: String, override val required: Boolean, val values: List<String>) : ArgDef()
}
```

### Integration in `PackReader`

After Jackson deserialization, for each menu:
1. For each element × appearance × click type → call `ActionParser` + `ConditionParser`
2. Build `compiledClicks` and `slotToElement`
3. If an exception is thrown: menu skipped, warning logged, the other menus in the bundle continue

---

## Section 3 — Soft-dep registry

```kotlin
class SoftDepRegistry(plugin: JavaPlugin) {
    val vault:      VaultProvider?      = VaultProvider.tryInit(plugin)
    val papi:       PapiProvider?       = PapiProvider.tryInit()
    val worldGuard: WorldGuardProvider? = WorldGuardProvider.tryInit()
}
```

Each provider exposes a clean business API and encapsulates the dependency:

**`VaultProvider`**: `balance(player)`, `withdraw(player, amount): Boolean`, `deposit(player, amount)`  
**`PapiProvider`**: `resolve(player, text): String`  
**`WorldGuardProvider`**: `isInRegion(player, region): Boolean`

`tryInit()` returns `null` if the plugin is absent or if initialization fails. A warning is logged only once at startup for each absent soft-dep used in a loaded menu/command.

---

## Section 4 — Execution engine

### `ExecutionContext`

```kotlin
data class ExecutionContext(
    val player: Player,
    val args: Map<String, Any> = emptyMap(), // parsed command args OR open_menu context
)
```

### `CooldownStore`

In-memory, thread-safe via `ConcurrentHashMap`. Two maps:
- `playerCooldowns: Map<String, Map<UUID, Long>>` — id → uuid → expiry ms
- `globalCooldowns: Map<String, Long>` — id → expiry ms

### `ConditionEvaluator`

```kotlin
class ConditionEvaluator(val deps: SoftDepRegistry, val cooldowns: CooldownStore) {
    fun evaluateAll(conditions: List<Condition>, ctx: ExecutionContext): Boolean
    fun evaluate(condition: Condition, ctx: ExecutionContext): Boolean
}
```

Behavior when a soft-dep is absent: returns `false` + logs a warning once at bundle load (not on every evaluation).

### `ActionExecutor`

```kotlin
class ActionExecutor(
    val plugin: JavaPlugin,
    val menuProvider: MenuProvider,
    val sessions: MenuSessionStore,
    val deps: SoftDepRegistry,
    val cooldowns: CooldownStore,
    val evaluator: ConditionEvaluator,
) {
    fun handle(handler: ClickHandler, ctx: ExecutionContext)
    fun execute(actions: List<Action>, ctx: ExecutionContext)
    private fun executeOne(action: Action, ctx: ExecutionContext)
    private fun resolveArgs(text: String, ctx: ExecutionContext): String
}
```

`handle()` flow:
1. Cooldown active → send cooldown message, return
2. Requirements not met → run `fallback`, return
3. Run `actions`
4. Record cooldown

`resolveArgs()` replaces `{key}` with `ctx.args[key].toString()` in text fields.

**Thread constraint**: `ActionExecutor.execute()` is always called on the Bukkit main thread (from the event handler). Bukkit actions (openInventory, dispatchCommand, etc.) are therefore thread-safe.

---

## Section 5 — Menu sessions

```kotlin
data class MenuSession(
    val menuId: String,
    val menu: BundleMenu,
    val ctx: ExecutionContext,
    val inventory: Inventory,
)

class MenuSessionStore {
    private val sessions = ConcurrentHashMap<UUID, MenuSession>()
    fun set(player: Player, session: MenuSession)
    fun get(player: Player): MenuSession?
    fun remove(player: Player)
}
```

`MenuProvider.openMenu` takes an optional `ExecutionContext` (default = empty context). Creates a `MenuSession` and stores it.

`MenuListener`:
- `InventoryClickEvent`: if `holder is ArtisanMenuHolder`, cancel, get the session, identify the element via `slotToElement`, get the `ClickHandler`, call `executor.handle(handler, session.ctx)`
- `InventoryCloseEvent`: remove the session

---

## Section 6 — Commands system

### `CompiledCommand`

```kotlin
data class CompiledCommand(
    val name: String,
    val aliases: List<String>,
    val permission: String?,
    val description: String,
    val argDefs: List<ArgDef>,
    val handler: ClickHandler, // reuses the same model as menu clicks
)
```

### `CommandRegistrar`

```kotlin
class CommandRegistrar(private val plugin: JavaPlugin) {
    private val registered = mutableListOf<String>()

    fun reload(bundles: List<PackBundle>, executor: ActionExecutor, evaluator: ConditionEvaluator)
    fun unregisterAll()
}
```

In `reload()`:
1. `unregisterAll()` — unregister the previous commands
2. For each `CommandYaml` in the bundles: conflict detection (§15.6), compilation, registration via `Bukkit.getCommandMap().register(plugin.name.lowercase(), cmd)`
3. **Vanilla / third-party plugin conflict**: if `commandMap.getCommand(name)` returns a non-Artisan command → log warning, skip (no silent override)
4. **Internal conflict** (same name in two packs): last loaded loses, log warning

### `PackCommand`

One Bukkit `Command` per pack command. In `execute()`:
1. Check in-game + permission
2. `ArgParser.parse(argDefs, args, sender)` → `Map<String, Any>` or `null` (with error message to the player)
3. `ExecutionContext(player = sender, args = parsed)`
4. `executor.handle(cmd.handler, ctx)`

Tab-completion via `ArgParser.tabComplete()`: online players for `PlayerArg`, enum values for `EnumArg`, empty otherwise.

### `ArgParser`

Parses the raw positional args according to the `ArgDef`s in order. Behavior on a missing arg:
- `required = true`: typed error message to the player, returns `null`
- `required = false`: uses the `default` (with PAPI resolution if available)

Typed parse errors (offline player, unloaded world, invalid enum value) → explicit message, returns `null`, command not executed.

---

## `MenuProvider` interface — required addition

```kotlin
fun allBundles(): List<PackBundle>  // returns all loaded bundles, for CommandRegistrar
```

---

## `CloseMenu` behavior

`Action.CloseMenu` → `ctx.player.closeInventory()` on the main thread. The `InventoryCloseEvent` then triggers `MenuSessionStore.remove()` as usual.

---

## Wiring in `ArtisanPlugin`

```kotlin
// onEnable()
val softDeps = SoftDepRegistry(this)
val cooldowns = CooldownStore()
val sessions = MenuSessionStore()
val evaluator = ConditionEvaluator(softDeps, cooldowns)
val executor = ActionExecutor(this, menuProvider, sessions, softDeps, cooldowns, evaluator)
val commandRegistrar = CommandRegistrar(this)
server.pluginManager.registerEvents(MenuListener(sessions, executor), this)
commandRegistrar.reload(menuProvider.allBundles(), executor, evaluator)
```

`reinit()` calls `commandRegistrar.reload()` after reloading the packs.

---

## Tests to write

| Scope | What is tested |
|---|---|
| `ActionParser` | Correct parse of each type, exception on unknown type |
| `ConditionParser` | not/and/or recursion, parse each type |
| `ConditionEvaluator` | has_permission, has_money (mock vault), not/and/or, cooldown |
| `ActionExecutor` | handle() requirements→actions flow, cooldown flow, resolveArgs() |
| `CooldownStore` | isOnCooldown player scope, global scope, expiry |
| `ArgParser` | Parse string/int/player/enum, missing required, invalid enum |
| `CommandRegistrar` | Conflict detected, skip without exception |
