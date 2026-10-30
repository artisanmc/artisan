- **Added** (preview): Editor SDK 1.16: `OverlayComposer`, a HUD layout edited with the mouse on the
  game's screen (drag a layer, resize a text or a list by its handles, nudge with the arrow keys,
  layers listed and reordered beside, the selected one's numbers and images on the other side), and
  `AssetInput`, the editor's image picker on a name. The layout's reading and geometry are exported
  in TypeScript. A kind's `pack.images` can read the project's other files (one, or a folder's) and
  ask for an image by its bottom edge. `OverlaySlotsComposer` opens only a layout's image slots: each
  gets an image and an offset from its place, dragged on the screen (a speaker's portrait in a mode).
  A 1.15 bundle still loads.
