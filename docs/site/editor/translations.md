---
title: Translations
description: Translate your menus, and see how the translations are written to disk.
sidebar:
  order: 10
---

Every text your players read — menu titles, item names and lores, chat messages, dialog labels — is translatable. The editor's **Translations** panel lists them all, with the source text on one side and the language you're translating into on the other.

## Translating

Pick a language in the left column; the badge tells you how many texts are still missing in it. The language marked `src` is your **default language**: it holds the original text, and any language that lacks a translation falls back to it in game.

**Add a language** creates a new column — nothing else changes until you fill it in.

The texts come in one section per menu, command, dialog or data source (`menus.calendar`, `variants.bedrock.menus.calendar` for a variant's version), then the keys only `lang/` holds, by their first segment (`artisan`, an add-on's `claim`…), then the unused ones. Each section says how many texts it still lacks. With more than three sections they start closed: open the one you want. The search box keeps the texts whose key, place, source or translation contains every word you type, and opens every section.

A module's originals (the menus and commands it ships) appear once, at their readable key, like your own menus: the shipped copy the editor keeps for **Compare** and **Revert** is not listed.

**Remove N unused** deletes the texts of menus, commands, dialogs and data sources that no longer exist (leftovers from a deleted button, say), unless another text still points to them with `{i18n:…}`. Texts marked `(lang/ only)` are never removed: no document holds them, but something else reads them, such as an add-on's own messages (`auctions.messages.*`) or the duration units (`artisan.duration.*`). Removing is undoable until you publish.

An empty source value is valid: it means that a title, lore, or other text should stay blank. It is not counted as a missing translation, and an empty target is only missing when the source contains text. The empty value is still written to disk so the game renders nothing instead of showing the translation key.

### Texts of a module's commands

The panel also lists the description of each command the module declares, and its cooldown message once you gave it a cooldown. A puzzle icon marks them. They follow the module's languages, so a language you add here applies to them too. They are saved in each command's override file on the server, apart from the rest of the module: when you change one, a bar at the bottom of the panel offers **Save command texts**.

## How the files are written

Your project lives as YAML files on your server, and you can edit them by hand. A text carries its languages right where you read it: a plain string when only the default language has a value, a map with one entry per language otherwise.

```yaml
# menus/shop.yml
title: { en: Shop, fr: Boutique }
elements:
  - id: buy
    title: Sword                     # only the default language so far
    lore:
      en: [Sharp, and shiny]
      fr: [Tranchante, et brillante]
```

A text can also point to a shared key with `{i18n:common.close}`; the key then lives in `lang/<code>.yml`. The `lang/` folder also holds what no document carries: an add-on's messages, the duration units, and the other languages of your data sources.

Projects written in the older shapes (`{i18n:…}` references everywhere, or plain text with the other languages in `lang/`) still read the same; the editor writes the form above at the next publish, and no translation is lost.
