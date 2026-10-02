---
title: Navigation & back buttons
description: Let players walk back through the menus and dialogs they came from with a single back action.
---

Menus and dialogs remember the screens a player came through. That history lets
you build a **Back** button that returns to exactly where the player was —
without hand-wiring a target for every call site.

## How the history works

Every time a screen opens another one (`open_menu` or `open_dialog`), the screen
being left is pushed onto a per-player stack. History is a **stack**, not a path:
going `main → wiki → item` pushes `main`, then `wiki`.

## The `open_previous_menu` action

Add the **open_previous_menu** action to a button's click handler. It pops the
top of the stack and re-opens it.

Because the action *consumes* the stack, it can never bounce between two screens:

```
main → wiki → item
        ↑ back opens wiki   (stack: main)
                ↑ back opens main  (stack: empty)
```

Two backs from `item` land on `main`; a back from `main` does nothing (empty
stack). Dialogs are part of the same history, so a back can re-open a dialog too.

## Showing the button only when it can work

Use the `{has_previous_menu}` placeholder to hide the button when there is
nothing to go back to. Give the element no display, and one state that shows the
button only when the condition holds:

```yaml
elements:
  - id: back
    positions: 0
    click:
      left:
        - open_previous_menu
    states:
      - if:
          - expression: has_previous_menu
        material: ARROW
        title: { en: "Back", fr: "Retour" }
```

## Placeholders

| Placeholder | Value |
|---|---|
| `{has_previous_menu}` | `true` when there is a screen to go back to |
| `{previous_menu.id}` | Id of the previous screen |
| `{previous_menu.title}` | Title of the previous screen (best effort) |

`{previous_menu}` on its own renders the previous screen's id. These placeholders
are available in every menu, element, action and dialog text field.
