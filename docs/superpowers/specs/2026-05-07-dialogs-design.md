# Dialog System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Paper Dialog support to Artisan so pack authors can define dialogs in YAML — with optional form inputs — that are opened via `open_dialog` action or declared as first-class resources in a pack manifest.

**Architecture:** Single unified `dialog/v1` YAML schema, mirroring menu/command patterns. Dialogs are compiled into `BundleDialog` at pack load, opened via `DialogRenderer` which builds Paper `Dialog` objects with inline one-shot callbacks. Input values are injected into `ctx.args` before button actions execute, making `{input_id}` substitution available in all downstream actions.

**Tech Stack:** Kotlin 2.0, Paper API 1.21.7+ (Dialog API), existing ActionExecutor / ExecutionContext / i18n systems.

---

## YAML Schema

### `dialog/v1`

```yaml
schema: dialog/v1
id: d_confirm_buy
title: "{i18n:dialogs.confirm_buy.title}"
can_close_with_escape: true       # optional, default: true

body:                              # optional
  - type: text
    text: "{i18n:dialogs.confirm_buy.body}"
  - type: item
    material: DIAMOND
    count: 1

inputs:                            # optional — omit for button-only dialogs
  - id: quantity
    type: number_range
    label: "{i18n:dialogs.confirm_buy.quantity}"
    min: 1
    max: 64
    default: 1
  - id: tier
    type: single_option
    label: "{i18n:dialogs.confirm_buy.tier}"
    options:
      - value: basic
        label: "{i18n:common.basic}"
      - value: premium
        label: "{i18n:common.premium}"
    default: basic
  - id: gift
    type: bool
    label: "{i18n:dialogs.confirm_buy.gift}"
    default: false
  - id: note
    type: text
    label: "{i18n:dialogs.confirm_buy.note}"
    default: ""
    max_length: 64

buttons:                           # at least 1 required
  - id: btn_confirm
    label: "{i18n:common.confirm}"
    requirements:
      - type: has_money
        amount: 100
    actions:
      - type: take_money
        amount: 100
      - type: send_message
        text: "Bought {quantity}x ({tier})"
    fallback:
      - type: send_message
        text: "Not enough money."
  - id: btn_cancel
    label: "{i18n:common.cancel}"
    actions:
      - type: close_dialog
```

### Manifest

```yaml
files:
  menus:    [test]
  commands: [c_1_abc]
  dialogs:  [d_confirm_buy]
```

---

## Data Model

### New types in `model/PackBundle.kt`

```kotlin
@JsonIgnoreProperties(ignoreUnknown = true)
data class DialogYaml(
    val schema: String = "",
    val id: String = "",
    val title: String = "",
    @JsonProperty("can_close_with_escape") val canCloseWithEscape: Boolean = true,
    val body: List<DialogBodyYaml> = emptyList(),
    val inputs: List<DialogInputYaml> = emptyList(),
    val buttons: List<DialogButtonYaml> = emptyList(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class DialogBodyYaml(
    val type: String = "text",       // "text" | "item"
    val text: String? = null,
    val material: String? = null,
    val count: Int = 1,
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class DialogInputYaml(
    val id: String = "",
    val type: String = "",           // "text" | "bool" | "number_range" | "single_option"
    val label: String = "",
    val default: String = "",
    val min: Double = 0.0,
    val max: Double = 100.0,
    @JsonProperty("max_length") val maxLength: Int = 32,
    val options: List<DialogOptionYaml> = emptyList(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class DialogOptionYaml(
    val value: String = "",
    val label: String = "",
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class DialogButtonYaml(
    val id: String = "",
    val label: String = "",
    val requirements: List<Map<String, Any>> = emptyList(),
    val actions: List<Map<String, Any>> = emptyList(),
    val fallback: List<Map<String, Any>> = emptyList(),
)

data class BundleDialog(
    val yaml: DialogYaml,
    val langMaps: Map<String, Map<String, String>>,
) {
    val id: String get() = yaml.id
}
```

### Updates to existing types

**`ManifestFiles`:**
```kotlin
data class ManifestFiles(
    val menus: List<String> = emptyList(),
    val commands: List<String> = emptyList(),
    val dialogs: List<String> = emptyList(),
)
```

**`PackBundle`:**
```kotlin
data class PackBundle(
    val packId: String,
    val defaultLang: String,
    val languages: List<String>,
    val menus: List<BundleMenu>,
    val commands: List<CommandYaml>,
    val dialogs: List<BundleDialog>,
)
```

### New Actions in `engine/Action.kt`

```kotlin
data class OpenDialog(
    val dialogId: String,
    val context: Map<String, String> = emptyMap(),
    val clearContext: Boolean = false,
) : Action()

data object CloseDialog : Action()
```

---

## Engine

### `DialogRenderer` (`render/DialogRenderer.kt`)

Builds a Paper `Dialog` from `BundleDialog` + lang + ctx. For each button:
- Compiles its `ClickHandler` (requirements + actions + fallback) via existing `BundleCompiler` helpers
- Creates a `DialogAction.customClick(callback, ClickCallback.Options(uses=1))` one-shot callback
- The callback: reads `DialogResponseView`, converts each input value to `String`, builds `newCtx = ctx.copy(args = ctx.args + inputValues)`, calls `executor.handle(handler, newCtx)`

