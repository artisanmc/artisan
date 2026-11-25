- **Added** (preview): composed images. An image may be a recipe instead of a PNG: a `compose:`
  list in `assets/textures/<name>.yml` that stacks kit images (`kit:window.6`, a grid of
  `kit:cell`) and the module's own PNGs. The resource pack assembles it at each build, so it
  follows the server's kit. The editor lists it with its picture; the editor's assistant and AI
  apps write one with `write_image`'s `compose` instead of drawing a window pixel by pixel.
  In the Resources page, **Compose an image** starts one from a kit window or button, and its
  detail is a composer: layers dragged into place, reordered, repeated as a grid, added from
  the kit or the module.
