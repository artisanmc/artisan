- **Fixed**: A bold title text or label of a size other than 8 ("Jour 5" at size 12) pushed the
  next title layers to the left. Its width counted the bold's extra pixel times the size and
  rounded once for the whole line; Minecraft adds 1 px per bold glyph whatever the size and
  rounds each glyph's scaled width. Plugin and editor preview now measure it the same way.
- **Removed**: The load warning "names no material — it will render as STONE": a look with no
  image, item nor material has been an invisible hover area since API 1.11.0.
