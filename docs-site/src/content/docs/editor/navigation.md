---
title: Navigation & back buttons
description: Let players walk back through the menus and dialogs they came from with a single back action.
---

Menus and dialogs remember the screens a player came through. That history lets
you build a **Back** button that returns to exactly where the player was —
without hand-wiring a target for every call site.

## Opening a screen of another project

`open_menu` and `open_dialog` name their target by id. A bare id (`shop`) is
looked up in the project of the screen or command that runs the action first,
then on the whole server if only one project defines it. To reach a screen of
another project — or to choose between two projects that both define the same
id — prefix it with the project's folder name:

```yaml
click:
  left:
    - open_menu: boutique:main
```

If a bare id matches several other projects, the last loaded one opens (as
before) and the server log says which projects define it. The deploy review
warns about it too.

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

Closing a menu without opening another screen (pressing Esc, or a **close_menu**
action) ends the navigation and empties the history. A link to a menu or dialog
that does not exist leaves the history unchanged.

## Esc as a back button

Turn on **ESC goes back** in the project settings (manifest `escape_goes_back: true`)
and pressing Esc in one of the project's menus behaves like **open_previous_menu**:
the previous screen reopens. On the first menu (empty history), Esc closes as usual.
A **close_menu** action still closes everything.

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
