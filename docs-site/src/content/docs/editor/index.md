---
title: Editor
description: Documentation for menu and pack creators using the Artisan web editor.
---

The editor guide is under construction. For now, the editor is best learned
by opening it (`/artisan editor` in-game) and experimenting — basic operations
are discoverable.

Sections planned:
- Creating your first pack and menu
- Slots, glyphs, and titles
- Click handlers and actions
- Dialogs and commands
- Importing custom items (Nexo / Oraxen / ItemsAdder)

## Main navigation

On mobile, project controls use two rows and the view tabs keep their icons.
Opening Library temporarily hides Properties without clearing the selection.
Selecting an item closes Library so its properties can be edited; closing Library
also restores the previous selection's properties.

Panels open and close with a short, 200 ms transition. Navigation and Elements slide
from their edge; Library expands horizontally or vertically with its layout.
Manual resizing remains immediate. Reduced-motion preferences disable these transitions.
Properties uses the same transition when opening or closing, with no animation
when changing the selected item inside an already open panel.

The main navigation (projects, servers and installed modules) hides automatically
on desktop, leaving the workspace full width. Hover over the left edge to reveal
the rounded floating panel without moving your workspace. A small button in the
top-left corner opens the main menu and remains available while the panel is open.
Its left-panel icon mirrors the right-panel Elements toggle.
It closes shortly after the pointer leaves, while keeping open menus and keyboard
navigation usable. Click this button to open a fixed, borderless sidebar. Click it again
to close it and return to automatic mode. This choice is remembered after reloading;
temporary hover openings are not saved.
Escape dismisses the temporary
panel. On smaller screens, use the navigation button to open it and the close button
or backdrop to dismiss it.

## Project toolbar

The project toolbar groups the project identity, view tabs, editing tools and Save
in one rounded surface. The selected view uses a soft capsule background; number
shortcuts remain in tooltips. On smaller screens, labels become icons and groups
can wrap within the same surface.

Undo/redo appears on Canvas, and the content language on Canvas and
Translations. Elements remains at the far right. Search uses a compact magnifying
glass. **Refresh from server** lives in the project menu and still asks before
replacing unsaved work. The arrow beside Save offers **Discard changes**.

## Library and properties

On desktop, **Elements** and **Properties** occupy separate full-height columns on
the right, ordered **Canvas → Properties → Elements**. Drag Properties' left edge to resize its
width, which is remembered. Elements starts hidden: hover the right edge to reveal
it over the workspace without resizing Properties. It closes shortly after the
pointer leaves, unless a menu is open or keyboard focus remains inside. Click the
Elements button at the right end of the toolbar to keep its column open; click
again to close it. This choice is remembered after reloading. On mobile, Elements opens
in a drawer from the right.
In Elements, the left arrow adds a document to the canvas; the right arrow removes it.

Open **Library** using the rounded tool at the top-left of the canvas to browse **Items** (Catalogue or Captured)
and **Graphics** (textures, glyphs and fonts). No menu needs to be selected.
The tool hides while the panel is open; use the close button to dismiss the panel and restore the tool.
Library visibility and its category are remembered for the last opened project after reloading.
The close button shares the category tabs row. Item filters scroll horizontally
instead of stacking above the grid, leaving more room for items in narrow panels.
The library sits left of the canvas when there is enough room, and below it on
mobile or in a narrow workspace. Drag its right edge to adjust the width, or its
top edge to adjust the height when it sits below. Both sizes are remembered;
the resize limit preserves space for the canvas.
Drag an item onto a menu slot, or click an item and then tap a slot to place it.
Select a graphic to edit its details; **Back to graphics** returns to the catalogue.

The separate **Properties** panel edits the current selection. Selecting another
menu or item keeps the library open, and either panel can be closed independently.
Material and image fields still offer their contextual pickers. Press **Escape**
outside a field or dialog to close the library before leaving the document view.
