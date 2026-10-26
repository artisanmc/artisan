---
title: Translations
description: Translate your menus, and choose whether the files hold plain text or translation keys.
sidebar:
  order: 10
---

Every text your players read — menu titles, item names and lores, chat messages, dialog labels — is translatable. The editor's **Translations** panel lists them all, with the source text on one side and the language you're translating into on the other.

## Translating

Pick a language in the left column; the badge tells you how many texts are still missing in it. The language marked `src` is your **default language**: it holds the original text, and any language that lacks a translation falls back to it in game.

**Add a language** creates a new column — nothing else changes until you fill it in. **Remove N unused** deletes texts no longer attached to anything (leftovers from a deleted button, say).

An empty source value is valid: it means that a title, lore, or other text should stay blank. It is not counted as a missing translation, and an empty target is only missing when the source contains text. The empty value is still written to disk so the game renders nothing instead of showing the translation key.

### Texts of a module's commands

The panel also lists the description of each command the module declares, and its cooldown message once you gave it a cooldown. A puzzle icon marks them. They follow the module's languages, so a language you add here applies to them too. They are saved in each command's override file on the server, apart from the rest of the module: when you change one, a bar at the bottom of the panel offers **Save command texts**.

## How the files are written

Your project lives as YAML files on your server, and you can edit them by hand. The **On disk** toggle in the Translations panel decides what a text looks like there.

**Plain text** — each text sits in the menu file, right where you read it. With one language it is a plain string; once you translate it, it becomes one entry per language, and a translated lore gets a list of lines per language, each with its own number of lines:

```yaml
# menus/shop.yml
title:
  en: Shop
  fr: Boutique
elements:
  - id: buy
    title: Sword                 # not translated yet: one text for every language
    lore:
      en: [Sharp and shiny]
      fr: [Tranchante, et brillante]
    click:
      left:
        - send_message: { en: Bought!, fr: Acheté ! }
```

A player reads their own language, falls back to the default language when it is missing, and to any language present after that. A single-language project has no `lang/` folder at all: `lang/` only keeps the few texts that have no place in a menu, such as the units of durations or the texts of data sources.

**Keys** — the menu file carries references instead, and every language, the default one included, lives in `lang/`:

```yaml
# menus/shop.yml                     # lang/en.yml
title: "{i18n:menus.shop.title}"     menus:
elements:                              shop:
  - id: buy                              title: Shop
    title: "{i18n:menus.shop.elements.buy.default.title}"
```

Both forms work on the server, and you can mix them in the same file: a `{i18n:…}` reference is looked up in `lang/`, any other text is shown as written.

Switching asks for confirmation because it rewrites every menu, command and dialog file at the next save. **No translation is ever lost either way** — only the shape of the files changes, and you can switch back at any time.

:::tip
Translating from a text editor rather than the browser? **Plain text** is usually the mode you want: each text and its translations sit together, in the menu that shows them.
:::