Input value extraction from `DialogResponseView`:
| YAML type     | Paper read method     | ctx.args value        |
|---------------|-----------------------|-----------------------|
| `text`        | `getString(id)`       | raw string            |
| `bool`        | `getBoolean(id)`      | `"true"` / `"false"`  |
| `number_range`| `getFloat(id)`        | int string if whole, else float string |
| `single_option`| `getString(id)`      | option `value` string |

`DialogRenderer.open(player, dialog, lang, ctx, executor)`:
1. Resolves `title` via i18n
2. Builds `DialogBase` with body components (resolving i18n) and `canCloseWithEscape`
3. Builds `DialogInput` list from `dialog.yaml.inputs`
4. Builds `ActionButton` list from `dialog.yaml.buttons`, each with one-shot callback
5. Sets `DialogType` to `notice()` (1 button) or `multiAction()` (≥2 buttons)
6. Calls `player.showDialog(dialog)`

No `DialogListener` or `PlayerCustomClickEvent` handler needed — Paper one-shot callbacks handle everything inline.

### `ActionExecutor` — new cases in `executeOne`

```kotlin
is Action.OpenDialog -> {
    val newArgs = if (action.clearContext)
        action.context.mapValues { it.value as Any }
    else
        ctx.args + action.context.mapValues { it.value as Any }
    menuProvider.openDialog(player, action.dialogId, ctx.lang, ctx.copy(args = newArgs))
}
is Action.CloseDialog -> player.closeDialog()
```

### `ActionParser` — new cases

```kotlin
"open_dialog" -> Action.OpenDialog(
    dialogId = map["dialog_id"] as String,
    context = (map["context"] as? Map<*, *>)
        ?.mapKeys { it.key.toString() }
        ?.mapValues { it.value.toString() } ?: emptyMap(),
    clearContext = map["clear_context"] as? Boolean ?: false,
)
"close_dialog" -> Action.CloseDialog
```

---

## Provider & Wire-up

### `MenuProvider` interface — new methods

```kotlin
fun findDialog(dialogId: String): BundleDialog?
fun openDialog(player: Player, dialogId: String, lang: String, ctx: ExecutionContext)
```

### `SyncedMenuProvider`

- Add `@Volatile private var dialogs = ConcurrentHashMap<String, BundleDialog>()`
- `reloadFromDisk()` populates it atomically (same `@Volatile` swap pattern as `menus`)
- `findDialog` and `openDialog` delegate to `DialogRenderer.open`
- `openDialog` needs `ActionExecutor` — add `private val executorProvider: () -> ActionExecutor` to the constructor (same lazy-lambda pattern as `onReload`). In `ArtisanPlugin.onEnable()`:
  ```kotlin
  menuProvider = SyncedMenuProvider(
      ...,
      executorProvider = { executor },  // captures lateinit var executor
  )
  executor = ActionExecutor(menuProvider, ...)
  ```

### `PackReader`

For each id in `manifest.files.dialogs`:
- Read `dialogs/<id>.yaml` → `DialogYaml`
- Reuse the pack's already-loaded `langMaps`
- Construct `BundleDialog(yaml, langMaps)`

### `ArtisanPlugin`

No new Bukkit listener registration needed. Wire `executor` into `SyncedMenuProvider` so `openDialog` can call it. The existing construction order in `onEnable()` handles this — pass `executor` as a constructor param or via a `setExecutor(executor)` call after both are created.

### `build.gradle.kts`

```kotlin
compileOnly("io.papermc.paper:paper-api:1.21.7-R0.1-SNAPSHOT")
```

Required for compile-time access to `Dialog`, `DialogInput`, `DialogAction`, `DialogResponseView`.

---

## Testing

- **`DialogYamlParserTest`** — parses `dialog/v1` YAML with all input types, verifies field mapping
- **`ActionParserTest`** — adds `open_dialog` and `close_dialog` cases
- **`DialogRendererTest`** — with MockBukkit: `open()` doesn't throw, returns normally (Paper Dialog API is hard to mock deeply; verify no exception + correct `player.showDialog` call)
- **`ActionExecutorTest`** — `OpenDialog` delegates to `menuProvider.openDialog`, `CloseDialog` calls `player.closeInventory()`
- **`PackReaderTest`** — pack with `dialogs: [d_test]` in manifest loads `BundleDialog` correctly

---

## Invariants

- Dialog ids are pack-scoped (same as menus): two packs can have a `d_confirm` without collision since `findDialog` searches the provider's unified map (last-write-wins on reload, same as menus).
- Input `default` values are always non-null strings. `number_range` default is parsed as `Double` then formatted.
- One-shot callbacks (`uses = 1`) mean a stale dialog open before a pack reload cannot fire actions twice. A reopened dialog gets a fresh callback.
- `CloseDialog` uses `player.closeDialog()` (closes only the dialog, leaves any open inventories untouched). Use `close_menu` if you need to close an inventory.
