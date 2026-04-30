# Interfaze — Domain Glossary

This file is the source of truth for domain language used in specs, code, and
chats. When a term in the codebase or spec drifts from a definition here, the
definition wins (or this file gets updated in the same change).

Terms are listed alphabetically. Each entry is a 1-3 sentence canonical
definition followed by examples and explicit non-examples where helpful.

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
