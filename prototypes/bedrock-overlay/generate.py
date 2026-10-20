#!/usr/bin/env python3
"""Builds the Bedrock overlay prototype: resource pack, Geyser mappings, test project.

    python3 prototypes/bedrock-overlay/generate.py            # writes build/
    python3 prototypes/bedrock-overlay/generate.py --install  # + copies into docker/server/plugins

Standard library only. See README.md for what each piece tests.
"""
import argparse
import json
import shutil
import struct
import uuid
import zipfile
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
BUILD = HERE / "build"
SERVER = HERE.parent.parent / "docker" / "server"

# Title markers the overlay reacts to. M1 is the invisible form NxMenu documents
# (a § sequence); M2 is a visible fallback in case Geyser or MiniMessage mangles M1.
M1 = "§1§2§3§r"
M2 = "#proto#"

# Bedrock classic large chest (namespace `chest`): top half at y=11, grid at +(7,10).
GRID_X, GRID_Y, CELL = 7, 21, 18
BG_W, BG_H = 176, 143

HIT_MODEL = "artisan:buttons/hit_area"   # the item Artisan already puts under image buttons
GIFT_MODEL = "artisan:proto/gift"


# --- JSON UI ---------------------------------------------------------------

def contains(var, marker):
    return f"(not (({var} - '{marker}') = {var}))"


def overlay(var):
    return f"({contains(var, M1)} or {contains(var, M2)})"


def screen(panel):
    # With a marker, mobile ("pocket") clients get the classic layout too, so the
    # background lines up with the same slot grid everywhere.
    return {
        "$close_on_player_hurt|default": True,
        "close_on_player_hurt": "$close_on_player_hurt",
        "variables": [
            {"requires": f"($desktop_screen or {overlay('$container_title')})",
             "$screen_content": f"chest.{panel}", "$screen_bg_content": "common.screen_background"},
            {"requires": f"($pocket_screen and (not {overlay('$container_title')}))",
             "$screen_content": f"pocket_containers.{panel}"},
        ],
    }


def chest_panel(kind):
    top_half = f"{kind}_chest_panel_top_half"
    root_controls = [{"common_panel@common.common_panel": {}}]
    if kind == "large":
        root_controls.append({"artisan_background": {
            "type": "image", "texture": "textures/artisan/proto_background",
            "size": [BG_W, BG_H], "offset": [0, 0], "anchor_from": "top_left", "anchor_to": "top_left",
            # Above the vanilla panel (common_panel), below the slots (chest_panel, layer 5).
            "layer": 2, "$atext": "$container_title", "visible": overlay("$atext")}})
    root_controls.append({"chest_panel": {"type": "panel", "layer": 5, "controls": [
        {f"{top_half}@chest.{top_half}": {}},
        {"close_button@common.close_button": {"layer": 20, "offset": [17, 4], "anchor_from": "top_right", "anchor_to": "top_right"}},
        {"inventory_panel_bottom_half_with_label@common.inventory_panel_bottom_half_with_label": {}},
        {"hotbar_grid@common.hotbar_grid_template": {}},
        {"inventory_take_progress_icon_button@common.inventory_take_progress_icon_button": {}},
    ]}})
    root = {"layer": 1, "controls": root_controls}
    if kind == "large":
        root["size"] = [176, 220]
    small = kind == "small"
    return {"type": "panel", "controls": [
        {"container_gamepad_helpers@common.container_gamepad_helpers": {}},
        {"flying_item_renderer@common.flying_item_renderer": {"layer": 14 if small else 11}},
        {"selected_item_details_factory@common.selected_item_details_factory":
            {} if small else {"control_name": "@chest.selected_item_details"}},
        {"item_lock_notification_factory@common.item_lock_notification_factory":
            {} if small else {"control_name": "@common.item_lock_notification"}},
        {"root_panel@common.root_panel": root},
        {"inventory_selected_icon_button@common.inventory_selected_icon_button": {}},
        {"gamepad_cursor@common.gamepad_cursor_button": {}},
    ]}


