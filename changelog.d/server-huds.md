- **Added** (preview): server HUDs. A `hud` Document (`huds/<id>.yml`, schema `hud/v1`) draws images
  and texts in the boss bar or action bar slot for every player who has the pack: permanent,
  conditional (`when`) or temporary (`enabled: false`, shown by the new `show_hud: {hud, duration}`
  action, hidden by `hide_hud`). Its texts read `{player}` and the Variables (`{var.coins}`), drawn
  as text, and update on each change of Variable, then every `refresh` ticks. The editor has a HUD
  page: zone, lifetime, layout on the game's screen, texts. API 1.14.0, ADR `server-huds`.
- **Fixed**: `OverlayApi.hasPack` was true for a Bedrock player whose Geyser answered the pack
  request, so module HUDs (conversations, the tracked quest) sent pack glyphs their client shows as
  squares. It is now always false for Bedrock: those modules fall back to the chat or the plain
  boss bar.
