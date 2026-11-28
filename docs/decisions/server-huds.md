# Server HUDs — a `hud` Document kind in Artisan, modules provide variables

**Status:** proposed (2026-11-28), draft, not yet accepted.
**Builds on:** `triggers-and-variables` §10 (module variables), the HUD layers of `modules.md`
(`OverlayApi`, `OverlayLayout`, `Slot.ACTION_BAR` / `Slot.BOSS_BAR`), `extensible-document-kinds`.
**Supersedes, once delivered:** ArtisanQuests' `quest_hud` kind (artisan-quests #66, #67).

## Context

Every HUD drawn today belongs to a module: the conversation modes of ArtisanConversations (action
bar) and ArtisanQuests' tracked quest (`quest_hud`, boss bar). Each module declares its own kind,
reads its own file, composes its own `OverlayLayout` and calls `api.getOverlay().show`. That works
while the HUD shows one module's state.

The next requests do not fit (Iban, 2026-11-28):

- a **server HUD** the admin writes: the player's money, rank, online count, a "scoreboard"
  drawn as a HUD;
- a HUD **anchored in a corner** (top left, top right) rather than centred;
- a HUD mixing **several modules**: the tracked quest next to the money.

None of them belongs to a module. And what is module-specific in `quest_hud` is only *which
values* it shows (`objective_name`, `objective_progress`…), which module variables
(`{var.<module>.<name>}`, §10) already carry, typed, offered by the editor, resolved on the
player's thread.

What is already shared and stays as is: the `OverlayLayout` format and its reader, the editor's
`OverlayComposer`, the pack images (`pack.images`), the slots and their layer stacking by priority
(`OverlaySlots`, `HudBossBars`).

## Decision (proposed)

1. **A `hud` Document kind in Artisan core**, folder `huds/` of any Project, schema `hud/v1`:
   ```yaml
   slot: boss_bar            # boss_bar | action_bar ; later top_left, top_right… (§5)
   priority: 100             # among the other layers of the slot, as OverlaySlots stacks them
   refresh: 20               # ticks between two renders; 0 = only on a Game event (§3)
   when: [ ... ]             # optional conditions (the ConditionsEditor list); false = hidden
   layout: [ ... ]           # an OverlayLayout, unchanged
   texts:                    # MiniMessage of each named text layer, with {…} templates
     money: "<gold>{var.economy.balance} ⛃"
     quest: "<white>{var.quests.tracked_objective} <gray>[{var.quests.tracked_progress}/{var.quests.tracked_target}]"
   ```
   Every enabled `hud` is shown to every online player for whom `when` holds and who has the pack.
   A player without the pack sees nothing from it (a HUD has no chat fallback; a module that needs
   one, like the tracked quest's boss bar, keeps it on its side, §6).
2. **Texts are ordinary templates.** `{var.…}`, `{player}`, PAPI `%…%`, expressions: the same
   engine and the same `{` autocomplete as the lore. No HUD-specific placeholder syntax.
3. **Refresh.** Rendered per player every `refresh` ticks on the player's thread (`Scheduler`
   port, Folia), and resent only when the composed MiniMessage changed (one string compare per
   player and HUD). `refresh: 0` renders on join and on a declared Game event only. Default 20.
4. **Modules provide values, not HUDs.** A module that wants its state on a HUD declares module
   variables (§10). ArtisanQuests declares `quests.tracked_*` (quest name, objective, progress,
   target, percent); the tracked-quest HUD becomes a plain `hud` with those variables. Modules
   keep `api.getOverlay()` for HUDs bound to an interaction (a conversation page, a dialog):
   those are sessions, not standing displays.
5. **Corners (to prototype first).** The boss bar and the action bar are centred and the server
   does not know the player's screen width, so a corner cannot be reached by an offset. The known
   way is a **core shader** in Artisan's pack: `rendertype_text.vsh` recognises a reserved text
   colour and moves those glyphs to a corner using `ScreenSize`. If the prototype holds on vanilla
   and on common client setups, `slot` gains `top_left`, `top_right`, `bottom_left`,
   `bottom_right`, drawn through the boss bar line with that colour; otherwise this point is
   dropped and the ADR says so.
6. **Migration of `quest_hud`.** Artisan ships the kind; ArtisanQuests declares its variables and,
   on first start with the new API, converts `quest_huds/*.yaml` into `huds/*.yaml` (layout kept,
   `%objective_name%` → `{var.quests.tracked_objective}`…), then reads the boss-bar fallback
   only. The `quest_hud` kind is removed one version later.

7. **Three lifetimes, one runtime.** A HUD is shown **permanently** (no `when`: a scoreboard,
   the money), **conditionally** (`when`, re-evaluated at each refresh and on declared Game
   events: "tracks a quest", "is in a PvP zone") or **temporarily**: shown for a duration or until
   hidden, by the action `show_hud: {hud, duration}` or by a module,
   `api.getHuds().show(player, hudRef, values, duration)` / `hide(player, hudRef)`, the `values`
   filling `{arg.…}` in its texts. The tracked quest is conditional; a conversation page is
   temporary, shown by ArtisanConversations with the page's values. `OverlayApi` stays as the
   low layer under it.
8. **Bedrock, second step.** Geyser carries the boss bar and action bar text but not the Java
   pack's fonts (no offsets, no glyph images) nor core shaders; a Bedrock player has no Java pack
   (`hasPack` false) and keeps any module fallback. A Bedrock HUD is a second renderer of the same
   Document, in the Bedrock pack Artisan already builds for menus: a panel in `hud_screen.json`
   (JSON UI) shown when the title or action bar text starts with a marker, hiding the vanilla
   text, laying the values the server sends (marker + separated values) with its own images.
   JSON UI anchors are native, so corners need no hack there. Several HUDs of a player are merged
   into one payload (one channel per player). Risk: JSON UI is not a stable API (Ore UI is
   replacing it); tracked per Bedrock version like the menus.

## Consequences

- One kind and one editor page for every standing HUD; the admin composes a HUD from any module's
  variables without the module shipping a HUD.
- An API change: `Since` lines in `api-surface.md` for the kind's presence and for the quests'
  variables; ArtisanQuests' `MIN_API_VERSION` rises.
- Cost per player: one template render per HUD every `refresh` ticks. 100 players × 3 HUDs × 1/s
  is 300 renders/s of short strings; resend only on change.
- The action bar is shared with every plugin that sends action bar messages: a HUD there flickers
  with them. The boss bar slot does not have that problem; it is the default.
- Yellow boss bars stay reserved (already true since API 1.13.0).

## Open questions (what would change the decision)

- **Bedrock payload** (§8): title or action bar as the carrier, and the marker format.
- **Shader viability** (§5): if Iris/Sodium shader packs override core text shaders on enough
  clients, corners are dropped.
- **Per-player choice**: does a player turn a HUD off (a `/hud` toggle, a Project variable read by
  `when`)? `when` already allows it if the toggle is a variable; a dedicated command may not be
  needed.
- **Several Projects** each shipping a `hud` into the same slot: stacking by `priority` handles
  it; is a server-wide list of active HUDs needed in the editor's Home?

## Rejected

- **Each module keeps its own HUD kind** (`quest_hud`, future `economy_hud`…): one kind per
  module, no mixing, the admin learns N editors for the same layout.
- **A generic `hud` whose slots each module declares** (named zones + module-specific
  placeholders): a declaration API that duplicates module variables.
