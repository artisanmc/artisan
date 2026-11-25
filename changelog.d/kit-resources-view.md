- **Added**: The server page has a **UI kit** tab: every piece of the kit's base by family with
  its size and who drew it (Artisan or this server), and the server's own kit images. A click
  on a piece opens it in the atelier of the `ui-kit` module, copying Artisan's image first when
  the server has not redrawn it, and making that module on a server that has none. A theme of
  the kit opens on the colours it replaces, the pieces it redraws and every piece without and
  with it, and is put in place on the server, or taken off, from there.
- **Added**: A composed image's composer draws: **Draw a layer** adds an empty PNG of the
  image's size on top and opens the pixel editor among the other layers, and **Retouch this
  layer** edits a PNG layer in place. The image stays a recipe.
- **Changed**: Images are edited in an atelier that takes the whole Resources page; the side
  panel only shows the selected image. The atelier draws guides (slots, inventory, title line)
  and shows an image on slots in a menu at the game's size. **New image** replaces "Compose an
  image" and "Draw an image": the image's use (menu background, slots, icon, free size) gives
  its size, and it starts empty or from a kit piece.
- **Added**: In the atelier, **Add layers** turns a PNG into a composed image of the same name
  whose first layer is that PNG, so the menus that show it follow; **Flatten** turns a composed
  image back into one PNG.