def plain_screen(panel, base="common.inventory_screen_common"):
    return {"$close_on_player_hurt|default": True, "close_on_player_hurt": "$close_on_player_hurt", "variables": [
        {"requires": "$desktop_screen", "$screen_content": f"chest.{panel}", "$screen_bg_content": "common.screen_background"},
        {"requires": "$pocket_screen", "$screen_content": f"pocket_containers.{panel}"},
    ]}


def chest_screen_json():
    """The vanilla chest_screen.json structure, plus the overlay and the marker checks."""
    return {
        "namespace": "chest",
        "chest_label": {
            "type": "label", "offset": [7, -1], "anchor_from": "top_left", "anchor_to": "top_left",
            "text": "$container_title", "size": ["90%", "default"], "color": "$title_text_color", "layer": 2,
            # The background carries the title; hide the vanilla label (and the marker) under it.
            "$atext": "$container_title", "visible": f"(not {overlay('$atext')})"},
        "chest_grid_item@common.container_item": {"$item_collection_name": "container_items"},
        "small_chest_grid": {"type": "grid", "size": [162, 54], "anchor_from": "top_left", "anchor_to": "top_left",
                             "grid_dimensions": [9, 3], "grid_item_template": "chest.chest_grid_item",
                             "collection_name": "container_items"},
        "large_chest_grid": {"type": "grid", "size": [162, 108], "anchor_from": "top_left", "anchor_to": "top_left",
                             "grid_dimensions": [9, 6], "grid_item_template": "chest.chest_grid_item",
                             "collection_name": "container_items"},
        "small_chest_panel_top_half": {"type": "panel", "size": ["100%", "50%"], "offset": [0, 12],
                                       "anchor_to": "top_left", "anchor_from": "top_left", "controls": [
                                           {"chest_label@chest.chest_label": {}},
                                           {"small_chest_grid@chest.small_chest_grid": {"offset": [7, 9]}}]},
        "large_chest_panel_top_half": {"type": "panel", "size": ["100%", 132], "offset": [0, 11],
                                       "anchor_to": "top_left", "anchor_from": "top_left", "controls": [
                                           {"chest_label@chest.chest_label": {}},
                                           {"large_chest_grid@chest.large_chest_grid": {"offset": [7, 10]}}]},
        "small_chest_panel": chest_panel("small"),
        "selected_item_details@common.selected_item_details": {"offset": [0, 0]},
        "large_chest_panel": chest_panel("large"),
        "ender_chest_panel@chest.small_chest_panel": {},
        "shulker_box_panel@chest.small_chest_panel": {},
        "barrel_panel@chest.small_chest_panel": {},
        "small_chest_screen@common.inventory_screen_common": screen("small_chest_panel"),
        "large_chest_screen@common.inventory_screen_common": screen("large_chest_panel"),
        "ender_chest_screen@common.inventory_screen_common": plain_screen("ender_chest_panel"),
        "shulker_box_screen@chest.small_chest_screen": plain_screen("shulker_box_panel"),
        "barrel_screen@chest.small_chest_screen": plain_screen("barrel_panel"),
    }


# --- PNG ------------------------------------------------------------------

class Canvas:
    def __init__(self, w, h, fill=(0, 0, 0, 0)):
        self.w, self.h = w, h
        self.px = [list(fill) for _ in range(w * h)]

    def rect(self, x, y, w, h, rgba):
        for yy in range(max(0, y), min(self.h, y + h)):
            for xx in range(max(0, x), min(self.w, x + w)):
                self.px[yy * self.w + xx] = list(rgba)

    def frame(self, x, y, w, h, fill, border):
        self.rect(x, y, w, h, border)
        self.rect(x + 1, y + 1, w - 2, h - 2, fill)

    def text(self, s, cx, y, rgba, scale=1):
        width = (len(s) * 4 - 1) * scale
        x = cx - width // 2
        for ch in s:
            rows = FONT.get(ch, FONT[" "])
            for r, bits in enumerate(rows):
                for c in range(3):
                    if bits >> (2 - c) & 1:
                        self.rect(x + c * scale, y + r * scale, scale, scale, rgba)
            x += 4 * scale

    def png(self):
        raw = b"".join(b"\x00" + bytes(v for p in self.px[y * self.w:(y + 1) * self.w] for v in p)
                       for y in range(self.h))

        def chunk(tag, data):
            body = tag + data
            return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
        return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", self.w, self.h, 8, 6, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


