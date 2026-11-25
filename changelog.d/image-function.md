- **Added**: an image can state what it is for in its descriptor (`function: menu`, `glyph` or
  `hud`), which fixes its measures: the pixel size of a menu or HUD image, the height and
  ascent of a glyph. Set it in the image's advanced fields. A server's version of an image a
  module ships with a function is taken at those measures only; at others the module's
  original keeps showing, in the editor and in the game, and the image says **Not taken**.
  Nothing changes for an image whose original declares no function.
