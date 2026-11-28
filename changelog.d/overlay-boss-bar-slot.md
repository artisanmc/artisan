- **Added**: `OverlayApi.Slot.BOSS_BAR` (API 1.13.0): a module draws a HUD at the top of the screen,
  as the name of a boss bar Artisan keeps per player. The pack now always makes the yellow boss bar
  transparent, so only that name shows; yellow is reserved for it (a plugin's yellow bar loses its
  bar for players who have the pack).
- **Added**: editor SDK 1.24.0: `OverlayComposer` takes `slot: "boss_bar"` to lay a HUD out from
  the top boss bar's name instead of the action bar.
