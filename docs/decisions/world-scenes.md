# Scenes — interfaces drawn in the world, for one player, with display entities

**Status:** proposed (2026-11-04). Batch ① (engine, Paper backend, `api.getScenes()`) delivered
as a prototype in the same PR, `@Beta`, tried on the lobby on Java and Bedrock (2026-11-04);
batches ② to ⑤ to be accepted one by one.

## Context

Iban wants Artisan to draw interfaces **in the world** rather than in a chest or in the chat,
and to do it once, as a brick every module reuses (2026-11-04, from the ArtisanConversations
thread). The references he gave:

- **LuxDialogues** (conversation in "cinematic" mode): the player's camera is still, the screen
  zooms in, the edges darken, the hotbar is gone; the text box, the speaker's name and the choices
  float in front of the NPC, pointed at by a cursor.
- **UltimateUI** "No more chest GUIs": menus made of items and text standing in front of the
  player, clicked with a cursor; and HUDs that stay on screen (corner panels, a top bar).

Uses already asked for in the suite:

| Use | Module | Needs |
|---|---|---|
| A marker above an NPC (`!` when a quest is available, `?` when it can be handed in) | Quests, Conversations | per-player content, follows an entity, cheap |
| A menu without a chest (shop, warps) | Menus, Store | layout of items and text, clicks, a cursor |
| The cinematic mode of a conversation | Conversations | camera lock, zoom, vignette, box in front of the camera, choices |
| A HUD that stays on screen | Overlay (today action bar only) | anchored to the screen, not the world |

What Minecraft gives since 1.19.4, without mods:

- **Display entities**: `TextDisplay`, `ItemDisplay`, `BlockDisplay`. No hitbox, no physics, a
  full affine transformation (translation, rotations, scale), a billboard mode, a brightness, a
  view range. A change of transformation is **interpolated by the client** over N ticks
  (`interpolation_duration`), and since 1.20.2 a teleport too (`teleport_duration`): an animation
  costs one packet, not one per frame.
- **`Interaction`** entities: an invisible hitbox of a given width and height that receives the
  player's left and right clicks.
- **Per-player visibility in Paper**: `Entity.setVisibleByDefault(false)` then
  `Player.showEntity(plugin, entity)`. The entity exists on the server, only its viewer's client
  receives it. No packet library: PacketEvents does not run on the lobby, and Artisan's own NMS
  layer (`render/packets`) is kept for menus.
- **Camera**: `Player.setSpectatorTarget(entity)` puts a spectator's camera in an entity (the
  hotbar and the hand disappear: this is the LuxDialogues look); since 1.21.2 the `equippable`
  item component carries a `camera_overlay`, a full-screen texture the client draws when the item
  is on the head, and `Player.sendEquipmentChange` fakes that item for one client only.

What exists in Artisan: the **overlay** (`OverlayApi`, internal 2.20.0) draws a HUD in the action
bar with the pack's fonts, layers per module in screen slots that Artisan owns, laid out as data
(`OverlayLayout`) and composed in the editor (`OverlayComposer`). Scenes are its counterpart in
the world, on the same principles: Artisan owns what is drawn, a module puts named content there,
two modules never overwrite each other.

## Decisions

### 1. One scene engine in the JVM, owned by Artisan

The entities a scene spawns are **shared state** (rule ② of `runtime-library`): exactly one
owner, in `paper`, next to `OverlaySlots`. A module never spawns a display itself: it asks Artisan
for a scene and gets nothing to hold.

The engine is split in two:

- **`SceneBook`** (pure Kotlin, no Bukkit, tested): who sees which scene, the diff between two
  shows of a scene, every way a scene ends. It holds the only reference to each display handle.
- **`DisplayBackend`**: what draws an element. The first and only one is `EntityDisplayBackend`
  (Paper entities). The backend is a per-client choice as much as a per-server one: a Bedrock
  viewer will be drawn by another backend (§11), so an element says what to draw, never how. A packet backend (no server entity at all) can come later behind the same
  interface **if measurements ask for it** (hundreds of viewers × dozens of elements); not before,
  because it costs a protocol layer per Minecraft version.

### 2. A scene is a tree of elements standing on an anchor, for one viewer

```
scene "quests:marker" for Alex
  anchor: above(npc, 2.3)
  elements:
    text  "mark"   offset (0, 0.2, 0)   "<gold><bold>!"   billboard CENTER
    item  "icon"   offset (0, 0.6, 0)   PAPER             scale 0.5
```

- **Anchor**: a point of a world, an entity (followed), and later the viewer's camera (batch ③)
  and the screen (batch ⑤, §11).
