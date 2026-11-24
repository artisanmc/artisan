- **Changed**: The resource pack's text fonts (`text_y`, `text_up`, ~300 of them) only carry the
  characters a server can show: Latin, Greek, punctuation, currency, arrows, symbols, dingbats
  and emoji always, the other alphabets (Cyrillic, Hebrew, Vietnamese Latin…) only when the
  server's Projects use them. The three vanilla sheets are redrawn in the pack with those
  characters, so a small server's pack goes from 2.4 MB to 1.06 MB. A character of a left-out
  alphabet that only appears at run time (another plugin's Cyrillic placeholder) draws the
  missing glyph; a resource pack that replaces the vanilla font textures no longer restyles
  title texts.
