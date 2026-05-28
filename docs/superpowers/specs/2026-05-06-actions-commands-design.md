# Design — Système d'actions et de commandes (Plugin)

**Date :** 2026-05-06  
**Scope :** Plugin Kotlin (Paper 1.21.4)  
**Status :** Approuvé

---

## Contexte

Le rendu des menus est fonctionnel (`MenuRenderer`). Les clics sont annulés par `MenuListener` mais aucune action n'est exécutée. Les `CommandYaml` sont parsés depuis le YAML mais jamais enregistrés auprès de Bukkit.

Ce design couvre :
1. Le **système d'actions** — exécution des 15 actions MVP au clic sur un slot de menu
2. Le **système de conditions** — évaluation des 16 conditions (avec soft-deps Vault/PAPI/WorldGuard)
3. Le **système de commandes** — enregistrement dynamique des commandes définies dans les packs

---

## Décisions clés

| Décision | Choix | Raison |
|---|---|---|
| Architecture action/condition | Sealed class hierarchy, parse at load | Erreurs de config détectées au chargement, pas au clic ; code d'exécution type-safe |
| Soft-deps | `SoftDepRegistry` centralisé, providers nullable | Architecture propre, no-op explicite si plugin absent |
| Enregistrement commandes | Paper `Bukkit.getCommandMap()` | Pas de reflection, supporte le re-register au reload |
| Scope des actions | Les 15 actions spec MVP | Cohérence avec la spec, Vault en soft-dep |
| Scope des conditions | Les 16 conditions spec | Soft-deps no-op si absent |
| Pagination en V1 | `PaginationNext/Prev` = no-op, `PaginationAtFirst/Last` = `false` | Pagination pas encore implémentée ; les hooks sont posés pour le sprint suivant |
| Propagation de contexte | Complète dès V1 | `ExecutionContext` porté args commande → open_menu → menu |

---

## Architecture — Vue d'ensemble

```
plugin/src/main/kotlin/net/artisanmc/plugin/
  engine/
    Action.kt              ← sealed class hierarchy (15 actions)
    Condition.kt           ← sealed class hierarchy (16 conditions)
    ClickHandler.kt        ← ClickHandler, Cooldown, ClickType, MenuSession
    ExecutionContext.kt    ← data class player + args
    ActionParser.kt        ← Map<String,Any> → Action
    ConditionParser.kt     ← Map<String,Any> → Condition (récursif)
    ArgDef.kt              ← sealed class ArgDef + ArgDefParser
    SoftDepRegistry.kt     ← VaultProvider, PapiProvider, WorldGuardProvider
    CooldownStore.kt       ← in-memory, thread-safe
    ConditionEvaluator.kt  ← évalue Condition récursivement
    ActionExecutor.kt      ← handle(ClickHandler, ctx), execute(actions, ctx)
    MenuSessionStore.kt    ← UUID → MenuSession
  command/
    CompiledCommand.kt     ← version compilée de CommandYaml
    CommandCompiler.kt     ← CommandYaml → CompiledCommand
    PackCommand.kt         ← Bukkit Command par commande pack
    ArgParser.kt           ← parse args bruts + tabComplete
    CommandRegistrar.kt    ← register/unregister via commandMap

  model/PackBundle.kt      ← mise à jour ClickHandlerYaml + BundleMenu.compiledClicks
  render/MenuListener.kt   ← câblage clic → ActionExecutor
  ArtisanPlugin.kt       ← init SoftDepRegistry, CommandRegistrar
```

---

## Section 1 — Modèle de données

### Couche YAML (Jackson)

Mise à jour de `ClickHandlerYaml` (actuellement `steps: List<Map<String,Any>>` ne correspond pas à la spec) :

```kotlin
data class ClickHandlerYaml(
    val requirements: List<Map<String, Any>> = emptyList(),
    val actions:      List<Map<String, Any>> = emptyList(),
    val fallback:     List<Map<String, Any>> = emptyList(),
    val cooldown:     CooldownYaml? = null,
)

data class CooldownYaml(
    val id:       String  = "",
    val duration: Long    = 0,   // secondes
    val scope:    String  = "player", // "player" | "global"
    val message:  String? = null,
)
```

### Couche compilée (sealed classes)

