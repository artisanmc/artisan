# Custom heads + head icon fix — Design

**Date:** 2026-06-12
**Status:** Approved

## Goal

Support custom player heads in menus from three sources — HeadDatabase ids, base64 skin textures, and player names — and fix the bug where every head item (player_head, zombie_head, creeper_head, …) renders with a soulsand texture in the editor.

## 1. Schema (`menu/v1` Appearance)

New optional field `head: string` on `Appearance`, honored only when `material` resolves to `PLAYER_HEAD`. Format is auto-detected by prefix:

| Prefix | Example | Meaning |
|---|---|---|
| `hdb:` | `hdb:128276` | HeadDatabase id |
| `basehead:` | `basehead:eyJ0ZXh0dXJlcyI6...` | Base64-encoded GameProfile textures property |
| `playerhead:` | `playerhead:Notch`, `playerhead:%player%` | Player name; placeholders resolved via ArgResolver, so iteration values work (`playerhead:{alias.owner}`) |

- Additive optional field on `menu/v1`, consistent with recent additions (`pagination_at_first/last`).
- Per CLAUDE.md schema rule: hand-align editor `types.ts` + plugin YAML types, keep `validateMenuV1` fixtures green, update `docs/architecture/schemas-codegen.md`.
- `head` joins the importable subset (export transform / validate / zip round-trip).

## 2. Plugin runtime

- `AppearanceYaml.head: String?`, value passed through `ArgResolver.resolve` before dispatch.
- In `MenuRenderer.buildItem`, when material is `PLAYER_HEAD` and `head` is set:
  - `basehead:` → `SkullMeta.playerProfile` = profile with `ProfileProperty("textures", base64)`. Profile UUID derived deterministically from the base64 hash so identical heads stack/compare consistently.
  - `playerhead:` → `setOwningPlayer(Bukkit.getOfflinePlayer(name))`; texture resolution is Paper's job. No blocking lookups on the render path.
  - `hdb:` → new HeadDatabase hook in `SoftDepRegistry` (`HeadDatabaseAPI.getItemHead(id)`). `softdepend` += `HeadDatabase` in `plugin.yml`. If HeadDatabase is absent: plain player head + one WARN on first use (no theater; runtime handles missing targets).
  - Unknown prefix but value starts with `eyJ` → treated as `basehead:` (tolerance for hand-edited YAML).
  - Anything else unrecognized → plain player head + WARN once.

## 3. Editor UI + preview

- **UI**: in the FlowCanvas StateCard, when the picked material is `player_head`, a **Custom head** section appears: source selector (None / HeadDatabase / Base64 / Player name) + text input. Pasting a raw value auto-detects the source (`hdb:` prefix, `eyJ…` base64, otherwise name). Writes the `head` field via `setAppearanceField`. Design-system components only; all strings through react-i18next (en + fr).
- **Preview** (real texture when possible):
  - `basehead:` → client-side base64 decode → `textures.minecraft.net` URL → extract texture id → render via `https://mc-heads.net/head/<texture-id>` (3D head).
  - `playerhead:` with a literal name → `https://mc-heads.net/head/<name>`; with a placeholder → generic player head icon.
  - `hdb:` → generic player head icon + badge showing the id (HeadDatabase has no public resolution API).
  - Resolved URLs cached in the textureStore; rendered on the Konva canvas and in the StateCard.

## 4. Soulsand icon bug fix

**Root cause:** all skull items inherit `minecraft:item/template_skull`, whose only texture entry is `"particle": "block/soul_sand"`; the flat-texture fallback in `backend/scripts/gen-items.ts` picks it up. Heads use *entity* textures, which the icon pipeline does not handle.

**Fix:**
- `gen-items.ts`: explicit mapping table skull item → entity texture (`player_head` → Steve skin, `zombie_head` → `entity/zombie/zombie`, plus creeper, skeleton, wither_skeleton, piglin, dragon).
- `gen-icons.ts`: new "head" renderer — an 8×8×8 cube with skin-layout UVs (face + hat layer) rendered in Three.js like the other 3D icons → `icons/<id>.png`. Dragon head approximated with the same cube using the dragon layout's face region.
- Regenerate 1.21.4 item data + icons.

## 5. Tests

- **Plugin**: YAML parse of `head`; base64 profile applied to SkullMeta; `playerhead:` placeholder resolution; `hdb:` fallback when HeadDatabase absent (WARN + plain head); `eyJ…` no-prefix tolerance.
- **Editor**: preview resolver unit tests (base64 decode → texture URL, name → mc-heads URL, hdb → generic); conditional Custom head UI section; export round-trip preserving `head`; schema fixtures.
- **Backend/scripts**: unit test for the skull → entity texture mapping.

## 6. Docs

- `docs/architecture/schemas-codegen.md` — schema change alignment.
- docs-site editor page for the user-facing Custom head UI.
- install-admin softdepend/HeadDatabase mention if applicable.

## Out of scope

- HeadDatabase browsing/search inside the editor.
- Animated/rotating head previews.
- menu/v2 — this is an additive v1 field.
