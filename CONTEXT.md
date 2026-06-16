# Artisan — Domain Glossary

This file is the source of truth for domain language used in specs, code, and
chats. When a term in the codebase or spec drifts from a definition here, the
definition wins (or this file gets updated in the same change).

Terms are listed alphabetically. Each entry is a 1-3 sentence canonical
definition followed by examples and explicit non-examples where helpful.

## Key site

A single place in a pack tree that holds an **LText** — e.g. a menu title
layer, an element appearance's title/lore, a `send_message` action's text, a
dialog input label. Each key site has a **canonical key** derived purely from
its position (`menus.<id>.elements.<id>.<state>.title`, `…click.left.message_1`,
`dialogs.<id>.title`). One traversal (`visitLTexts` / per-node `visitMenuLTexts`,
`visitStepLTexts`, `visitDialogLTexts`, …) enumerates every key site; reads
(usage labels, validation), key assignment (`rekeyPack`), minting, and release
are all folds over it.

Examples:
- A button's `send_message` text is a key site; its canonical key is
  `commands.give.message` (or `…message_1` for the second message in the chain).

Non-examples:
- A material/icon id, a slot index, or a numeric `x`/`y` offset is **not** a key
  site — it carries no translatable text.
- The translation **value** (`"Buy now"` in `en`) is not the key site; the key
  site is the slot the value is filed under.

## LText

A reference to a localizable string: a stable **key** into the pack's
`i18nKeys` map, which holds the per-language values. Domain objects carry the
LText (the key), never the resolved string — resolution happens at render/export
against the active language with a fallback chain. A fresh LText is minted with
a random provisional key (`lt_<rand>`); canonicalization to a semantic key
happens lazily at the deploy/export/persist boundary, not per edit.

## Menu

A single inventory layout (rows × cols, default 6×9 chest) plus all of its
content: slots, conditional logic, click action chains. **One menu = one
editable document** identified by a stable id (e.g. `shop_main`). Pagination
is a runtime concern of certain slot kinds within a menu — it does **not**
mean "page 1" and "page 2" are separate menus.

Examples:
- `shop_main` is one menu. Its 4 pages of items are runtime states of the
  same document, navigated via in-menu nav slots.
- `category_armor` is a separate menu (different layout, different click
  handlers). Switching between `shop_main` and `category_armor` happens via
  the `open_menu` action.

Non-examples:
- `shop_main_page_2` is **not** a menu name we generate. There is one
  `shop_main` that paginates internally.
