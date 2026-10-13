---
title: Editor
description: Documentation for menu and pack creators using the Artisan web editor.
---

Build Minecraft inventory menus in your browser: place items, edit their appearance,
and choose what happens when a player clicks. The editor is served by the Artisan
plugin on your own server: [install it](/wiki/getting-started/install-admin/), then
type `/artisan editor` in game and open the link it prints.

## Your first menu

1. Open a project of one of your servers. The [Projects guide](/wiki/editor/projects/)
   explains where projects live, private drafts, and publishing.
2. Open **Buttons**, then drag a game item onto a menu slot. Select it to edit its
   properties. For custom artwork, follow [Image buttons](/wiki/editor/image-buttons/).
3. Add click actions and conditions. Use the visual blocks or explore the
   [Action DSL](/wiki/editor/data-sources/#action-fields--the-action-dsl).
4. **Save** keeps your private draft on the server. When your menu is ready for
   players, use **Deploy** to publish it.

Add [composed titles](/wiki/editor/composed-titles/) and
[translations](/wiki/editor/translations/) when you want to take the design further.

## Main navigation

The first time you open a project, a short guided tour introduces navigation,
the canvas, Buttons and properties, Elements, view tabs, and saving your work.
Choose **Later** or close the tour to continue on your own; it will not open
automatically again. Use **Resume the tour** in the project menu to pick up where you
left off, or **Take the tour again** after finishing. Progress is remembered in this
browser; clearing browser data resets it.

On mobile, project controls use two rows and the view tabs keep their icons.
Opening Buttons temporarily hides Properties without clearing the selection.
Selecting an item closes Buttons so its properties can be edited; closing Buttons
also restores the previous selection's properties.

Panels open and close with a short, 200 ms transition. Navigation and Elements slide
from their edge; Buttons expands horizontally or vertically with its layout.
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

The project toolbar groups the project identity, view tabs, editing tools, Save and
Deploy in one rounded surface. The selected view uses a soft capsule background; number
shortcuts remain in tooltips. On smaller screens, labels become icons and groups
can wrap within the same surface.

Undo/redo appears on Canvas, and the content language on Canvas and
Translations. Elements remains at the far right. Search uses a compact magnifying
glass. **Refresh from server** lives in the project menu and still asks before
replacing unsaved work. The arrow beside Deploy offers **Discard changes**.

## Canvas navigation

The canvas shows every document of the project and arranges them automatically:
commands on the left, then the menus they open, then the next menus, following the
links between them. Documents that nothing opens yet sit at the bottom, under
**Not linked yet**. Drag a document to place it yourself: it stays where you put it,
and the others move out of its way. **Rearrange**, in the toolbar at the bottom,
releases every position and link anchor you set by hand and arranges the whole canvas again;
**Ctrl+Z** undoes it.

The canvas remembers your position and zoom separately for each project in this
browser, including after leaving the editor or refreshing the page.

**Server board**, on a server's page, shows the documents of all its projects on a
single read-only canvas, with the links between projects. Filter it by project, type
or id, and click a document to open it.

Use **Minimap** beside **Buttons** to open the overview, placed 8 px from the lower-right
corner. The button hides while the minimap is open; close it with **×** to reveal the button again.
This preference is remembered. The overview shows the documents on your
canvas and a rectangle marking the visible area. Drag that rectangle to move around,
or click elsewhere in the minimap to center the canvas there without changing zoom.
With the minimap focused, the arrow keys also move the view.

## Buttons and properties

On desktop, **Elements** and **Properties** occupy separate full-height columns on
the right, ordered **Canvas → Properties → Elements**. Drag Properties' left edge to resize its
width, which is remembered. Elements starts hidden: hover the right edge to reveal
it over the workspace without resizing Properties. It closes shortly after the
pointer leaves, unless a menu is open or keyboard focus remains inside. Click the
Elements button at the right end of the toolbar to keep its column open; click
again to close it. This choice is remembered after reloading. On mobile, Elements opens
in a drawer from the right.

Open **Buttons** using the square-and-pointer tool at the top-right of the canvas to browse
**Game items**, **Captured items** and **Images**. No menu needs to be selected.
The tool hides while the panel is open; use the close button to dismiss the panel and restore the tool.
Buttons visibility and its category are remembered for the last opened project after reloading.
The close button shares the category tabs row. Item filters scroll horizontally
instead of stacking above the grid, leaving more room for items in narrow panels.
The Buttons panel sits left of the canvas when there is enough room, and below it on
mobile or in a narrow workspace. Drag its right edge to adjust the width, or its
top edge to adjust the height when it sits below. Both sizes are remembered;
the resize limit preserves space for the canvas.
Drag an item onto a menu slot, or click an item and then tap a slot to place it.
To paste copied items at a specific slot, hover that slot and press **Ctrl+V** (**⌘V**),
or right-click the slot and choose **Paste here**. Several items keep their layout; if
the slot is taken, they land in the next free slots.
**Ctrl+click** (**⌘-click**) or **Shift+click** items of a menu to select several of them;
right-click one of them to copy, duplicate or delete the whole selection. The menu itself
stays untouched.
Open the project's **Resources** tab to import and manage images and fonts.
Select a resource to edit its details; **Back to resources** returns to the grid.
Classify images as **Button images** and/or **Menu images**; one image may have both
uses without being duplicated. Only button images appear in **Buttons → Images**.

The separate **Properties** panel edits the current selection. Selecting another
menu or item keeps the Buttons open, and either panel can be closed independently.
Material and image fields still offer their contextual pickers. Press **Escape**
outside a field or dialog to close the Buttons before leaving the document view.

### Player inventory

A menu's properties include **Player inventory**. **Visible** (the default) shows the
player's real inventory under the menu, read-only. **Hidden** replaces it with the
menu's own buttons: the 4 rows under the menu (3 inventory rows, then the hotbar)
become slots you can fill like any other. The player's real inventory is never
touched — it reappears as soon as the menu closes. Changing the menu's rows or
container type keeps each of these buttons on the same inventory slot.