**`Action`** — 15 actions :

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
    data class PaginationNext(val elementId: String? = null) : Action()  // no-op en V1
    data class PaginationPrev(val elementId: String? = null) : Action()  // no-op en V1
}
```

**`Condition`** — 16 conditions :

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
    data class PaginationAtFirst(val elementId: String? = null) : Condition()  // retourne false en V1
    data class PaginationAtLast(val elementId: String? = null) : Condition()   // retourne false en V1
    data class Not(val inner: Condition) : Condition()
    data class And(val all: List<Condition>) : Condition()
    data class Or(val any: List<Condition>) : Condition()
}
```

**`ClickHandler`** et types associés :

```kotlin
data class Cooldown(val id: String, val durationSeconds: Long, val scope: String = "player", val message: String? = null)
data class ClickHandler(val requirements: List<Condition>, val actions: List<Action>, val fallback: List<Action>, val cooldown: Cooldown? = null)

enum class ClickType { LEFT, RIGHT, SHIFT_LEFT, SHIFT_RIGHT, MIDDLE }
```

**`BundleMenu`** — nouveau champ compilé :

```kotlin
data class BundleMenu(
    val yaml: MenuYaml,
    val langMaps: Map<String, Map<String, String>>,
    val compiledClicks: Map<String, Map<ClickType, ClickHandler>>, // elementId → clickType → handler
    val slotToElement: Map<Int, String>,                           // slot index → elementId (pré-calculé)
)
```

---

## Section 2 — Couche de parsing

### `ActionParser`

Objet stateless. Convertit `Map<String, Any>` → `Action`. Lève `IllegalArgumentException` sur type inconnu ou champ manquant — l'appelant (`PackReader`) catch et log.

### `ConditionParser`

Objet stateless. Récursif pour `not`, `and`, `or` :

```kotlin
"not" -> Condition.Not(parse(raw["of"] as Map<String, Any>))
"and" -> Condition.And((raw["all"] as List<*>).map { parse(it as Map<String, Any>) })
"or"  -> Condition.Or((raw["any"] as List<*>).map { parse(it as Map<String, Any>) })
```

### `ArgDefParser`

Convertit `List<Map<String, Any>>` → `List<ArgDef>`. Types supportés en V1 : `string`, `int`, `player`, `world`, `item_material`, `enum`.

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

### Intégration dans `PackReader`

Après désérialisation Jackson, pour chaque menu :
1. Pour chaque élément × apparence × type de clic → appel `ActionParser` + `ConditionParser`
2. Construction de `compiledClicks` et `slotToElement`
3. Si exception levée : menu skippé, warning loggé, autres menus du bundle continuent

---

## Section 3 — Soft-dep registry

```kotlin
class SoftDepRegistry(plugin: JavaPlugin) {
    val vault:      VaultProvider?      = VaultProvider.tryInit(plugin)
    val papi:       PapiProvider?       = PapiProvider.tryInit()
    val worldGuard: WorldGuardProvider? = WorldGuardProvider.tryInit()
}
```

Chaque provider expose une API métier propre et encapsule la dépendance :

**`VaultProvider`** : `balance(player)`, `withdraw(player, amount): Boolean`, `deposit(player, amount)`  
**`PapiProvider`** : `resolve(player, text): String`  
**`WorldGuardProvider`** : `isInRegion(player, region): Boolean`

`tryInit()` retourne `null` si le plugin est absent ou si l'initialisation échoue. Un warning est loggé une seule fois au démarrage pour chaque soft-dep absent utilisé dans un menu/commande chargé.

---

## Section 4 — Moteur d'exécution

### `ExecutionContext`

```kotlin
data class ExecutionContext(
    val player: Player,
    val args: Map<String, Any> = emptyMap(), // args commande parsés OU contexte open_menu
)
```

### `CooldownStore`

In-memory, thread-safe via `ConcurrentHashMap`. Deux maps :
- `playerCooldowns: Map<String, Map<UUID, Long>>` — id → uuid → expiry ms
- `globalCooldowns: Map<String, Long>` — id → expiry ms

### `ConditionEvaluator`

```kotlin
class ConditionEvaluator(val deps: SoftDepRegistry, val cooldowns: CooldownStore) {
    fun evaluateAll(conditions: List<Condition>, ctx: ExecutionContext): Boolean
    fun evaluate(condition: Condition, ctx: ExecutionContext): Boolean
}
```