- **Element**: `text` (MiniMessage), `item`, `block`; batch ④ adds `hitbox` (an `Interaction`)
  and batch ② `group` (a sub-tree with its own transform). Each element has a **key**, unique in
  the scene, and a transform (offset, yaw, scale).
- **Showing again updates in place.** Same key and same type: the entity stays, only what changed
  is sent; a changed transform is interpolated over the call's `transitionTicks`. A key that goes
  away is removed, a new one spawned, a new anchor respawns the scene. An update never despawns
  and respawns (that flickers), and an animation is two shows with a transition, never a task
  that moves an entity every tick.
- **Named after the module** (`<module>:<name>`), like overlay layers: that is how a module's
  scenes end with its plugin (§5).

### 3. Rendering is per viewer, and the content is already the viewer's

Each viewer gets his own entities, even when two players look at the same NPC marker: the content
depends on the player (quest state, language, placeholders, conditions). The engine receives
final MiniMessage; resolution belongs to the caller — a module, or the Scene Document kind
(batch ②), which goes through the runtime's `TemplateScope`, `ConditionEvaluator` and
translations like a menu does.

Cost bound: an element is an entity per viewer. `MAX_ELEMENTS` = 64 per scene; a server-wide
budget per viewer comes with batch ② once real scenes exist to measure.

### 4. Following an anchor entity: teleports, never passengers

A display could ride its anchor as a passenger, and the client would move it for free. Rejected:
Bukkit refuses `teleport` on an entity that carries passengers; the NPC plugin moving its NPC, or
any plugin teleporting a player, would silently fail. The engine follows instead: one loop per
anchor entity, on the anchor's thread, every tick, teleports the displays that are behind;
`teleport_duration` = 2 lets the client glide between positions. A motionless NPC costs a
distance check per tick.

### 5. Cleanup is guaranteed, and there is one way out

Every end of a scene goes through `SceneBook`, which removes every handle of the scene. A scene
ends when:

| Event | What ends |
|---|---|
| `hide` | that scene |
| the viewer quits | all their scenes |
| the viewer changes world | their scenes of other worlds |
| the anchor entity leaves its world (`EntityRemoveFromWorldEvent`: death, removal, chunk unload, quit) or is found invalid by the follow loop | every scene on it, whoever sees it |
| a plugin disables (`PluginDisableEvent`, before its own `onDisable`) | the scenes named after its modules |
| Artisan stops | everything, synchronously, before the scheduler is gone |

Nothing can be left in the world afterwards:

- every display is spawned **non-persistent** (`setPersistent(false)`): it is never written to
  the chunk, so a crash, a `kill -9` or a failed `onDisable` leaves nothing on disk;
