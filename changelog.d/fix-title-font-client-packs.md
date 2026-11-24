- **Fixed**: A player whose own resource pack puts glyphs in `minecraft:default` at private-use
  codepoints (negative space fonts use U+F801…) saw every textured menu title shifted sideways:
  `artisan:default` referenced `minecraft:default` first, so the client pack's glyphs won over
  Artisan's offsets and images. The reference now comes last.
