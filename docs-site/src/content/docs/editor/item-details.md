---
title: Advanced item parameters
description: Add enchantments, custom model data, colours, and raw NBT to menu items.
---

Every item state has an **Advanced parameters** section, collapsed under the lore field.
It holds everything beyond material, title, and lore. The trigger shows a count badge when
something is set, so a configured item never hides its own configuration.

## Enchantments

Add one row per enchantment: an id and a level.

| You can type | Example |
|---|---|
| The short vanilla id (suggested as you type) | `sharpness` |
| The namespaced id | `minecraft:sharpness` |
| The old Bukkit constant | `DAMAGE_ALL` |
| A modded id | `mymod:soulbound` |

All four are accepted and stored as the short id. **Levels above the vanilla maximum are
allowed** — servers use them, so the editor only warns rather than clamping. An id the server
doesn't know is skipped at render time with one warning in the console; the rest of the item
still renders.

Enchanted items show a violet marker in the editor canvas and list their enchantments in the
hover tooltip. This is a marker, not a copy of the in-game glint shader.

**Glowing effect** (without a real enchantment) is a separate checkbox, and only appears when
there are no enchantments — real ones already glow.

## Other parameters

| Parameter | What it does |
|---|---|
| **Custom model data** | Numeric or text value for resource-pack models. |
| **Unbreakable** | Durability never decreases. |
| **Hide in the tooltip** | Hides tooltip sections (attributes, enchantments, dye…). Toggle each chip. |
| **Colour** | Tint for leather armour, potions, and firework stars. The field only appears for those materials. |
| **Raw NBT** | Escape hatch, applied last, after every other field. |

Raw NBT is best-effort: if the server rejects the snippet, it is logged as a warning and the
item renders without it — it is never blanked.

## What a referenced item brings with it

An element whose material is a captured item (`item:<id>`) renders the exact stack you
captured in game — enchantments, colour, **and its own name and lore**.

The element layers on top of it rather than replacing it:

- **Lore adds up.** The item's own lines come first, then the lines you write on the
  element. A shop icon captured with `Sharp blade` and given `Price: 500` in the menu
  shows both, in that order.
- **The title replaces.** Two names can't be shown at once, so the title you write on the
  element wins. Leave it empty and the captured item's name is used.

This is also how the canvas preview draws it, so what you see when hovering a slot is what
the player gets.

## Extracting a captured item

The stack's details render faithfully, but none of them are editable while the element
just points at the item.

The **Extract the details** button turns that reference into real fields: material, count,
title, lore, enchantments, and every advanced parameter, read straight out of the captured
stack.

The trade-off is stated in the confirmation: **the link to the captured item is lost.**
The slot no longer follows it if you re-capture. Keep the reference when you want the item to
stay in sync with what is in the chest; extract when you want to edit it.