FONT = {  # 3x5, one int per row
    " ": [0, 0, 0, 0, 0], "A": [2, 5, 7, 5, 5], "C": [3, 4, 4, 4, 3], "D": [6, 5, 5, 5, 6], "F": [7, 4, 6, 4, 4],
    "G": [3, 4, 5, 5, 3], "I": [7, 2, 2, 2, 7], "L": [4, 4, 4, 4, 7], "M": [5, 7, 7, 5, 5], "O": [2, 5, 5, 5, 2],
    "P": [6, 5, 6, 4, 4], "R": [6, 5, 6, 5, 5], "S": [3, 4, 2, 1, 6], "T": [7, 2, 2, 2, 2], "X": [5, 5, 2, 5, 5],
    "Y": [5, 5, 2, 2, 2], "E": [7, 4, 6, 4, 7], "H": [5, 5, 7, 5, 5], "K": [5, 5, 6, 5, 5],
}
PANEL, BORDER, CELL_FILL, CELL_EDGE = (156, 200, 236, 255), (58, 110, 165, 255), (47, 79, 134, 255), (28, 52, 92, 255)
BUTTON, BUTTON_EDGE, INK = (223, 239, 255, 255), (58, 110, 165, 255), (28, 52, 92, 255)


def cell(slot):
    return GRID_X + (slot % 9) * CELL, GRID_Y + (slot // 9) * CELL


def background_png():
    c = Canvas(BG_W, BG_H)
    c.frame(0, 0, BG_W, BG_H, PANEL, BORDER)
    c.frame(40, 4, 96, 13, BORDER, INK)
    c.text("DAILY GIFTS", BG_W // 2, 8, BUTTON)
    for slot in list(range(10, 17)) + [49]:          # gift row + head test: framed cells
        x, y = cell(slot)
        c.frame(x, y, CELL, CELL, CELL_FILL, CELL_EDGE)
    x, y = cell(30)                                  # CLAIM: one image button over slots 30-32
    c.frame(x + 1, y + 2, 3 * CELL - 2, CELL - 4, BUTTON, BUTTON_EDGE)
    c.text("CLAIM", x + 3 * CELL // 2, y + 7, INK)
    x, y = cell(8)                                   # X: one-slot image button
    c.frame(x + 2, y + 2, CELL - 4, CELL - 4, BUTTON, BUTTON_EDGE)
    c.text("X", x + CELL // 2, y + 7, INK)
    return c.png()


def gift_png():
    c = Canvas(16, 16)
    c.frame(2, 5, 12, 10, (120, 160, 220, 255), INK)
    c.rect(1, 3, 14, 3, (90, 130, 200, 255))
    c.rect(7, 3, 2, 12, (170, 60, 190, 255))
    return c.png()


# --- Pack, mappings, project -----------------------------------------------

def uid(name):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"https://artisanmc.net/prototypes/bedrock-overlay/{name}"))


def pack_files():
    return {
        "manifest.json": json.dumps({
            "format_version": 2,
            "header": {"name": "Artisan Bedrock overlay prototype", "description": "Chest overlay + custom items",
                       "uuid": uid("header"), "version": [1, 0, 0], "min_engine_version": [1, 20, 0]},
            "modules": [{"type": "resources", "uuid": uid("resources"), "version": [1, 0, 0]}],
        }, indent=2),
        "ui/chest_screen.json": json.dumps(chest_screen_json(), ensure_ascii=False, indent=2),
        "textures/item_texture.json": json.dumps({
            "resource_pack_name": "artisan_proto", "texture_name": "atlas.items",
            "texture_data": {"artisan_hit_area": {"textures": ["textures/items/artisan_hit_area"]},
                             "artisan_proto_gift": {"textures": ["textures/items/artisan_proto_gift"]}},
        }, indent=2),
        "textures/artisan/proto_background.png": background_png(),
        "textures/items/artisan_hit_area.png": Canvas(16, 16).png(),   # fully transparent
        "textures/items/artisan_proto_gift.png": gift_png(),
    }


def mappings_json():
    return json.dumps({"format_version": 2, "items": {"minecraft:paper": [
        {"type": "definition", "model": HIT_MODEL, "bedrock_identifier": "artisan:hit_area",
         "display_name": "Artisan hit area", "bedrock_options": {"icon": "artisan_hit_area"}},
        {"type": "definition", "model": GIFT_MODEL, "bedrock_identifier": "artisan:proto_gift",
         "display_name": "Gift", "bedrock_options": {"icon": "artisan_proto_gift"}},
    ]}}, indent=2)


def menu_yaml(menu_id, title):
    def clicks(name):
        return "\n".join(f"      {k}: 'send_message \"{name}: {k}\"'" for k in ("left", "right", "shift_left"))
    return f"""schema: menu/v1
id: {menu_id}
title: {json.dumps(title, ensure_ascii=False)}
size: 54
elements:
  - id: gift
    positions: "10-16"
    material: PAPER
    title: Gift
    nbt: '[minecraft:item_model="{GIFT_MODEL}"]'
    click:
{clicks("gift")}
  - id: claim
    positions: "30-32"
    material: PAPER
    title: Claim
    nbt: '[minecraft:item_model="{HIT_MODEL}"]'
    click:
{clicks("claim")}
  - id: close
    positions: "8"
    material: PAPER
    title: Close
    nbt: '[minecraft:item_model="{HIT_MODEL}"]'
    click:
      left: close_menu
  - id: head
    positions: "49"
    material: PLAYER_HEAD
    head: Notch
    title: Head test
"""


def project_files():
    return {
        "manifest.yaml": "schema: manifest/v1\nproject_id: bedrock_proto\ndefault_lang: en\nlanguages: [en]\n"
                         "files:\n  menus: [gifts, gifts_token]\n  commands: []\n",
        "menus/gifts.yaml": menu_yaml("gifts", M1 + "Daily Gifts"),
        "menus/gifts_token.yaml": menu_yaml("gifts_token", M2 + " Daily Gifts"),
    }


def write(root, files):
    for rel, data in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data if isinstance(data, bytes) else data.encode("utf-8"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--install", action="store_true", help="copy into docker/server/plugins")
    args = parser.parse_args()

    shutil.rmtree(BUILD, ignore_errors=True)
    pack = pack_files()
    write(BUILD / "pack", pack)
    mcpack = BUILD / "artisan_bedrock_proto.mcpack"
    with zipfile.ZipFile(mcpack, "w", zipfile.ZIP_DEFLATED) as z:
        for rel, data in sorted(pack.items()):
            z.writestr(rel, data)
    write(BUILD / "custom_mappings", {"artisan_proto.json": mappings_json()})
    write(BUILD / "project", project_files())
    print(f"built {BUILD}")

    if args.install:
        geyser = SERVER / "plugins" / "Geyser-Spigot"
        (geyser / "packs").mkdir(parents=True, exist_ok=True)
        shutil.copy2(mcpack, geyser / "packs" / mcpack.name)
        write(geyser / "custom_mappings", {"artisan_proto.json": mappings_json()})
        project = SERVER / "plugins" / "Artisan" / "projects" / "bedrock_proto"
        shutil.rmtree(project, ignore_errors=True)
        write(project, project_files())
        print(f"installed into {SERVER / 'plugins'}")


if __name__ == "__main__":
    main()
