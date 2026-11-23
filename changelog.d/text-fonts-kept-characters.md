- **Changed**: The resource pack's text fonts (`text_y`, `text_up`, ~300 of them) only carry the
  characters a server can show: the Latin, punctuation and currency blocks, plus any other
  character its Projects' files contain. The three vanilla sheets are redrawn in the pack with
  those characters, so a font weighs ~1.5 KB instead of ~7.5 KB and a small server's pack goes
  from 2.4 MB to 0.6 MB. A character that only appears at run time outside every Project (a
  Greek placeholder of another plugin) draws the missing glyph; a resource pack that replaces
  the vanilla font textures no longer restyles title texts.
