---
title: Translations
description: Translate your menus, and choose whether the files hold plain text or translation keys.
---

Every text your players read — menu titles, item names and lores, chat messages, dialog labels — is translatable. The editor's **Translations** panel lists them all, with the source text on one side and the language you're translating into on the other.

## Translating

Pick a language in the left column; the badge tells you how many texts are still missing in it. The language marked `src` is your **default language**: it holds the original text, and any language that lacks a translation falls back to it in game.

**Add a language** creates a new column — nothing else changes until you fill it in. **Remove N unused** deletes texts no longer attached to anything (leftovers from a deleted button, say).

An empty source value is valid: it means that a title, lore, or other text should stay blank. It is not counted as a missing translation, and an empty target is only missing when the source contains text. The empty value is still written to disk so the game renders nothing instead of showing the translation key.

## How the files are written

Your project lives as YAML files on your server, and you can edit them by hand. The **On disk** toggle in the Translations panel decides what a text looks like there:

**Plain text** — the menu file carries the default language's text, right where you read it:

```yaml
# menus/shop.yaml
title: Shop
elements:
  - id: buy
    title: Sword
    lore: Sharp and shiny
```

The other languages live in `lang/fr.yaml`, `lang/de.yaml`… and there is **no file for your default language** — the menu already carries it. A single-language server therefore has no `lang/` folder at all.

**Keys** — the menu file carries references instead, and every language, the default one included, lives in `lang/`:

```yaml
# menus/shop.yaml                    # lang/en.yaml
title: "{i18n:menus.shop.title}"     menus:
elements:                              shop:
  - id: buy                              title: Shop
    title: "{i18n:menus.shop.elements.buy.default.title}"
```

Both forms work on the server, and you can mix them in the same file — a `{i18n:…}` reference always wins, a plain text is looked up by its position, and failing that it displays as written.

Switching asks for confirmation because it rewrites every menu, command and dialog file at the next save. **No translation is ever lost either way** — only the shape of the files changes, and you can switch back at any time.

:::tip
Translating from a text editor rather than the browser? **Plain text** is usually the mode you want: the menu reads like a menu, and each language file mirrors the menu's own structure.
:::