Comportement soft-dep absent : retourne `false` + log warning une fois au chargement du bundle (pas à chaque évaluation).

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

Flux de `handle()` :
1. Cooldown actif → envoyer message cooldown, return
2. Requirements non satisfaits → exécuter `fallback`, return
3. Exécuter `actions`
4. Enregistrer cooldown

`resolveArgs()` remplace `{key}` par `ctx.args[key].toString()` dans les champs texte.

**Contrainte thread** : `ActionExecutor.execute()` est toujours appelé sur le thread principal Bukkit (depuis l'event handler). Les actions Bukkit (openInventory, dispatchCommand, etc.) sont donc thread-safe.

---

## Section 5 — Sessions de menu

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

`MenuProvider.openMenu` reçoit un `ExecutionContext` optionnel (défaut = contexte vide). Crée une `MenuSession` et la stocke.

`MenuListener` :
- `InventoryClickEvent` : si `holder is ArtisanMenuHolder`, annule, récupère la session, identifie l'élément via `slotToElement`, récupère le `ClickHandler`, appelle `executor.handle(handler, session.ctx)`
- `InventoryCloseEvent` : supprime la session

---

## Section 6 — Système de commandes

### `CompiledCommand`

```kotlin
data class CompiledCommand(
    val name: String,
    val aliases: List<String>,
    val permission: String?,
    val description: String,
    val argDefs: List<ArgDef>,
    val handler: ClickHandler, // réutilise le même modèle que les clics de menu
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

Dans `reload()` :
1. `unregisterAll()` — désenregistre les commandes précédentes
2. Pour chaque `CommandYaml` dans les bundles : détection de conflit (§15.6), compilation, enregistrement via `Bukkit.getCommandMap().register(plugin.name.lowercase(), cmd)`
3. **Conflit vanilla / plugin tiers** : si `commandMap.getCommand(name)` retourne une commande non-Artisan → log warning, skip (pas d'override silencieux)
4. **Conflit interne** (même nom dans deux packs) : dernier chargé perd, log warning

### `PackCommand`

Un `Command` Bukkit par commande pack. Dans `execute()` :
1. Vérif in-game + permission
2. `ArgParser.parse(argDefs, args, sender)` → `Map<String, Any>` ou `null` (avec message d'erreur au joueur)
3. `ExecutionContext(player = sender, args = parsed)`
4. `executor.handle(cmd.handler, ctx)`

Tab-completion via `ArgParser.tabComplete()` : players en ligne pour `PlayerArg`, valeurs enum pour `EnumArg`, vide sinon.

### `ArgParser`

Parse les args bruts positionnels selon les `ArgDef` dans l'ordre. Comportement sur arg manquant :
- `required = true` : message d'erreur typé au joueur, retourne `null`
- `required = false` : utilise le `default` (avec résolution PAPI si disponible)

Erreurs de parse typées (joueur offline, monde non chargé, valeur enum invalide) → message explicite, retourne `null`, commande non exécutée.

---

## Interface `MenuProvider` — ajout nécessaire

```kotlin
fun allBundles(): List<PackBundle>  // retourne tous les bundles chargés, pour CommandRegistrar
```

---

## Comportement de `CloseMenu`

`Action.CloseMenu` → `ctx.player.closeInventory()` sur le thread principal. L'`InventoryCloseEvent` déclenche ensuite `MenuSessionStore.remove()` normalement.

---

## Câblage dans `ArtisanPlugin`

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

`reinit()` appelle `commandRegistrar.reload()` après rechargement des packs.

---

## Tests à écrire

| Scope | Ce qui est testé |
|---|---|
| `ActionParser` | Parse correcte de chaque type, exception sur type inconnu |
| `ConditionParser` | Récursivité not/and/or, parse chaque type |
| `ConditionEvaluator` | has_permission, has_money (mock vault), not/and/or, cooldown |
| `ActionExecutor` | handle() flux requirements→actions, flux cooldown, resolveArgs() |
| `CooldownStore` | isOnCooldown player scope, global scope, expiry |
| `ArgParser` | Parse string/int/player/enum, required manquant, enum invalide |
| `CommandRegistrar` | Conflit détecté, skip sans exception |