- every display carries the PDC key `artisan:scene`; `EntitiesLoadEvent` removes a tagged display
  that no live handle owns (a chunk saved by another plugin's hand, an older Artisan);
- a remove that arrives before its spawn ran cancels the spawn.

A module is **not told** when Artisan ends its scene (prototype). Batch ② adds an end callback
(`SceneEnded`, with the reason) so a marker module can show its marker again when the NPC's chunk
loads back.

### 6. Threads

The API may be called from any thread. A spawn runs on the thread that owns the anchor (a region
for a point, the entity's scheduler for an entity), an update or a removal on the display's own.
`Player.showEntity` is called from the anchor's region: the viewer is within tracking range, on
Folia it shares that region. To check on Folia and Leaf before batch ② (prototype tested on Paper
only).

### 7. Public API: `api.getScenes()`, `@Beta`, on the model of `getOverlay()`

```java
ScenesApi scenes = api.getScenes();
if (scenes.supports(player)) {
    scenes.show(player, "quests:marker", SceneAnchor.above(npc, 2.3), List.of(
        SceneElement.Text.of("mark", SceneTransform.offset(0, 0.2, 0), "<gold><bold>!")
    ), 10);
}
scenes.hide(player, "quests:marker");
```

Records and sealed interfaces, Java, no Adventure type (MiniMessage strings as in the overlay),
Bukkit types where the API already uses them (`Player`, `Entity`, `Location`, `ItemStack`,
`BlockData`).

**Bedrock: text only (Iban, 2026-11-04, tested on the lobby).** Geyser draws a `TextDisplay` as a
floating name (no scale, rotation, background, line width nor animation) and draws nothing for an
item or block display. `support(player)` says what a viewer gets: `FULL` on Java, `TEXT_ONLY` for
a Bedrock player, for whom Artisan keeps the scene's text elements and leaves the others out. A
quest marker made of text works on Bedrock as is; a scene that needs items, blocks or animation
checks `supports(player)` (`FULL`) and falls back (chat, overlay, chest menu). `@Beta` until
batch ② has used it from a Document.

### 8. A Scene Document kind, composed in the editor (batch ②)

The data side, as `OverlayLayout` is to the overlay: a module (or a server owner) describes a
scene in YAML, the editor composes it visually, the server renders it per player.

```yaml
# scenes/npc_marker.yaml
anchor: entity          # point | entity | camera
elements:
  - text: mark
    at: [0, 0.2, 0]
    content: "<gold><bold>{marker}"
    billboard: center
  - item: icon
    at: [0, 0.6, 0]
    scale: 0.5
    material: "{icon}"
    if: [has_quest]
slots: [marker, icon]   # filled by the module that shows the scene
```

- Elements reuse the menu vocabulary (item specs, `if` conditions, templates, translations), so
  nothing is learned twice.
- **Slots** are what the module fills at show time (`marker`, the quest's icon), as the
  overlay's `image_slot` and `text` layers.
- Core actions `show_scene <scene> [anchor]` / `hide_scene <scene>` make a scene usable from any
  Action chain (a Trigger, a menu click, a conversation page).
- **Editor**: a composer in the same shell as `OverlayComposer`: a front view on `McScreen`
  (orthographic, what the viewer sees from 3 blocks), a top view for depth, elements dragged on
  both, the transition previewed by playing the interpolation.

### 9. The camera and the cinematic mode (batch ③)

A **camera anchor** places a scene in front of the viewer's eyes. It needs the camera to stay
still, which the engine owns as a **camera session**:

- **Lock**: spectator mode + `setSpectatorTarget(cameraEntity)`, the camera entity being an
  invisible display placed and turned by the scene (framing, slow travel with
  `teleport_duration`). This is what hides the hotbar and the hand. The previous game mode is
  written to the player's PDC **before** the switch and restored on end, on join (after a crash
  or a kick) and on Artisan's stop: a player can never stay in spectator.
  *Rejected:* riding an invisible entity (the head still turns, the hotbar stays).
- **Vignette**: a pack texture as the `camera_overlay` of a fake helmet
  (`sendEquipmentChange`, client-only, nothing to restore server-side). 1.21.2+.
- **Zoom**: the client's FOV follows the player's speed modifiers; a temporary
  `movement_speed` modifier narrows it. Respects the player's "FOV effects" setting: some will see
  no zoom. Confidence: medium, to be measured.
- The conversation's `cinematic` mode (ArtisanConversations) is then a scene with a camera
  anchor, a box, a name and choices, plus a camera session.

### 10. Inputs: clicks and a cursor (batch ④)

- **Hitbox**: an `Interaction` element (shown to the viewer only) turns a left or right click
  into the Game event `scene_click` (scene, element key, button), so an Action chain reacts to it
  like to a menu click.
- **Cursor** (needs a camera session): the player's head still turns while spectating; the
  engine reads the yaw and pitch deltas each tick, moves a cursor element over the scene's plane
  and resets the view. Hover and click become Game events. This is UltimateUI's model. Under
  latency the cursor lags by the round trip: measured before it is promised.
- **Bedrock**: the head is no mouse there (unusable on mobile and with a controller), and Geyser
  draws no display. UltimateUI shows its cursor menus on Bedrock as a panel over the world, world
  visible behind, no hotbar (screenshot of its "Bedrock Support" page): a **screen** with the
  native pointer, restyled by the pack's JSON UI, most probably (how they do it: not checked). Artisan
  already does exactly that for its menus: a styled menu on Bedrock is `chest_screen.json` restyled
  from data encoded in the title (`Bedrock.kt`, `BedrockTitle`). So an interactive scene has **two
  renderings of one Document**: on Java, displays + camera session + cursor; on Bedrock, a screen
  restyled by JSON UI (the chest screen as today, or a Floodgate/Cumulus form if a form's layout
  fits better, without its dark background), with the same element keys turned into buttons and
  the same `scene_click` Game event. This is why §2 keeps elements semantic (text, item, hitbox
  with a key) rather than Java-shaped.

### 11. HUDs that stay on screen: the overlay when centred, a screen anchor when pinned (batch ⑤, to study)

The UltimateUI screenshot (panels in the corners, a bar at the top) is a **screen** HUD: it does
not move when the player walks or turns, and stays pinned to the corners whatever the window's
size. Two techniques, two cases:

- **Centred** elements (a bar at the top, a box above the hotbar): text in the pack's fonts in the
  boss bar, the action bar or the sidebar, as BetterHud does. That is the **overlay**, not a
  scene: `OverlayApi.Slot` gains `BOSS_BAR` and `SIDEBAR`, laid out by the existing
  `OverlayLayout` and its composer, and a per-player permanent HUD Document (placeholders,
  conditions) shows it. No shader, every client version, works with Iris.
- **Pinned to a corner**: the server does not know the window's width, and the text of those
  slots is centred, so no font trick pins a corner. A display placed in front of the camera does
  not either (it lags behind the head and moves with the view bobbing). The documented technique
  is DisplayHud's (modrinth.com/mod/displayhud, not yet read in detail): display entities at
  reserved coordinates, which a **core shader** of the resource pack recognises and redraws
  anchored to the screen. That becomes a fourth anchor of the engine, **`screen`** (corner + px
  offset), drawn by the same elements. Its costs, to accept before it ships:
  - the core shader depends on the client version: it must be checked, often rewritten, at each
    Minecraft version, and it is built into Artisan's pack;
  - it is incompatible with Iris, OptiFine and other shader mods (their players see the displays
    in the world or nothing): a fallback to the overlay is required;
  - DisplayHud's licence must allow it before any of its shader is reused; otherwise write ours
    from the vanilla shaders.
- **Bedrock** (Geyser) runs no Java core shader, but its resource packs have **JSON UI**, and
  Artisan already uses it: styled menus on Bedrock come from `ui/chest_screen.json` in the Bedrock
  pack (`plugin/pack/…/Bedrock.kt`), fed by data the server encodes in the container title
  (`render/title/BedrockTitle.kt`, twin of the editor's `bedrockTitle.ts`: fields read by
  position, hidden page U+F800). A Bedrock HUD reuses **that same mechanism** on
  `ui/hud_screen.json`, fed by the action bar or the title instead of the container's, generated
  by the same `Bedrock.kt`. No second encoding. (UltimateUI is closed source; Iban says it works
  on Bedrock, its public page does not say how.) Today neither the overlay nor the conversations'
  HUD has a Bedrock rendering: Floodgate players fall back to the chat.

So one screen scene has **two renderings chosen per viewer**: Java (displays at reserved
coordinates + core shader) and Bedrock (the action bar or title encoded like `BedrockTitle` + `hud_screen.json`). The model must not
prevent it, which is why the engine already picks a `DisplayBackend` behind an interface (§1) and
why an element describes *what* to draw (text, item, offset in px from a corner), never *how*:
the backend for a viewer is chosen from the client (`supports`, Geyser). The Bedrock rendering can
come after the Java one.

Batch ⑤ starts with the centred overlay slots (no risk), then a prototype of the screen anchor
on one client version, measured against Iris.

## Batches

Each batch is usable on its own.

1. **Engine + API** (this PR, with text-only Bedrock): `SceneBook`, `EntityDisplayBackend`, `PaperScenes`,
   `api.getScenes()` `@Beta`, `/artisan scene-demo`. First real use: the quest markers
   above NPCs (ArtisanQuests).
2. **Scene Document kind**: YAML, `show_scene`/`hide_scene`, slots, groups, end callback, editor
   composer.
3. **Camera**: camera anchor, camera session (lock, vignette, zoom), cinematic conversations.
4. **Inputs**: hitboxes, cursor, `scene_click`/`scene_hover` Game events; chest-less menus.
5. **Screen HUD** (Iban, 2026-11-04: on Bedrock, HUDs go through the overlay, not scenes):
   the overlay's Bedrock rendering (`hud_screen.json` fed like `BedrockTitle`), overlay slots for the boss bar and the sidebar (centred), then the `screen`
   anchor redrawn by a core shader (pinned to a corner).

## Consequences

- One brick for every in-world interface: a module does not learn Paper's display API, nor how
  to clean up after it.
- Per-viewer entities cost server memory and tracking: fine for markers and one-player UIs,
  measured before anything is shown to a crowd (a packet backend is the way out, §1).
- Bedrock gets text only; a scene with items, blocks or animation needs a fallback until the
  JSON UI renderings (§10, §11).
- Open: Folia/Leaf threading of `showEntity` (§6); whether a display removed by someone else
  (`/kill @e`) should end its scene (today the scene stays shown with a missing element until
  the next show or hide).

## Implementation (batch ①)

- `plugin/api/…/scene/`: `ScenesApi`, `SceneAnchor`, `SceneElement`, `SceneTransform`.
- `plugin/paper/…/scene/`: `SceneBook` (tested: `SceneBookTest`), `EntityDisplayBackend`,
  `PaperScenes`, wired in `ArtisanPlugin` (listeners, add-on release, `onDisable`).
- `/artisan scene-demo` (admin): a marker above the entity the player looks at, seen by them
  alone, bobbing for 10 s, then hidden.
