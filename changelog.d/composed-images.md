- **Added** (preview): composed images. An image may be a recipe instead of a PNG: a `compose:`
  list in `assets/textures/<name>.yml` that stacks kit images (`kit:window.6`, a grid of
  `kit:cell`) and the module's own PNGs. The resource pack assembles it at each build, so it
  follows the server's kit. The editor lists it with its picture; the editor's assistant and AI
  apps write one with `write_image`'s `compose` instead of drawing a window pixel by pixel.
