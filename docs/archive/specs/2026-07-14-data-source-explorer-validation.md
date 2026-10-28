# Data source explorer — manual validation checklist (Docker cross-stack)

Setup: `docker compose up` (backend + editor + minecraft), server linked, Boutique Add-on (or any module registering a data source with a schema) installed.

## Explorer (Data tab)
- [ ] "Server sources" section lists the module's sources, grouped with the module badge; core sources first, no-module sources under "Server".
- [ ] Source detail shows the schema table (name/type/description) and a copyable ref.
- [ ] "Preview" returns real rows (≤ 50); a >50-row source shows the "truncated" note.
- [ ] Stop the MC container → schema + badges remain visible, preview disabled with the offline explanation; REST preview returns 503.
- [ ] A player-dependent source shows the player_required message.
- [ ] With an old plugin JAR (pre data_source_fetch) → preview fails with the timeout message after ~5 s (504).

## Menu filters
- [ ] Import a project whose menu YAML has `source.filter/sort/limit` → values appear in the visual editor; export round-trips byte-identical shaping.
- [ ] Add filter `group = {group}` via autocomplete (schema field + menu arg suggestion).
- [ ] "Menu data" card shows ref + module badge + filter summary.
- [ ] Preview with a test value for `{group}` returns the filtered rows; in-game `/artisan menu …` with the same arg matches the preview.
- [ ] Preview with the test value left empty matches runtime behavior (unresolved `{group}` stays literal → no rows match).

## Regression
- [ ] Menu rendering with data sources (iteration) unchanged in game.
- [ ] `hello` from an old plugin (schema_hint only) still populates the source picker.
